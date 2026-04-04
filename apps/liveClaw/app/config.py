from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class AppConfig(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent.parent / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    google_api_key: str = Field(alias="GOOGLE_API_KEY")
    host: str = Field(default="127.0.0.1", alias="LIVECLAW_HOST")
    port: int = Field(default=8010, alias="LIVECLAW_PORT")
    model: str = Field(
        default="gemini-3.1-flash-live-preview",
        alias="LIVECLAW_MODEL",
    )
    voice: str = Field(default="Charon", alias="LIVECLAW_VOICE")
    session_grace_seconds: int = Field(default=90, alias="LIVECLAW_SESSION_GRACE_SECONDS")
    context_trigger_tokens: int = Field(default=24000, alias="LIVECLAW_CONTEXT_TRIGGER_TOKENS")
    media_resolution: str = Field(default="low", alias="LIVECLAW_MEDIA_RESOLUTION")
    log_level: str = Field(default="INFO", alias="LIVECLAW_LOG_LEVEL")

    @field_validator("google_api_key")
    @classmethod
    def validate_google_api_key(cls, value: str) -> str:
        if not value or not value.strip():
            raise ValueError("GOOGLE_API_KEY is required")
        return value.strip()

    @field_validator("session_grace_seconds", "context_trigger_tokens")
    @classmethod
    def validate_positive_ints(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("value must be greater than zero")
        return value

    @field_validator("model")
    @classmethod
    def normalize_model_name(cls, value: str) -> str:
        normalized = value.strip()
        return normalized.removeprefix("models/")


@lru_cache(maxsize=1)
def get_config() -> AppConfig:
    return AppConfig()
