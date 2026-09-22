from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_db
from app.models import EvalRun
from app.schemas import EvalRunOut, EvalRunCreate

router = APIRouter()


@router.post("/runs", response_model=EvalRunOut, status_code=201)
async def create_eval_run(
    body: EvalRunCreate,
    db: AsyncSession = Depends(get_db),
):
    run = EvalRun(
        subject_id=body.subject_id,
        commit_id=body.commit_id,
        branch_id=body.branch_id,
        label=body.label,
        answer_accuracy=body.answer_accuracy,
        citation_precision=body.citation_precision,
        refusal_rate=body.refusal_rate,
        retrieval_recall_at_5=body.retrieval_recall_at_5,
        mean_grounding_score=body.mean_grounding_score,
        total_questions=body.total_questions,
        results_detail=body.results_detail,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run


@router.get("/runs", response_model=list[EvalRunOut])
async def list_eval_runs(
    subject_id: str | None = Query(None),
    limit: int = Query(50, le=200),
    db: AsyncSession = Depends(get_db),
):
    query = select(EvalRun).order_by(EvalRun.created_at.desc()).limit(limit)
    if subject_id:
        query = query.where(EvalRun.subject_id == subject_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/runs/{run_id}", response_model=EvalRunOut)
async def get_eval_run(run_id: str, db: AsyncSession = Depends(get_db)):
    from fastapi import HTTPException
    result = await db.execute(select(EvalRun).where(EvalRun.id == run_id))
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Eval run not found")
    return run
