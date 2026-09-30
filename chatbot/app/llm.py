"""Chat model for the configured provider (LangChain), or None for the offline "none" provider."""

from __future__ import annotations

from langchain_core.language_models import BaseChatModel

from .config import Settings


def get_chat_model(settings: Settings) -> BaseChatModel | None:
    if settings.llm_provider == "none":
        return None
    if settings.llm_provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model=settings.llm_model, temperature=settings.llm_temperature, max_tokens=700)
    if settings.llm_provider == "openai":
        from langchain_openai import ChatOpenAI

        return ChatOpenAI(model=settings.llm_model, temperature=settings.llm_temperature, max_tokens=700)
    from langchain_ollama import ChatOllama

    return ChatOllama(
        model=settings.llm_model, temperature=settings.llm_temperature, base_url=settings.ollama_base_url
    )
