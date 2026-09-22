"""
Hybrid retrieval: BM25 (sparse) + dense (Qdrant) -> merge/dedup -> cross-encoder rerank -> top-k.
"""
from __future__ import annotations

import numpy as np
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models import Chunk
from app.services.ingest import embed_texts
from app.services.vector_store import search_dense

_reranker = None


def get_reranker():
    global _reranker
    if _reranker is None:
        from sentence_transformers import CrossEncoder
        _reranker = CrossEncoder(settings.reranker_model)
    return _reranker


async def _load_commit_chunks(commit_id: str, db: AsyncSession) -> list[Chunk]:
    result = await db.execute(
        select(Chunk).where(Chunk.commit_id == commit_id)
    )
    return result.scalars().all()


def _bm25_search(query: str, chunks: list[Chunk], top_k: int) -> list[dict]:
    if not chunks:
        return []
    import bm25s

    corpus = [c.text for c in chunks]
    tokenized = bm25s.tokenize(corpus)
    retriever = bm25s.BM25()
    retriever.index(tokenized)

    query_tokens = bm25s.tokenize([query])
    results, scores = retriever.retrieve(query_tokens, k=min(top_k, len(chunks)))

    hits = []
    for idx, score in zip(results[0], scores[0]):
        chunk = chunks[idx]
        hits.append({
            "chunk_db_id": chunk.id,
            "qdrant_id": chunk.qdrant_id,
            "text": chunk.text,
            "page_no": chunk.page_no,
            "subject_id": chunk.subject_id,
            "commit_id": chunk.commit_id,
            "document_version_id": chunk.document_version_id,
            "score": float(score),
            "source": "bm25",
        })
    return hits


async def retrieve(
    query: str,
    subject_id: str,
    commit_id: str,
    db: AsyncSession,
) -> list[dict]:
    """
    Full retrieval pipeline:
    1. BM25 top-k from SQLite (text stored there)
    2. Dense top-k from Qdrant
    3. Merge + dedup by chunk_db_id
    4. Cross-encoder rerank -> top RERANK_TOP_K
    """
    # 1. BM25
    commit_chunks = await _load_commit_chunks(commit_id, db)
    bm25_hits = _bm25_search(query, commit_chunks, settings.bm25_top_k)

    # 2. Dense
    query_vector = embed_texts([query])[0]
    dense_hits = search_dense(query_vector, subject_id, commit_id, settings.dense_top_k)

    # 3. Merge + dedup
    seen: set[str] = set()
    merged: list[dict] = []
    for hit in bm25_hits + dense_hits:
        cid = hit.get("chunk_db_id")
        if cid and cid not in seen:
            seen.add(cid)
            merged.append(hit)

    if not merged:
        return []

    # 4. Rerank
    reranker = get_reranker()
    pairs = [(query, h["text"]) for h in merged]
    scores = reranker.predict(pairs)
    for hit, score in zip(merged, scores):
        hit["rerank_score"] = float(score)

    merged.sort(key=lambda x: x["rerank_score"], reverse=True)
    return merged[: settings.rerank_top_k]
