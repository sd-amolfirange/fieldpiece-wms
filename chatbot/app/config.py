"""Settings, read from the environment (and `.env`). See `.env.example` for what each one does."""

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    llm_provider: Literal["anthropic", "openai", "ollama", "none"] = "none"
    llm_model: str = "claude-sonnet-5"
    llm_temperature: float = 0.1
    ollama_base_url: str = "http://localhost:11434"

    embeddings_provider: Literal["hash", "openai", "ollama"] = "hash"
    embeddings_model: str = "text-embedding-3-small"

    database_url: str = "postgresql://chatbot:chatbot_local@localhost:5434/chatbot_kb"
    retrieval_top_k: int = 5
    retrieval_min_score: float = 0.2

    wms_api_url: str = "http://localhost:8088/api"

    port: int = 8090
    cors_origins: str = "http://localhost:8088,http://localhost:5173"
    max_input_chars: int = 1500
    rate_limit_per_minute: int = 20

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
