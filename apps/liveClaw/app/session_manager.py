from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from typing import Callable
from uuid import uuid4

from .config import AppConfig
from .state import LiveClawSession, LiveClawSessionState


class SessionManager:
    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._sessions: dict[str, LiveClawSession] = {}
        self._lock = asyncio.Lock()
        self._sweeper_task: asyncio.Task[None] | None = None

    async def create_session(
        self,
        display_name: str,
        session_id: str | None = None,
    ) -> tuple[LiveClawSession, bool]:
        async with self._lock:
            existing = self._sessions.get(session_id or "")
            if existing and not self._is_expired(existing):
                existing.display_name = display_name
                existing.last_seen_at = datetime.now(UTC)
                existing.state = LiveClawSessionState.RECONNECTING
                existing.reconnect_count += 1
                return existing, True

            now = datetime.now(UTC)
            session = LiveClawSession(
                session_id=session_id or str(uuid4()),
                display_name=display_name,
                created_at=now,
                last_seen_at=now,
            )
            self._sessions[session.session_id] = session
            return session, False

    async def get_session(self, session_id: str) -> LiveClawSession | None:
        async with self._lock:
            return self._sessions.get(session_id)

    async def touch_session(self, session_id: str) -> LiveClawSession | None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session.last_seen_at = datetime.now(UTC)
            return session

    async def mark_reconnecting(self, session_id: str) -> LiveClawSession | None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session.state = LiveClawSessionState.RECONNECTING
                session.last_seen_at = datetime.now(UTC)
            return session

    async def mark_connected(self, session_id: str) -> LiveClawSession | None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session.state = LiveClawSessionState.CONNECTED
                session.last_seen_at = datetime.now(UTC)
            return session

    async def record_error(self, session_id: str, error: str) -> LiveClawSession | None:
        async with self._lock:
            session = self._sessions.get(session_id)
            if session:
                session.state = LiveClawSessionState.ERROR
                session.last_error = error
                session.last_seen_at = datetime.now(UTC)
            return session

    async def end_session(self, session_id: str) -> LiveClawSession | None:
        async with self._lock:
            session = self._sessions.pop(session_id, None)
            if session:
                session.state = LiveClawSessionState.CLOSED
            return session

    async def sweep_expired_sessions(
        self,
        on_expire: Callable[[LiveClawSession], object] | None = None,
    ) -> list[LiveClawSession]:
        expired: list[LiveClawSession] = []
        async with self._lock:
            for session_id, session in list(self._sessions.items()):
                if self._is_expired(session):
                    session.state = LiveClawSessionState.CLOSED
                    expired.append(session)
                    self._sessions.pop(session_id, None)

        if on_expire:
            for session in expired:
                await on_expire(session)
        return expired

    async def start_sweeper(
        self,
        on_expire: Callable[[LiveClawSession], object] | None = None,
    ) -> None:
        if self._sweeper_task:
            return

        async def sweep_loop() -> None:
            while True:
                await asyncio.sleep(5)
                await self.sweep_expired_sessions(on_expire=on_expire)

        self._sweeper_task = asyncio.create_task(sweep_loop())

    async def stop_sweeper(self) -> None:
        if not self._sweeper_task:
            return
        self._sweeper_task.cancel()
        try:
            await self._sweeper_task
        except asyncio.CancelledError:
            pass
        self._sweeper_task = None

    def _is_expired(self, session: LiveClawSession) -> bool:
        return datetime.now(UTC) - session.last_seen_at > timedelta(
            seconds=self._config.session_grace_seconds
        )
