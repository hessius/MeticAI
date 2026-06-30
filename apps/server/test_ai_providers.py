"""Tests for the OpenAI-compatible AI provider layer (#491 PR3)."""

import os
from unittest.mock import patch

import pytest
from PIL import Image

import services.ai_providers as ai_providers
from services.ai_providers import (
    DEFAULT_PROVIDER,
    OpenAICompatModel,
    ProviderError,
    _contents_to_messages,
    get_active_provider_id,
    get_provider_api_key,
    get_provider_model,
    is_gemini_active,
    is_provider_available,
)


class TestActiveProvider:
    @patch.dict(os.environ, {}, clear=True)
    def test_defaults_to_gemini(self):
        assert get_active_provider_id() == DEFAULT_PROVIDER
        assert is_gemini_active() is True

    @patch.dict(os.environ, {"AI_PROVIDER": "openai"}, clear=True)
    def test_reads_env(self):
        assert get_active_provider_id() == "openai"
        assert is_gemini_active() is False

    @patch.dict(os.environ, {"AI_PROVIDER": "not-a-provider"}, clear=True)
    def test_unknown_falls_back_to_gemini(self):
        assert get_active_provider_id() == DEFAULT_PROVIDER

    @patch.dict(os.environ, {"AI_PROVIDER": "OpenAI"}, clear=True)
    def test_case_insensitive(self):
        assert get_active_provider_id() == "openai"


class TestProviderCredentials:
    @patch.dict(os.environ, {"GEMINI_API_KEY": "gkey"}, clear=True)
    def test_gemini_uses_gemini_key(self):
        assert get_provider_api_key("gemini") == "gkey"

    @patch.dict(
        os.environ,
        {"AI_PROVIDER": "deepseek", "AI_API_KEY": "dkey"},
        clear=True,
    )
    def test_non_gemini_uses_ai_key(self):
        assert get_provider_api_key() == "dkey"
        assert is_provider_available() is True

    @patch.dict(os.environ, {"AI_PROVIDER": "openai"}, clear=True)
    def test_missing_key_unavailable(self):
        assert is_provider_available() is False

    @patch.dict(
        os.environ,
        {"AI_PROVIDER": "openai", "AI_MODEL": "gpt-4o"},
        clear=True,
    )
    def test_model_from_env(self):
        assert get_provider_model() == "gpt-4o"

    @patch.dict(os.environ, {"AI_PROVIDER": "deepseek"}, clear=True)
    def test_model_falls_back_to_default(self):
        assert get_provider_model() == "deepseek-chat"


class TestContentsTranslation:
    def test_string_to_single_user_message(self):
        msgs = _contents_to_messages("hello", vision=True)
        assert msgs == [{"role": "user", "content": "hello"}]

    def test_nested_list_flattened(self):
        msgs = _contents_to_messages([["a", "b"]], vision=True)
        assert msgs[0]["content"] == "a\n\nb"

    def test_image_with_vision_provider(self):
        img = Image.new("RGB", (2, 2), color="red")
        msgs = _contents_to_messages(["describe", img], vision=True)
        content = msgs[0]["content"]
        assert isinstance(content, list)
        assert content[0] == {"type": "text", "text": "describe"}
        assert content[1]["type"] == "image_url"
        assert content[1]["image_url"]["url"].startswith("data:image/")

    def test_image_dropped_for_text_only_provider(self):
        img = Image.new("RGB", (2, 2), color="blue")
        msgs = _contents_to_messages(["describe", img], vision=False)
        assert msgs == [{"role": "user", "content": "describe"}]


class TestOpenAICompatModel:
    @patch.dict(
        os.environ,
        {"AI_PROVIDER": "openai", "AI_API_KEY": "k", "AI_MODEL": "gpt-4o-mini"},
        clear=True,
    )
    def test_generate_content_parses_response(self):
        class _Resp:
            status_code = 200

            @staticmethod
            def json():
                return {"choices": [{"message": {"content": "the answer"}}]}

        class _Client:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def post(self, url, headers, json):
                assert url.endswith("/chat/completions")
                assert headers["Authorization"] == "Bearer k"
                assert json["model"] == "gpt-4o-mini"
                return _Resp()

        with patch.object(ai_providers.httpx, "Client", _Client):
            model = OpenAICompatModel()
            resp = model.generate_content("hi")
        assert resp.text == "the answer"

    @patch.dict(os.environ, {"AI_PROVIDER": "openai"}, clear=True)
    def test_missing_key_raises(self):
        model = OpenAICompatModel()
        with pytest.raises(ProviderError):
            model.generate_content("hi")

    @patch.dict(
        os.environ,
        {"AI_PROVIDER": "openai", "AI_API_KEY": "k"},
        clear=True,
    )
    def test_http_error_status_raises(self):
        class _Resp:
            status_code = 401
            text = "unauthorized"

        class _Client:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def post(self, url, headers, json):
                return _Resp()

        with patch.object(ai_providers.httpx, "Client", _Client):
            model = OpenAICompatModel()
            with pytest.raises(ProviderError):
                model.generate_content("hi")

    @patch.dict(
        os.environ,
        {"AI_PROVIDER": "openrouter", "AI_API_KEY": "k"},
        clear=True,
    )
    def test_openrouter_referer_headers(self):
        model = OpenAICompatModel()
        headers = model._headers()
        assert "HTTP-Referer" in headers
        assert headers["X-Title"] == "Metic"

    @patch.dict(
        os.environ,
        {"AI_PROVIDER": "openai", "AI_API_KEY": "k"},
        clear=True,
    )
    @pytest.mark.asyncio
    async def test_async_generate_content(self):
        class _Resp:
            status_code = 200

            @staticmethod
            def json():
                return {"choices": [{"message": {"content": "async answer"}}]}

        class _Client:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def post(self, url, headers, json):
                return _Resp()

        with patch.object(ai_providers.httpx, "Client", _Client):
            model = OpenAICompatModel()
            resp = await model.async_generate_content("hi")
        assert resp.text == "async answer"


class TestGeminiServiceDelegation:
    @patch.dict(
        os.environ,
        {"AI_PROVIDER": "openai", "AI_API_KEY": "k", "AI_MODEL": "gpt-4o"},
        clear=True,
    )
    def test_get_vision_model_returns_compat_for_non_gemini(self):
        import importlib
        import services.gemini_service as gemini_service

        importlib.reload(gemini_service)
        model = gemini_service.get_vision_model()
        assert isinstance(model, OpenAICompatModel)
        assert gemini_service.get_model_name() == "gpt-4o"
        assert gemini_service.is_ai_available() is True


def _b64_png() -> str:
    """A 1x1 PNG encoded as base64 (valid for base64.b64decode)."""
    import base64
    import io

    buf = io.BytesIO()
    Image.new("RGB", (1, 1), (10, 20, 30)).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


class _ImgResp:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text

    def json(self):
        return self._payload


def _img_client_factory(responses):
    """Build a fake httpx.Client yielding queued responses per POST call."""
    calls = {"posts": []}

    class _Client:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def post(self, url, headers, json):
            calls["posts"].append({"url": url, "model": json.get("model")})
            return responses.pop(0)

    return _Client, calls


class TestImageGeneration:
    @patch.dict(
        os.environ,
        {"AI_PROVIDER": "openai", "AI_API_KEY": "k"},
        clear=True,
    )
    def test_openai_image_success_returns_bytes(self):
        from services.ai_providers import _generate_image_bytes_sync

        b64 = _b64_png()
        client, calls = _img_client_factory(
            [_ImgResp(200, {"data": [{"b64_json": b64}]})]
        )
        with patch.object(ai_providers.httpx, "Client", client):
            data = _generate_image_bytes_sync("a cat", "openai")
        assert isinstance(data, bytes) and len(data) > 0
        # gpt-image-1 is tried first; no response_format fallback needed.
        assert calls["posts"][0]["model"] == "gpt-image-1"

    @patch.dict(
        os.environ,
        {"AI_PROVIDER": "openai", "AI_API_KEY": "k"},
        clear=True,
    )
    def test_falls_back_to_next_model_on_403(self):
        from services.ai_providers import _generate_image_bytes_sync

        b64 = _b64_png()
        # gpt-image-1 → 403 (org not verified), then dall-e-3 → success.
        client, calls = _img_client_factory(
            [
                _ImgResp(403, text="org must be verified"),
                _ImgResp(200, {"data": [{"b64_json": b64}]}),
            ]
        )
        with patch.object(ai_providers.httpx, "Client", client):
            data = _generate_image_bytes_sync("a cat", "openai")
        assert isinstance(data, bytes) and len(data) > 0
        assert [p["model"] for p in calls["posts"]] == ["gpt-image-1", "dall-e-3"]

    @patch.dict(
        os.environ,
        {"AI_PROVIDER": "openai", "AI_API_KEY": "k"},
        clear=True,
    )
    def test_non_recoverable_status_raises_without_fallback(self):
        from services.ai_providers import ProviderImageError, _generate_image_bytes_sync

        # 500 is not in the recoverable set → raise immediately, no fallback.
        client, calls = _img_client_factory([_ImgResp(500, text="server error")])
        with patch.object(ai_providers.httpx, "Client", client):
            with pytest.raises(ProviderImageError):
                _generate_image_bytes_sync("a cat", "openai")
        assert len(calls["posts"]) == 1

    @patch.dict(os.environ, {"AI_PROVIDER": "deepseek", "AI_API_KEY": "k"}, clear=True)
    def test_unsupported_provider_raises(self):
        from services.ai_providers import ProviderError, _generate_image_bytes_sync

        with pytest.raises(ProviderError):
            _generate_image_bytes_sync("a cat", "deepseek")


class TestListProviderModels:
    @patch.dict(os.environ, {"AI_PROVIDER": "openai", "AI_API_KEY": "k"}, clear=True)
    async def test_parses_data_envelope(self):
        from services.ai_providers import list_provider_models

        class _Resp:
            status_code = 200

            @staticmethod
            def raise_for_status():
                return None

            @staticmethod
            def json():
                return {"data": [{"id": "gpt-4o"}, {"id": "gpt-4o-mini"}, {"no": "id"}]}

        class _Client:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def get(self, url, headers):
                assert url.endswith("/models")
                return _Resp()

        with patch.object(ai_providers.httpx, "Client", _Client):
            models = await list_provider_models("openai")
        ids = [m["id"] for m in models]
        assert ids == ["gpt-4o", "gpt-4o-mini"]

    @patch.dict(os.environ, {"AI_PROVIDER": "openai", "AI_API_KEY": "k"}, clear=True)
    async def test_falls_back_to_default_on_error(self):
        from services.ai_providers import list_provider_models

        class _Client:
            def __init__(self, *a, **k):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def get(self, url, headers):
                raise ai_providers.httpx.HTTPError("boom")

        with patch.object(ai_providers.httpx, "Client", _Client):
            models = await list_provider_models("openai")
        assert models == [
            {"id": "gpt-4o-mini", "display_name": "gpt-4o-mini", "description": ""}
        ]

    @patch.dict(os.environ, {"AI_PROVIDER": "openai"}, clear=True)
    async def test_no_api_key_returns_fallback(self):
        from services.ai_providers import list_provider_models

        models = await list_provider_models("openai")
        assert models[0]["id"] == "gpt-4o-mini"
