"""Ingestion pipeline: curated reference docs -> chunks -> persisted vector index.

Run directly to (re)build the index:
    python -m app.knowledge.ingest

Supported source formats in app/knowledge/sources/:
  * .md / .txt  — chunked by paragraph
  * .pdf        — text extracted via pypdf (lazy import), chunked by paragraph

This is the "external source" adapter. Today it ingests the curated sample docs
shipped in sources/. To use real references, drop vet-reviewed FAO / USDA /
extension PDFs or markdown into sources/ and re-run.
"""
from __future__ import annotations

import re
from pathlib import Path

from .. import config
from .store import Chunk, VectorStore

_MAX_CHARS = 1800  # paragraph-pack target for large docs
_WHOLE_DOC_MAX = 4000  # keep a source whole below this — one disease doc = one chunk


def _title_from(path: Path, text: str) -> str:
    m = re.search(r"^#\s+(.+)$", text, flags=re.MULTILINE)
    if m:
        return m.group(1).strip()
    return path.stem.replace("_", " ").replace("-", " ").title()


def _read_text(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        try:
            from pypdf import PdfReader
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("pypdf is required to ingest PDF sources") from e
        reader = PdfReader(str(path))
        return "\n\n".join((page.extract_text() or "") for page in reader.pages)
    return path.read_text(encoding="utf-8")


def _chunk(text: str) -> list[str]:
    """Chunk a source document.

    A single disease reference is kept WHOLE (below _WHOLE_DOC_MAX) so its symptoms
    and its treatment/drug section never land in separate chunks. Otherwise a
    symptom-driven query retrieves the symptom chunk while the drug names sit in an
    un-retrieved sibling chunk — which is exactly how a cited drug (e.g. amprolium)
    silently went missing. Larger docs (multi-disease PDFs) fall back to paragraph
    packing no larger than _MAX_CHARS.
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= _WHOLE_DOC_MAX:
        return [text]
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks: list[str] = []
    buf = ""
    for p in paras:
        if len(buf) + len(p) + 2 <= _MAX_CHARS:
            buf = f"{buf}\n\n{p}" if buf else p
        else:
            if buf:
                chunks.append(buf)
            # a single very long paragraph gets hard-split
            if len(p) > _MAX_CHARS:
                for i in range(0, len(p), _MAX_CHARS):
                    chunks.append(p[i : i + _MAX_CHARS])
                buf = ""
            else:
                buf = p
    if buf:
        chunks.append(buf)
    return chunks


def collect_chunks(sources_dir: Path) -> list[Chunk]:
    chunks: list[Chunk] = []
    files = sorted(
        p
        for p in sources_dir.glob("*")
        if p.suffix.lower() in {".md", ".txt", ".pdf"} and not p.name.startswith("_")
    )
    for path in files:
        text = _read_text(path)
        title = _title_from(path, text)
        for i, body in enumerate(_chunk(text)):
            chunks.append(
                Chunk(id=f"{path.name}#{i}", title=title, ref=f"{path.name}#{i}", text=body)
            )
    return chunks


def build_index(sources_dir: Path | None = None, index_path: Path | None = None) -> VectorStore:
    sources_dir = sources_dir or config.SOURCES_DIR
    index_path = index_path or config.INDEX_PATH
    chunks = collect_chunks(sources_dir)
    store = VectorStore()
    store.build(chunks)
    store.save(index_path)
    return store


if __name__ == "__main__":
    store = build_index()
    print(f"Indexed {len(store)} chunks from {config.SOURCES_DIR} -> {config.INDEX_PATH}")
