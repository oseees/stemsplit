"""Knowledge-base access. Lazily loads (or builds) the persisted vector index."""
from __future__ import annotations

from .. import config
from .ingest import build_index
from .store import VectorStore

_store: VectorStore | None = None


def get_store() -> VectorStore:
    global _store
    if _store is None:
        _store = VectorStore()
        if config.INDEX_PATH.exists():
            _store.load(config.INDEX_PATH)
        else:
            _store = build_index()
    return _store


def reload_store() -> VectorStore:
    """Rebuild the index from sources/ and refresh the in-memory store."""
    global _store
    _store = build_index()
    return _store
