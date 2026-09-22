import time
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Subject, Branch, Commit, DocumentVersion, QueryLog
from app.schemas import QueryRequest, QueryResponse, CitationOut
from app.services.retrieval import retrieve
from app.services.generator import generate_answer
from app.services.grounding import check_grounding
from app.config import settings

router = APIRouter()


async def _resolve_commit(subject_id: str, branch_id: str | None, commit_id: str | None, db: AsyncSession) -> tuple[str, str]:
    """Returns (resolved_branch_id, resolved_commit_id)."""
    subject = (await db.execute(select(Subject).where(Subject.id == subject_id))).scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    active_branch_id = branch_id or subject.current_branch_id
    branch = (await db.execute(select(Branch).where(Branch.id == active_branch_id))).scalar_one_or_none()
    if not branch:
        raise HTTPException(status_code=400, detail="Branch not found")

    active_commit_id = commit_id or branch.head_commit_id
    if not active_commit_id:
        raise HTTPException(status_code=400, detail="No commits on this branch yet - upload a document first")

    return active_branch_id, active_commit_id


@router.post("/{subject_id}/query", response_model=QueryResponse)
async def query_subject(
    subject_id: str,
    body: QueryRequest,
    db: AsyncSession = Depends(get_db),
):
    start = time.monotonic()

    branch_id, commit_id = await _resolve_commit(subject_id, body.branch_id, body.commit_id, db)

    # Retrieve
    chunks = await retrieve(body.question, subject_id, commit_id, db)

    # Refusal if nothing retrieved above threshold
    if not chunks or (chunks and chunks[0].get("rerank_score", 1.0) < settings.similarity_threshold):
        refused = True
        answer = "I cannot answer this question from the available documents."
        citations_out: list[CitationOut] = []
        confidence = 0.0
        grounding_score = 0.0
    else:
        refused = False

        # Generate
        gen = await generate_answer(body.question, chunks)
        answer = gen["answer"]
        confidence = gen.get("confidence", 0.5)
        cited_indices = gen.get("citations", [])

        if gen.get("refused"):
            refused = True
            citations_out = []
            grounding_score = 0.0
        else:
            # Build citation objects from cited chunk indices (1-based)
            doc_cache: dict[str, DocumentVersion] = {}
            citations_out = []
            for idx in cited_indices:
                if 1 <= idx <= len(chunks):
                    c = chunks[idx - 1]
                    dv_id = c.get("document_version_id", "")
                    if dv_id not in doc_cache:
                        dv = (await db.execute(select(DocumentVersion).where(DocumentVersion.id == dv_id))).scalar_one_or_none()
                        doc_cache[dv_id] = dv
                    dv = doc_cache.get(dv_id)
                    citations_out.append(CitationOut(
                        chunk_id=c.get("chunk_db_id", ""),
                        document_version_id=dv_id,
                        filename=dv.filename if dv else "unknown",
                        page_no=c["page_no"],
                        excerpt=c["text"][:200],
                        full_text=c["text"],
                    ))

            # Grounding check
            ground = check_grounding(answer, chunks)
            grounding_score = ground["grounding_score"]

            # If grounding is very low, flag as low-confidence
            if grounding_score < 0.3:
                confidence = min(confidence, 0.3)

    latency_ms = int((time.monotonic() - start) * 1000)

    # Log the query
    log = QueryLog(
        subject_id=subject_id,
        branch_id=branch_id,
        commit_id=commit_id,
        question=body.question,
        retrieved_chunk_ids=[c.get("chunk_db_id") for c in chunks],
        answer=answer,
        citations=[c.model_dump() for c in citations_out],
        confidence=confidence,
        grounding_score=grounding_score,
        refused=refused,
        latency_ms=latency_ms,
    )
    db.add(log)
    await db.commit()
    await db.refresh(log)

    return QueryResponse(
        question=body.question,
        answer=answer,
        citations=citations_out,
        confidence=confidence,
        grounding_score=grounding_score,
        refused=refused,
        retrieved_chunks=len(chunks),
        latency_ms=latency_ms,
        log_id=log.id,
    )
