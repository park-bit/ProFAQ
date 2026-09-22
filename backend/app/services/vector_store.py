"""
Qdrant client wrapper.
Collection name: profaq_chunks
Metadata filter keys: subject_id, branch_id, commit_id
"""
from __future__ import annotations

from qdrant_client import QdrantClient
from qdrant_client.models import (
    Distance,
    VectorParams,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue,
)

from app.config import settings

COLLECTION = "profaq_chunks"
VECTOR_SIZE = 384  # bge-small-en-v1.5

_client: QdrantClient | None = None


def get_client() -> QdrantClient:
    global _client
    if _client is None:
        _client = QdrantClient(host=settings.qdrant_host, port=settings.qdrant_port)
        _ensure_collection(_client)
    return _client


def _ensure_collection(client: QdrantClient) -> None:
    existing = {c.name for c in client.get_collections().collections}
    if COLLECTION not in existing:
        client.create_collection(
            collection_name=COLLECTION,
            vectors_config=VectorParams(size=VECTOR_SIZE, distance=Distance.COSINE),
        )


def upsert_chunks(payloads: list[dict]) -> None:
    """Upsert a batch of {id, vector, payload} dicts into Qdrant."""
    client = get_client()
    points = [
        PointStruct(id=p["id"], vector=p["vector"], payload=p["payload"])
        for p in payloads
    ]
    client.upsert(collection_name=COLLECTION, points=points, wait=True)


def search_dense(
    query_vector: list[float],
    subject_id: str,
    commit_id: str,
    top_k: int,
) -> list[dict]:
    client = get_client()
    results = client.search(
        collection_name=COLLECTION,
        query_vector=query_vector,
        query_filter=Filter(
            must=[
                FieldCondition(key="subject_id", match=MatchValue(value=subject_id)),
                FieldCondition(key="commit_id", match=MatchValue(value=commit_id)),
            ]
        ),
        limit=top_k,
        with_payload=True,
    )
    return [
        {
            "qdrant_id": r.id,
            "score": r.score,
            **r.payload,
        }
        for r in results
    ]


def delete_by_commit(commit_id: str) -> None:
    """Remove all vectors for a specific commit (used when a commit is pruned)."""
    client = get_client()
    client.delete(
        collection_name=COLLECTION,
        points_selector=Filter(
            must=[FieldCondition(key="commit_id", match=MatchValue(value=commit_id))]
        ),
    )
