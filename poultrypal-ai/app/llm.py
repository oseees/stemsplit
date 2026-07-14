"""Thin Anthropic client accessor."""
from __future__ import annotations

from . import config


class LLMUnavailable(RuntimeError):
    """Raised when an LLM call is attempted without an API key configured."""


_client = None


def get_client():
    global _client
    if not config.has_api_key():
        raise LLMUnavailable(
            "ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key "
            "to enable AI diagnosis (knowledge retrieval still works without it)."
        )
    if _client is None:
        import anthropic

        _client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client
