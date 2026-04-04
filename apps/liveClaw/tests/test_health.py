from fastapi.testclient import TestClient

from app.config import get_config


def test_health_returns_ok(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    get_config.cache_clear()
    from app.main import create_app

    client = TestClient(create_app())

    response = client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True, "status": "ok"}


def test_client_config_omits_secrets(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "super-secret")
    get_config.cache_clear()
    from app.main import create_app

    client = TestClient(create_app())

    response = client.get("/api/config")
    payload = response.json()

    assert response.status_code == 200
    assert "google_api_key" not in payload
    assert "GOOGLE_API_KEY" not in payload
    assert payload["model"] == "gemini-3.1-flash-live-preview"
    assert payload["media_resolution"] == "low"
