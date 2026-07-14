"""A small, dependency-free vector store for the knowledge base.

The retrieval contract here is identical to an embedding-backed vector DB
(chunk -> vector -> cosine similarity -> top-k passages with citations). The
default `Embedder` is a TF-IDF embedder so the whole thing runs with just numpy
— no torch, no onnxruntime, no model download. To upgrade to semantic search
later, implement the `Embedder` protocol with sentence-transformers / Voyage /
Chroma and pass it to `VectorStore`; nothing else changes.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

_TOKEN_RE = re.compile(r"[a-z0-9]+")
_STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "is", "are", "for", "on",
    "with", "as", "by", "at", "be", "this", "that", "it", "from", "may", "can",
    "will", "if", "but", "not", "no", "so", "than", "then", "which", "these",
    "their", "they", "its", "also", "such", "into", "have", "has", "was", "were",
}


def tokenize(text: str) -> list[str]:
    return [t for t in _TOKEN_RE.findall(text.lower()) if len(t) > 2 and t not in _STOPWORDS]


@dataclass
class Chunk:
    """One retrievable passage and where it came from (for citations)."""
    id: str
    title: str        # human-readable source title, e.g. "Coccidiosis"
    ref: str          # citation ref, e.g. "coccidiosis.md#2"
    text: str


class Embedder(Protocol):
    """Swap this out to change how passages become vectors."""

    def fit(self, corpus: list[str]) -> None: ...
    def transform(self, texts: list[str]) -> np.ndarray: ...
    def state(self) -> dict: ...
    @classmethod
    def from_state(cls, state: dict) -> "Embedder": ...


class TfidfEmbedder:
    """Classic TF-IDF with smoothed idf and L2-normalised rows (cosine-ready)."""

    def __init__(self, vocab: dict[str, int] | None = None, idf: np.ndarray | None = None):
        self.vocab = vocab or {}
        self.idf = idf if idf is not None else np.zeros(0)

    def fit(self, corpus: list[str]) -> None:
        vocab: dict[str, int] = {}
        df: dict[int, int] = {}
        for doc in corpus:
            seen = set()
            for tok in tokenize(doc):
                idx = vocab.setdefault(tok, len(vocab))
                if idx not in seen:
                    df[idx] = df.get(idx, 0) + 1
                    seen.add(idx)
        n = max(len(corpus), 1)
        idf = np.zeros(len(vocab))
        for idx, d in df.items():
            idf[idx] = math.log((1 + n) / (1 + d)) + 1.0
        self.vocab = vocab
        self.idf = idf

    def transform(self, texts: list[str]) -> np.ndarray:
        mat = np.zeros((len(texts), len(self.vocab)), dtype=np.float32)
        for r, text in enumerate(texts):
            for tok in tokenize(text):
                idx = self.vocab.get(tok)
                if idx is not None:
                    mat[r, idx] += 1.0
        mat *= self.idf  # tf * idf
        norms = np.linalg.norm(mat, axis=1, keepdims=True)
        norms[norms == 0] = 1.0
        return mat / norms

    def state(self) -> dict:
        return {"vocab": self.vocab, "idf": self.idf.tolist()}

    @classmethod
    def from_state(cls, state: dict) -> "TfidfEmbedder":
        return cls(vocab=state["vocab"], idf=np.asarray(state["idf"], dtype=np.float32))


class VectorStore:
    def __init__(self, embedder: Embedder | None = None):
        self.embedder: Embedder = embedder or TfidfEmbedder()
        self.chunks: list[Chunk] = []
        self._matrix: np.ndarray | None = None

    # -- build / persist ----------------------------------------------------
    def build(self, chunks: list[Chunk]) -> None:
        self.chunks = chunks
        corpus = [c.text for c in chunks]
        self.embedder.fit(corpus)
        self._matrix = self.embedder.transform(corpus)

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "embedder": self.embedder.state(),
            "chunks": [asdict(c) for c in self.chunks],
        }
        path.write_text(json.dumps(payload), encoding="utf-8")

    def load(self, path: Path) -> None:
        payload = json.loads(path.read_text(encoding="utf-8"))
        self.embedder = TfidfEmbedder.from_state(payload["embedder"])
        self.chunks = [Chunk(**c) for c in payload["chunks"]]
        self._matrix = self.embedder.transform([c.text for c in self.chunks])

    # -- query --------------------------------------------------------------
    def query(self, text: str, k: int) -> list[tuple[Chunk, float]]:
        if self._matrix is None or not self.chunks:
            return []
        q = self.embedder.transform([text])[0]
        scores = self._matrix @ q  # cosine (rows + query are L2-normalised)
        order = np.argsort(scores)[::-1][:k]
        return [(self.chunks[i], float(scores[i])) for i in order if scores[i] > 0]

    def __len__(self) -> int:
        return len(self.chunks)
