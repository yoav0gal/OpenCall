from typing import Any

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    ok: bool = True
    status: str = "ok"


class ClientConfigResponse(BaseModel):
    app_name: str = "liveClaw"
    host: str
    port: int
    model: str
    voice: str
    reconnect_grace_seconds: int
    media_resolution: str


class StartSessionRequest(BaseModel):
    display_name: str = Field(default="Browser User")
    session_id: str | None = None


class StartSessionResponse(BaseModel):
    session_id: str
    reused: bool = False
    state: str
    offer_url: str
    ice_servers: list[dict[str, Any]] = Field(default_factory=list)
    diagnostics: list[dict[str, Any]] = Field(default_factory=list)
    transcripts: list[dict[str, Any]] = Field(default_factory=list)


class EndSessionRequest(BaseModel):
    session_id: str


class TextMessageRequest(BaseModel):
    session_id: str
    text: str
