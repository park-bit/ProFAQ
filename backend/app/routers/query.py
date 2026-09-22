import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import Subject, Branch, Commit, DocumentVersion, QueryLog, ChatSession
from app.schemas import (
    QueryRequest,
    QueryResponse,
    CitationOut,
    LLMTestRequest,
    LLMTestResponse,
    ChatSessionCreate,
    ChatSessionUpdate,
    ChatSessionOut,
)
from app.services.retrieval import retrieve
from app.services.generator import generate_answer, test_llm_connection
from app.services.grounding import check_grounding
from app.config import settings

router = APIRouter()


@router.post("/llm/test", response_model=LLMTestResponse)
async def test_llm(body: LLMTestRequest):
    res = await test_llm_connection(
        provider=body.provider,
        api_key=body.api_key,
        model_name=body.model_name,
        base_url=body.base_url,
    )
    return LLMTestResponse(**res)


async def _resolve_commit(subject_id: str, branch_id: str | None, commit_id: str | None, db: AsyncSession) -> tuple[str, str]:
    """Returns (resolved_branch_id, resolved_commit_id)."""
    subject = (await db.execute(select(Subject).where(Subject.id == subject_id))).scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    active_branch_id = branch_id or subject.current_branch_id
    branch = (await db.execute(select(Branch).where(Branch.id == active_branch_id))).scalar_one_or_none()
    if not branch:
        raise HTTPException(status_code=400, detail="Branch not found")

    # If checking out a detached commit, use that; otherwise fall back to branch head
    active_commit_id = commit_id or subject.active_commit_id or branch.head_commit_id
    if not active_commit_id:
        raise HTTPException(status_code=400, detail="No commits on this branch yet - upload a document first")

    return active_branch_id, active_commit_id


@router.get("/{subject_id}/chats", response_model=list[ChatSessionOut])
async def list_chat_sessions(
    subject_id: str,
    db: AsyncSession = Depends(get_db),
):
    sessions = (await db.execute(
        select(ChatSession)
        .where(ChatSession.subject_id == subject_id)
        .order_by(ChatSession.updated_at.desc())
    )).scalars().all()

    out = []
    for s in sessions:
        cnt_res = await db.execute(select(func.count(QueryLog.id)).where(QueryLog.session_id == s.id))
        count = cnt_res.scalar() or 0
        out.append(ChatSessionOut(
            id=s.id,
            subject_id=s.subject_id,
            branch_id=s.branch_id,
            title=s.title,
            chat_type=getattr(s, "chat_type", None) or "general",
            target_length=getattr(s, "target_length", None) or "standard",
            format_style=getattr(s, "format_style", None) or "structured",
            message_count=count,
            created_at=s.created_at,
            updated_at=s.updated_at,
        ))
    return out


@router.post("/{subject_id}/chats", response_model=ChatSessionOut, status_code=201)
async def create_chat_session(
    subject_id: str,
    body: ChatSessionCreate,
    db: AsyncSession = Depends(get_db),
):
    subject = (await db.execute(select(Subject).where(Subject.id == subject_id))).scalar_one_or_none()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    session = ChatSession(
        subject_id=subject_id,
        branch_id=body.branch_id or subject.current_branch_id,
        title=body.title or ("Exam Structured" if body.chat_type == "exam" else "New Chat"),
        chat_type=body.chat_type or "general",
        target_length=body.target_length or "standard",
        format_style=body.format_style or "structured",
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return ChatSessionOut(
        id=session.id,
        subject_id=session.subject_id,
        branch_id=session.branch_id,
        title=session.title,
        chat_type=session.chat_type or "general",
        target_length=session.target_length or "standard",
        format_style=session.format_style or "structured",
        message_count=0,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.patch("/{subject_id}/chats/{chat_id}", response_model=ChatSessionOut)
async def rename_chat_session(
    subject_id: str,
    chat_id: str,
    body: ChatSessionUpdate,
    db: AsyncSession = Depends(get_db),
):
    session = (await db.execute(select(ChatSession).where(ChatSession.id == chat_id, ChatSession.subject_id == subject_id))).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Chat not found")

    if body.title is not None:
        session.title = body.title.strip() or "Untitled Chat"
    if body.chat_type is not None:
        session.chat_type = body.chat_type
    if body.target_length is not None:
        session.target_length = body.target_length
    if body.format_style is not None:
        session.format_style = body.format_style

    await db.commit()
    await db.refresh(session)

    cnt_res = await db.execute(select(func.count(QueryLog.id)).where(QueryLog.session_id == session.id))
    count = cnt_res.scalar() or 0

    return ChatSessionOut(
        id=session.id,
        subject_id=session.subject_id,
        branch_id=session.branch_id,
        title=session.title,
        chat_type=session.chat_type or "general",
        target_length=session.target_length or "standard",
        format_style=session.format_style or "structured",
        message_count=count,
        created_at=session.created_at,
        updated_at=session.updated_at,
    )


@router.delete("/{subject_id}/chats/{chat_id}", status_code=204)
async def delete_chat_session(
    subject_id: str,
    chat_id: str,
    db: AsyncSession = Depends(get_db),
):
    session = (await db.execute(select(ChatSession).where(ChatSession.id == chat_id, ChatSession.subject_id == subject_id))).scalar_one_or_none()
    if not session:
        raise HTTPException(status_code=404, detail="Chat not found")

    await db.delete(session)
    await db.commit()
    return None


@router.post("/{subject_id}/query", response_model=QueryResponse)
async def query_subject(
    subject_id: str,
    body: QueryRequest,
    db: AsyncSession = Depends(get_db),
):
    start = time.monotonic()

    branch_id, commit_id = await _resolve_commit(subject_id, body.branch_id, body.commit_id, db)

    # Ensure chat session exists
    session = None
    if body.session_id:
        session = (await db.execute(
            select(ChatSession).where(ChatSession.id == body.session_id, ChatSession.subject_id == subject_id)
        )).scalar_one_or_none()

    if not session:
        title = body.question[:40].strip() or ("Exam Structured" if body.answer_mode == "exam" else "New Chat")
        session = ChatSession(
            subject_id=subject_id,
            branch_id=branch_id,
            title=title,
            chat_type=body.answer_mode or "general",
            target_length=body.target_length or "standard",
            format_style=body.format_style or "structured",
        )
        db.add(session)
        await db.flush()
    elif session.title in ("New Chat", "New Exam Chat", "Exam Structured"):
        session.title = body.question[:40].strip() or "Chat"

    session.updated_at = datetime.now(timezone.utc)

    # Multi-turn search query enhancement for short or follow-up questions
    search_query = body.question
    if body.history and len(body.question.split()) < 8:
        prior_questions = [h.content for h in body.history if h.role == "user" and h.content.strip()]
        if prior_questions:
            search_query = f"{prior_questions[-1]} {body.question}"

    # Retrieve
    chunks = await retrieve(search_query, subject_id, commit_id, db)

    effective_answer_mode = body.answer_mode or (getattr(session, "chat_type", None) or "general")
    effective_target_length = body.target_length or (getattr(session, "target_length", None) or "standard")
    effective_format_style = body.format_style or (getattr(session, "format_style", None) or "structured")
    include_tables = True if body.include_tables is None else body.include_tables
    include_diagrams = True if body.include_diagrams is None else body.include_diagrams

    # Refusal if no chunks retrieved
    if not chunks:
        refused = True
        answer = "I cannot answer this question from the available documents."
        citations_out: list[CitationOut] = []
        confidence = 0.0
        grounding_score = 0.0
    else:
        # Load subject details to provide context for overview / meta questions
        subject = (await db.execute(select(Subject).where(Subject.id == subject_id))).scalar_one_or_none()
        subject_info = f"Subject: {subject.name}" if subject else ""
        if subject and subject.description:
            subject_info += f" ({subject.description})"

        # Attach filenames to retrieved chunks
        doc_cache: dict[str, DocumentVersion] = {}
        for c in chunks:
            dv_id = c.get("document_version_id", "")
            if dv_id and dv_id not in doc_cache:
                dv = (await db.execute(select(DocumentVersion).where(DocumentVersion.id == dv_id))).scalar_one_or_none()
                doc_cache[dv_id] = dv
            dv = doc_cache.get(dv_id)
            c["filename"] = dv.filename if dv else ""

        # For questions asking about the subject/document/overview, include the subject and filename in context
        q_lower = body.question.lower()
        if any(k in q_lower for k in ["subject", "document", "topic", "summar", "what is this", "title", "about", "who"]):
            if chunks:
                doc_name = chunks[0].get("filename", "")
                chunks[0]["text"] = f"{subject_info}\nDocument: {doc_name}\n\n{chunks[0]['text']}"

        # Generate with custom LLM options and conversational history
        gen = await generate_answer(
            question=body.question,
            chunks=chunks,
            history=[h.model_dump() for h in body.history] if body.history else None,
            provider=body.llm_provider,
            api_key=body.api_key,
            model_name=body.model_name,
            base_url=body.base_url,
            answer_mode=effective_answer_mode,
            target_length=effective_target_length,
            format_style=effective_format_style,
            include_tables=include_tables,
            include_diagrams=include_diagrams,
        )
        answer = gen["answer"]
        confidence = gen.get("confidence", 0.5)
        cited_indices = gen.get("citations", [])

        if gen.get("refused") or "I cannot answer this question" in answer:
            refused = True
            citations_out = []
            grounding_score = 0.0
        else:
            refused = False
            # Build citation objects from cited chunk indices (1-based)
            citations_out = []
            for idx in cited_indices:
                if 1 <= idx <= len(chunks):
                    c = chunks[idx - 1]
                    dv_id = c.get("document_version_id", "")
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

            if grounding_score < 0.3:
                confidence = min(confidence, 0.3)

    latency_ms = int((time.monotonic() - start) * 1000)

    # Log the query linked to the chat session
    log = QueryLog(
        subject_id=subject_id,
        session_id=session.id,
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
        session_id=session.id,
        answer_mode=effective_answer_mode,
        target_length=effective_target_length,
    )


@router.get("/{subject_id}/chat-history")
async def get_chat_history(
    subject_id: str,
    session_id: str | None = None,
    branch_id: str | None = None,
    limit: int = 100,
    db: AsyncSession = Depends(get_db),
):
    query = select(QueryLog).where(QueryLog.subject_id == subject_id)
    if session_id:
        query = query.where(QueryLog.session_id == session_id)
    elif branch_id:
        query = query.where(QueryLog.branch_id == branch_id)
    query = query.order_by(QueryLog.created_at.asc()).limit(limit)
    res = await db.execute(query)
    logs = res.scalars().all()

    return [
        {
            "id": log.id,
            "subject_id": log.subject_id,
            "session_id": log.session_id,
            "branch_id": log.branch_id,
            "commit_id": log.commit_id,
            "question": log.question,
            "answer": log.answer,
            "citations": log.citations or [],
            "confidence": log.confidence,
            "grounding_score": log.grounding_score,
            "refused": log.refused,
            "latency_ms": log.latency_ms,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log in logs
    ]


@router.delete("/{subject_id}/chat-history")
async def clear_chat_history(
    subject_id: str,
    session_id: str | None = None,
    branch_id: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = delete(QueryLog).where(QueryLog.subject_id == subject_id)
    if session_id:
        stmt = stmt.where(QueryLog.session_id == session_id)
    elif branch_id:
        stmt = stmt.where(QueryLog.branch_id == branch_id)
    await db.execute(stmt)
    await db.commit()
    return {"cleared": True}
