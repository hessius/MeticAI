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
