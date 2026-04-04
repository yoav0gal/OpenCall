from app.bot import build_bot_config_snapshot
from app.config import AppConfig


def test_context_policy_enables_compression_and_keeps_raw_media_out():
    config = AppConfig(
        GOOGLE_API_KEY="test-key",
        LIVECLAW_CONTEXT_TRIGGER_TOKENS=12345,
    )

    snapshot = build_bot_config_snapshot(config)

    assert snapshot["context_window_compression"]["enabled"] is True
    assert snapshot["context_window_compression"]["trigger_tokens"] == 12345
    assert snapshot["raw_media_in_context"] is False
