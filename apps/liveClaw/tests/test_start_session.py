from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import get_config


def test_start_session_returns_session_id_and_bootstrap_fields(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    get_config.cache_clear()
    from app.main import create_app

    app = create_app()

    async def fake_create_bot(session, config, logger):
        return SimpleNamespace(
            request_handler=SimpleNamespace(),
            runner=None,
            task=None,
            transport=None,
            context=None,
            config_snapshot={
                "context_window_compression": {"enabled": True, "trigger_tokens": 24000},
                "raw_media_in_context": False,
            },
        )

    monkeypatch.setattr("app.main.create_bot", fake_create_bot)
    client = TestClient(app)

    response = client.post("/api/session/start", json={"display_name": "Test Browser"})
    payload = response.json()

    assert response.status_code == 200
    assert payload["session_id"]
    assert payload["offer_url"].endswith(f"/api/session/{payload['session_id']}/offer")
    assert payload["ice_servers"]


def test_start_session_stores_session_in_manager(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "test-key")
    get_config.cache_clear()
    from app.main import create_app

    app = create_app()

    async def fake_create_bot(session, config, logger):
        return SimpleNamespace(
            request_handler=SimpleNamespace(),
            runner=None,
            task=None,
            transport=None,
            context=None,
            config_snapshot={},
        )

    monkeypatch.setattr("app.main.create_bot", fake_create_bot)
    client = TestClient(app)

    response = client.post("/api/session/start", json={"display_name": "Stored Browser"})
    session_id = response.json()["session_id"]
    session = client.app.state.session_manager._sessions[session_id]

    assert session.session_id == session_id
    assert session.display_name == "Stored Browser"
