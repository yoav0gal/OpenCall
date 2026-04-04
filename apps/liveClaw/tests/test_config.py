import pytest

from app.config import AppConfig, get_config


def test_missing_google_api_key_fails(monkeypatch):
    monkeypatch.delenv("GOOGLE_API_KEY", raising=False)
    get_config.cache_clear()

    with pytest.raises(Exception):
        AppConfig(_env_file=None)


def test_defaults_load_correctly(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    get_config.cache_clear()

    config = AppConfig()

    assert config.host == "127.0.0.1"
    assert config.port == 8010
    assert config.voice == "Charon"
    assert config.model == "gemini-3.1-flash-live-preview"


def test_model_name_normalizes_models_prefix(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("LIVECLAW_MODEL", "models/gemini-3.1-flash-live-preview")
    get_config.cache_clear()

    config = AppConfig()

    assert config.model == "gemini-3.1-flash-live-preview"


def test_trigger_token_threshold_parses(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    monkeypatch.setenv("LIVECLAW_CONTEXT_TRIGGER_TOKENS", "32000")
    get_config.cache_clear()

    config = AppConfig()

    assert config.context_trigger_tokens == 32000
