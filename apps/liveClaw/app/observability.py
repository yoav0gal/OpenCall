from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Any

from .state import LiveClawSession


def setup_logging(level: str) -> logging.Logger:
    logging.basicConfig(
        level=getattr(logging, level.upper(), logging.INFO),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    return logging.getLogger("liveclaw")


def _payload(event: str, session: LiveClawSession, **details: Any) -> dict[str, Any]:
    return {
        "timestamp": datetime.now(UTC).isoformat(),
        "event": event,
        "session_id": session.session_id,
        "state": session.state.value,
        **details,
    }


def append_diagnostic(session: LiveClawSession, event: str, **details: Any) -> dict[str, Any]:
    entry = _payload(event, session, **details)
    session.diagnostics.append(entry)
    return entry


def log_session_started(logger: logging.Logger, session: LiveClawSession) -> None:
    logger.info("session.started %s", append_diagnostic(session, "session.started"))


def log_transport_connected(logger: logging.Logger, session: LiveClawSession) -> None:
    logger.info("transport.connected %s", append_diagnostic(session, "transport.connected"))


def log_transport_disconnected(logger: logging.Logger, session: LiveClawSession) -> None:
    logger.info("transport.disconnected %s", append_diagnostic(session, "transport.disconnected"))


def log_gemini_connected(logger: logging.Logger, session: LiveClawSession) -> None:
    logger.info("gemini.connected %s", append_diagnostic(session, "gemini.connected"))


def log_gemini_resumed(logger: logging.Logger, session: LiveClawSession) -> None:
    logger.info("gemini.resumed %s", append_diagnostic(session, "gemini.resumed"))


def log_context_compression(
    logger: logging.Logger,
    session: LiveClawSession,
    trigger_tokens: int,
) -> None:
    logger.info(
        "context.compression %s",
        append_diagnostic(
            session,
            "context.compression",
            trigger_tokens=trigger_tokens,
        ),
    )


def log_session_closed(logger: logging.Logger, session: LiveClawSession) -> None:
    logger.info("session.closed %s", append_diagnostic(session, "session.closed"))


def log_error(logger: logging.Logger, session: LiveClawSession, error: str) -> None:
    logger.error("session.error %s", append_diagnostic(session, "session.error", error=error))
