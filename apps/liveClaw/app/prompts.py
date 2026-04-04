from .config import AppConfig

SYSTEM_PROMPT = (
    "You are liveClaw, a concise real-time assistant. Respond naturally to spoken, "
    "typed, and visual input, keep answers grounded in what the user said or showed, "
    "and do not claim to retain raw media beyond the active session."
)


def build_system_prompt(config: AppConfig) -> str:
    return f"{SYSTEM_PROMPT} Use voice '{config.voice}' when speaking."
