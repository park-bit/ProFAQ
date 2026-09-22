"""
PDF ingestion pipeline: parse -> chunk -> embed -> upsert to Qdrant.
"""
from __future__ import annotations

import pathlib
import re
import uuid
from typing import Generator

import fitz  # PyMuPDF
import pdfplumber
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Chunk
from app.services.vector_store import upsert_chunks


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def _extract_pages(file_path: pathlib.Path) -> list[dict]:
    """Return list of {page_no, text, tables} dicts."""
    pages = []
    table_pages: dict[int, list[str]] = {}

    # Extract tables with pdfplumber (better table detection)
    with pdfplumber.open(file_path) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            tables = page.extract_tables()
            if tables:
                rendered = []
                for table in tables:
                    rows = [" | ".join(str(c or "") for c in row) for row in table if row]
                    rendered.append("\n".join(rows))
                table_pages[i] = rendered

    # Extract text with PyMuPDF (layout-aware)
    doc = fitz.open(file_path)
    for i, page in enumerate(doc, start=1):
        text = page.get_text("text").strip()
        pages.append({
            "page_no": i,
            "text": text,
            "tables": table_pages.get(i, []),
        })
    doc.close()

    return pages


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------

def _count_tokens(text: str) -> int:
    # Rough token estimate: words * 1.3
    return int(len(text.split()) * 1.3)


def _chunk_text(text: str, page_no: int, chunk_size: int, chunk_overlap: int) -> list[dict]:
    """Split text into overlapping chunks by token count."""
    words = text.split()
    if not words:
        return []

    chunks = []
    # Convert token budget to word budget
    word_size = int(chunk_size / 1.3)
    word_overlap = int(chunk_overlap / 1.3)

    start = 0
    index = 0
    while start < len(words):
        end = min(start + word_size, len(words))
        chunk_words = words[start:end]
        chunk_text = " ".join(chunk_words)
        chunks.append({
            "text": chunk_text,
            "page_no": page_no,
            "chunk_index": index,
            "chunk_type": "text",
            "token_count": _count_tokens(chunk_text),
        })
        index += 1
        if end == len(words):
            break
        start = end - word_overlap

    return chunks


def _chunk_table(table_text: str, page_no: int, chunk_index: int) -> dict:
    return {
        "text": table_text,
        "page_no": page_no,
        "chunk_index": chunk_index,
        "chunk_type": "table",
        "token_count": _count_tokens(table_text),
    }


def extract_chunks(pages: list[dict], chunk_size: int, chunk_overlap: int) -> list[dict]:
    all_chunks = []
    global_index = 0

    for page in pages:
        # Text chunks
        text_chunks = _chunk_text(page["text"], page["page_no"], chunk_size, chunk_overlap)
        for c in text_chunks:
            c["chunk_index"] = global_index
            global_index += 1
        all_chunks.extend(text_chunks)

        # Table chunks (each table is one chunk)
        for table in page["tables"]:
            if table.strip():
                tc = _chunk_table(table, page["page_no"], global_index)
                all_chunks.append(tc)
                global_index += 1

    return all_chunks


# ---------------------------------------------------------------------------
# Embedding
# ---------------------------------------------------------------------------

_embedder = None


def get_embedder():
    global _embedder
    if _embedder is None:
        from sentence_transformers import SentenceTransformer
        _embedder = SentenceTransformer(settings.embedding_model)
    return _embedder


def embed_texts(texts: list[str]) -> list[list[float]]:
    embedder = get_embedder()
    vectors = embedder.encode(texts, batch_size=64, normalize_embeddings=True, show_progress_bar=False)
    return vectors.tolist()


# ---------------------------------------------------------------------------
# Main ingest entry point
# ---------------------------------------------------------------------------

async def ingest_pdf(
    file_path: pathlib.Path,
    document_version_id: str,
    subject_id: str,
    branch_id: str,
    commit_id: str,
    db: AsyncSession,
    chunk_size: int | None = None,
    chunk_overlap: int | None = None,
) -> tuple[int, int]:
    """Parse, chunk, embed, and index a PDF. Returns (page_count, chunk_count)."""
    pages = _extract_pages(file_path)
    page_count = len(pages)

    eff_chunk_size = chunk_size if chunk_size is not None and chunk_size > 0 else settings.chunk_size
    eff_chunk_overlap = chunk_overlap if chunk_overlap is not None and chunk_overlap >= 0 else settings.chunk_overlap

    raw_chunks = extract_chunks(pages, eff_chunk_size, eff_chunk_overlap)
    if not raw_chunks:
        return page_count, 0

    texts = [c["text"] for c in raw_chunks]
    vectors = embed_texts(texts)

    chunk_records = []
    vector_payloads = []

    for raw, vector in zip(raw_chunks, vectors):
        qdrant_id = str(uuid.uuid4())
        chunk = Chunk(
            document_version_id=document_version_id,
            subject_id=subject_id,
            branch_id=branch_id,
            commit_id=commit_id,
            text=raw["text"],
            page_no=raw["page_no"],
            chunk_index=raw["chunk_index"],
            chunk_type=raw["chunk_type"],
            token_count=raw["token_count"],
            qdrant_id=qdrant_id,
        )
        db.add(chunk)
        chunk_records.append(chunk)
        vector_payloads.append({
            "id": qdrant_id,
            "vector": vector,
            "payload": {
                "chunk_db_id": None,  # filled after flush
                "document_version_id": document_version_id,
                "subject_id": subject_id,
                "branch_id": branch_id,
                "commit_id": commit_id,
                "page_no": raw["page_no"],
                "chunk_type": raw["chunk_type"],
                "text": raw["text"],
            },
        })

    await db.flush()

    # Backfill the DB chunk IDs into the Qdrant payloads
    for chunk, payload in zip(chunk_records, vector_payloads):
        payload["payload"]["chunk_db_id"] = chunk.id

    upsert_chunks(vector_payloads)

    return page_count, len(chunk_records)
