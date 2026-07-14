"""OpenAI-compatible AI provider support for server mode (#491 PR3).

Mirrors the web/native provider registry
(``apps/web/src/services/ai/providers/providerRegistry.ts`` +
``OpenAICompatProvider.ts``) so that server/proxy deployments can use a
non-Gemini, OpenAI-compatible LLM (OpenAI, DeepSeek, Kimi, OpenRouter) in
addition to Gemini.

The Gemini path remains handled by ``gemini_service`` via the official SDK and
is intentionally left untouched. This module only implements the generic
OpenAI-compatible chat-completions path used when ``AI_PROVIDER`` selects a
non-Gemini provider.

Environment variables (non-Gemini providers):
- ``AI_PROVIDER``  active provider id (``gemini`` | ``openai`` | ``deepseek`` |
  ``kimi`` | ``openrouter``). Defaults to ``gemini``.
- ``AI_API_KEY``   API key for the active non-Gemini provider.
- ``AI_MODEL``     model id for the active non-Gemini provider (optional;
  falls back to the provider default).
"""

import asyncio
import base64
import io
import os
from typing import Optional

import httpx

from logging_config import get_logger

logger = get_logger()

DEFAULT_PROVIDER = "gemini"

# Provider descriptors mirror the web registry. ``gemini`` is listed for
# completeness/validation but is served by gemini_service, not this module.
PROVIDERS: dict[str, dict] = {
    "gemini": {
        "label": "Google Gemini",
        "base_url": None,
        "vision": True,
        "default_model": "gemini-2.5-flash",
    },
    "openai": {
        "label": "OpenAI",
        "base_url": "https://api.openai.com/v1",
        "vision": True,
        "default_model": "gpt-4o-mini",
        "image_gen": {
            "endpoint": "openai-images",
            "models": ["gpt-image-1", "dall-e-3"],
        },
    },
    "deepseek": {
        "label": "DeepSeek",
        "base_url": "https://api.deepseek.com/v1",
        "vision": False,
        "default_model": "deepseek-chat",
    },
    "kimi": {
        "label": "Kimi (Moonshot)",
        "base_url": "https://api.moonshot.ai/v1",
        "vision": False,
        "default_model": "kimi-k2-0905-preview",
    },
    "openrouter": {
        "label": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "vision": True,
        "default_model": "openai/gpt-4o-mini",
        "image_gen": {
            "endpoint": "openrouter-images",
            "models": ["google/gemini-2.5-flash-image"],
        },
    },
}

# Request timeout for provider HTTP calls (seconds).
_HTTP_TIMEOUT = 300.0


class ProviderError(RuntimeError):
    """Raised when an OpenAI-compatible provider request fails."""


class ProviderImageError(ProviderError):
    """Raised when an OpenAI-compatible image-generation request fails.

    Carries the HTTP ``status_code`` (when available) so the caller can decide
    whether to fall back to the next configured image model (auth/availability
    errors) or surface the failure immediately.
    """

    def __init__(self, status_code: Optional[int], message: str):
        super().__init__(message)
        self.status_code = status_code


def get_active_provider_id() -> str:
    """Return the configured active provider id, defaulting to ``gemini``.

    Reads ``AI_PROVIDER`` from the environment on every call so hot-reloaded
    service restarts pick up changes. Unknown values fall back to the default.
    """
    value = os.environ.get("AI_PROVIDER", "").strip().lower()
    if value in PROVIDERS:
        return value
    return DEFAULT_PROVIDER


def is_gemini_active() -> bool:
    """Return True when the active provider is Gemini (the SDK path)."""
    return get_active_provider_id() == "gemini"


def get_provider_descriptor(provider_id: Optional[str] = None) -> dict:
    """Return the descriptor for ``provider_id`` (or the active provider)."""
    pid = provider_id or get_active_provider_id()
    return PROVIDERS.get(pid, PROVIDERS[DEFAULT_PROVIDER])


def get_provider_api_key(provider_id: Optional[str] = None) -> str:
    """Return the API key for the given provider from the environment.

    Gemini uses ``GEMINI_API_KEY``; every other provider uses ``AI_API_KEY``.
    """
    pid = provider_id or get_active_provider_id()
    if pid == "gemini":
        return os.environ.get("GEMINI_API_KEY", "").strip()
    return os.environ.get("AI_API_KEY", "").strip()


def get_provider_model(provider_id: Optional[str] = None) -> str:
    """Return the configured model id for the given provider.

    Gemini reads ``GEMINI_MODEL`` (handled in gemini_service); other providers
    read ``AI_MODEL`` and fall back to the provider's default model.
    """
    pid = provider_id or get_active_provider_id()
    descriptor = get_provider_descriptor(pid)
    if pid == "gemini":
        value = os.environ.get("GEMINI_MODEL", "").strip()
        return value or descriptor["default_model"]
    value = os.environ.get("AI_MODEL", "").strip()
    return value or descriptor["default_model"]


def is_provider_available(provider_id: Optional[str] = None) -> bool:
    """Return True when an API key is configured for the active provider."""
    return bool(get_provider_api_key(provider_id))


def provider_supports_image(provider_id: Optional[str] = None) -> bool:
    """Return True when the provider can generate images (#505).

    Gemini generates via the native SDK (handled in the image route); the
    OpenAI-compatible providers (OpenAI, OpenRouter) carry an ``image_gen``
    descriptor. Text-only providers (DeepSeek, Kimi) return False.
    """
    pid = provider_id or get_active_provider_id()
    if pid == "gemini":
        return True
    return "image_gen" in get_provider_descriptor(pid)


def _image_headers(provider_id: str) -> dict[str, str]:
    api_key = get_provider_api_key(provider_id)
    if not api_key:
        raise ProviderError(f"No API key configured for provider '{provider_id}'.")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    if provider_id == "openrouter":
        headers["HTTP-Referer"] = "https://github.com/hessius/MeticAI"
        headers["X-Title"] = "Metic"
    return headers


def _request_image_sync(
    provider_id: str, endpoint: str, model: str, prompt: str, base_url: str
) -> bytes:
    """Call a single OpenAI-compatible image endpoint and return raw bytes.

    OpenAI uses ``POST /images/generations``; OpenRouter a dedicated
    ``POST /images``. Both return base64 in ``data[0].b64_json``.
    """
    if endpoint == "openai-images":
        path = "/images/generations"
        payload: dict = {"model": model, "prompt": prompt, "n": 1, "size": "1024x1024"}
        # gpt-image-1 always returns base64 and rejects response_format; the
        # dall-e-* models default to a remote URL and need it to return base64.
        if not model.startswith("gpt-image"):
            payload["response_format"] = "b64_json"
    else:
        path = "/images"
        payload = {"model": model, "prompt": prompt}

    try:
        with httpx.Client(timeout=_HTTP_TIMEOUT) as client:
            resp = client.post(
                f"{base_url}{path}",
                headers=_image_headers(provider_id),
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise ProviderImageError(
            None, f"Request to {provider_id} failed: {exc}"
        ) from exc

    if resp.status_code >= 400:
        raise ProviderImageError(
            resp.status_code,
            f"{provider_id} image gen returned {resp.status_code}: {resp.text[:500]}",
        )

    try:
        data = resp.json()
        item = (data.get("data") or [])[0]
        b64 = item.get("b64_json")
    except (KeyError, IndexError, TypeError, ValueError):
        b64 = None
    if not b64:
        raise ProviderImageError(None, f"No image returned by {provider_id}")
    return base64.b64decode(b64)


def _generate_image_bytes_sync(prompt: str, provider_id: str) -> bytes:
    descriptor = get_provider_descriptor(provider_id)
    cfg = descriptor.get("image_gen")
    if not cfg:
        raise ProviderError(
            f"Provider '{provider_id}' does not support image generation."
        )
    base_url = descriptor["base_url"]
    models = cfg["models"]
    last_exc: Optional[ProviderImageError] = None
    for index, model in enumerate(models):
        try:
            return _request_image_sync(
                provider_id, cfg["endpoint"], model, prompt, base_url
            )
        except ProviderImageError as exc:
            last_exc = exc
            is_last = index == len(models) - 1
            # Only fall through to the next model on auth/availability errors
            # (e.g. gpt-image-1 → dall-e-3 when the org isn't verified).
            recoverable = exc.status_code in (401, 403, 404)
            if is_last or not recoverable:
                raise
    if last_exc:
        raise last_exc
    raise ProviderError(f"Image generation failed for provider '{provider_id}'.")


async def generate_image_bytes(prompt: str, provider_id: Optional[str] = None) -> bytes:
    """Generate an image via an OpenAI-compatible provider (#505).

    Returns raw image bytes (PNG/JPEG/WebP). Tries the provider's configured
    image models in order so OpenAI can fall back from ``gpt-image-1`` to
    ``dall-e-3``. Raises :class:`ProviderError` on failure.
    """
    pid = provider_id or get_active_provider_id()
    return await asyncio.to_thread(_generate_image_bytes_sync, prompt, pid)


def _image_to_data_url(image) -> str:
    """Encode a PIL image as a base64 PNG data URL for vision messages."""
    buffer = io.BytesIO()
    fmt = (getattr(image, "format", None) or "PNG").upper()
    if fmt not in ("PNG", "JPEG", "WEBP"):
        fmt = "PNG"
    image.save(buffer, format=fmt)
    mime = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}[fmt]
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def _contents_to_messages(contents, vision: bool) -> list[dict]:
    """Translate Gemini-style ``contents`` into OpenAI chat messages.

    Server callers pass a string, or a (possibly nested) list mixing strings
    and PIL images. Everything is collapsed into a single user message. When the
    provider supports vision, PIL images become ``image_url`` parts; otherwise
    they are dropped (text-only providers cannot accept images).
    """
    # Normalise to a flat list of parts.
    if isinstance(contents, (str, bytes)):
        parts = [contents]
    elif isinstance(contents, list):
        parts = []
        for item in contents:
            if isinstance(item, list):
                parts.extend(item)
            else:
                parts.append(item)
    else:
        parts = [contents]

    text_chunks: list[str] = []
    image_urls: list[str] = []
    for part in parts:
        if part is None:
            continue
        if isinstance(part, str):
            text_chunks.append(part)
        elif hasattr(part, "save") and hasattr(part, "size"):
            # PIL image-like object.
            if vision:
                image_urls.append(_image_to_data_url(part))
            else:
                logger.warning(
                    "Active provider does not support image input; dropping image"
                )
        else:
            text_chunks.append(str(part))

    joined_text = "\n\n".join(c for c in text_chunks if c)

    if image_urls:
        content: list[dict] = []
        if joined_text:
            content.append({"type": "text", "text": joined_text})
        for url in image_urls:
            content.append({"type": "image_url", "image_url": {"url": url}})
        return [{"role": "user", "content": content}]

    return [{"role": "user", "content": joined_text}]


class _OpenAICompatResponse:
    """Minimal response object exposing ``.text`` like the Gemini wrapper."""

    def __init__(self, text: str):
        self.text = text


class OpenAICompatModel:
    """Generate text via an OpenAI-compatible ``/chat/completions`` endpoint.

    Provides the same ``generate_content`` / ``async_generate_content``
    interface as ``gemini_service._GeminiModelWrapper`` so existing call sites
    work unchanged.
    """

    def __init__(self, provider_id: Optional[str] = None):
        self._provider_id = provider_id or get_active_provider_id()
        self._descriptor = get_provider_descriptor(self._provider_id)

    def _headers(self) -> dict[str, str]:
        api_key = get_provider_api_key(self._provider_id)
        if not api_key:
            raise ProviderError(
                f"No API key configured for provider '{self._provider_id}'."
            )
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        }
        if self._provider_id == "openrouter":
            headers["HTTP-Referer"] = "https://github.com/hessius/MeticAI"
            headers["X-Title"] = "Metic"
        return headers

    def generate_content(self, contents) -> _OpenAICompatResponse:
        """Synchronously call the provider's chat-completions endpoint."""
        base_url = self._descriptor["base_url"]
        if not base_url:
            raise ProviderError(
                f"Provider '{self._provider_id}' has no OpenAI-compatible base URL."
            )
        messages = _contents_to_messages(contents, self._descriptor["vision"])
        payload = {"model": get_provider_model(self._provider_id), "messages": messages}
        try:
            with httpx.Client(timeout=_HTTP_TIMEOUT) as client:
                resp = client.post(
                    f"{base_url}/chat/completions",
                    headers=self._headers(),
                    json=payload,
                )
        except httpx.HTTPError as exc:
            raise ProviderError(
                f"Request to {self._provider_id} failed: {exc}"
            ) from exc

        if resp.status_code >= 400:
            raise ProviderError(
                f"{self._provider_id} returned {resp.status_code}: {resp.text[:500]}"
            )
        data = resp.json()
        try:
            text = data["choices"][0]["message"]["content"] or ""
        except (KeyError, IndexError, TypeError) as exc:
            raise ProviderError(
                f"Unexpected response from {self._provider_id}: {str(data)[:500]}"
            ) from exc
        return _OpenAICompatResponse(text)

    async def async_generate_content(self, contents) -> _OpenAICompatResponse:
        """Non-blocking wrapper around :meth:`generate_content`."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self.generate_content, contents)


async def list_provider_models(provider_id: Optional[str] = None) -> list[dict]:
    """Return available models from the provider's ``/models`` endpoint.

    Falls back to the provider's default model on any error so the UI always has
    at least one selectable option.
    """
    pid = provider_id or get_active_provider_id()
    descriptor = get_provider_descriptor(pid)
    base_url = descriptor["base_url"]
    api_key = get_provider_api_key(pid)
    fallback = [
        {
            "id": descriptor["default_model"],
            "display_name": descriptor["default_model"],
            "description": "",
        }
    ]
    if not base_url or not api_key:
        return fallback

    def _fetch() -> list[dict]:
        with httpx.Client(timeout=30.0) as client:
            resp = client.get(
                f"{base_url}/models",
                headers={"Authorization": f"Bearer {api_key}"},
            )
        resp.raise_for_status()
        body = resp.json()
        items = body.get("data", body) if isinstance(body, dict) else body
        result = []
        for item in items or []:
            model_id = item.get("id") if isinstance(item, dict) else None
            if not model_id:
                continue
            result.append(
                {
                    "id": model_id,
                    "display_name": model_id,
                    "description": "",
                }
            )
        return result or fallback

    try:
        return await asyncio.to_thread(_fetch)
    except Exception as exc:  # noqa: BLE001 - degrade gracefully to fallback
        logger.warning("Failed to list models for provider %s: %s", pid, exc)
        return fallback
