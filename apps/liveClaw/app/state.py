from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any


class LiveClawSessionState(StrEnum):
    CREATED = "created"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"
    CLOSED = "closed"
    ERROR = "error"


@dataclass
class LiveClawSession:
    session_id: str
    display_name: str
    created_at: datetime
    last_seen_at: datetime
    state: LiveClawSessionState = LiveClawSessionState.CREATED
    reconnect_count: int = 0
    last_error: str | None = None
    transport: Any = None
    bot_task: Any = None
    request_handler: Any = None
    runner: Any = None
    diagnostics: list[dict[str, Any]] = field(default_factory=list)
    transcripts: list[dict[str, Any]] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)
