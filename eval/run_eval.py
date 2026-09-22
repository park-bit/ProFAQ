#!/usr/bin/env python3
"""
ProFAQ eval runner.

Usage:
    python eval/run_eval.py --subject-id <id> --questions eval/questions/sample_set.json [--label "before reranker"]

Writes results to the eval_runs table via the API, then prints a summary.
"""
import argparse
import json
import sys
import time
from pathlib import Path
from typing import Optional

import httpx

API_BASE = "http://localhost:8000"


def load_questions(path: str) -> list[dict]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return data["questions"]


def run_query(client: httpx.Client, subject_id: str, question: str) -> dict:
    resp = client.post(
        f"{API_BASE}/subjects/{subject_id}/query",
        json={"question": question},
        timeout=120.0,
    )
    resp.raise_for_status()
    return resp.json()


def semantic_match(predicted: str, gold: str) -> float:
    """Rough semantic match: word overlap F1. Replace with embedding similarity for production."""
    if not gold:
        return 0.0
    pred_words = set(predicted.lower().split())
    gold_words = set(gold.lower().split())
    if not gold_words:
        return 0.0
    precision = len(pred_words & gold_words) / len(pred_words) if pred_words else 0
    recall = len(pred_words & gold_words) / len(gold_words)
    if precision + recall == 0:
        return 0.0
    return 2 * precision * recall / (precision + recall)


def evaluate(subject_id: str, questions: list[dict], label: Optional[str]) -> dict:
    results = []
    answerable_scores = []
    citation_hits = 0
    refusal_correct = 0
    total_answerable = 0
    total_unanswerable = 0
    grounding_scores = []

    with httpx.Client() as client:
        for q in questions:
            qid = q["id"]
            question = q["question"]
            gold = q.get("gold_answer")
            answerable = q.get("answerable", True)

            print(f"  [{qid}] {question[:60]}...", end=" ", flush=True)
            t0 = time.monotonic()
            try:
                result = run_query(client, subject_id, question)
            except Exception as e:
                print(f"ERROR: {e}")
                results.append({"id": qid, "error": str(e)})
                continue

            latency = time.monotonic() - t0
            refused = result["refused"]
            answer = result["answer"]
            grounding = result["grounding_score"]
            grounding_scores.append(grounding)

            row = {
                "id": qid,
                "question": question,
                "answerable": answerable,
                "refused": refused,
                "answer": answer[:200],
                "grounding_score": grounding,
                "latency_ms": result["latency_ms"],
                "citations": len(result["citations"]),
            }

            if answerable:
                total_answerable += 1
                if not refused:
                    score = semantic_match(answer, gold) if gold else None
                    if score is not None:
                        answerable_scores.append(score)
                    row["answer_score"] = score
                    if result["citations"]:
                        citation_hits += 1
                else:
                    row["answer_score"] = 0.0
                    answerable_scores.append(0.0)
                    print("REFUSED (wrong)", end=" ")
            else:
                total_unanswerable += 1
                if refused:
                    refusal_correct += 1
                    print("REFUSED (correct)", end=" ")
                else:
                    print("NOT REFUSED (wrong)", end=" ")

            results.append(row)
            print(f"gs={grounding:.2f} [{latency:.1f}s]")

    answer_accuracy = (sum(answerable_scores) / len(answerable_scores)) if answerable_scores else None
    citation_precision = (citation_hits / total_answerable) if total_answerable else None
    refusal_rate = (refusal_correct / total_unanswerable) if total_unanswerable else None
    mean_grounding = sum(grounding_scores) / len(grounding_scores) if grounding_scores else None

    return {
        "answer_accuracy": round(answer_accuracy, 3) if answer_accuracy is not None else None,
        "citation_precision": round(citation_precision, 3) if citation_precision is not None else None,
        "refusal_rate": round(refusal_rate, 3) if refusal_rate is not None else None,
        "retrieval_recall_at_5": None,  # requires gold chunk labels - fill in manually
        "mean_grounding_score": round(mean_grounding, 3) if mean_grounding is not None else None,
        "total_questions": len(questions),
        "results_detail": results,
        "label": label,
    }


def save_eval_run(subject_id: str, commit_id: Optional[str], branch_id: Optional[str], metrics: dict):
    payload = {
        "subject_id": subject_id,
        "commit_id": commit_id,
        "branch_id": branch_id,
        **metrics,
    }

    try:
        with httpx.Client() as client:
            resp = client.post(f"{API_BASE}/eval/runs", json=payload, timeout=30.0)
            if resp.status_code == 201:
                saved = resp.json()
                print(f"\nEval run saved via API: {saved.get('id')}")
                return
    except Exception as e:
        print(f"API save failed ({e}), falling back to direct DB...")

    # Direct DB fallback
    from pathlib import Path
    import sys
    sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
    import asyncio
    from app.db import AsyncSessionLocal, init_db
    from app.models import EvalRun

    async def _save():
        await init_db()
        async with AsyncSessionLocal() as db:
            run = EvalRun(
                subject_id=subject_id,
                commit_id=commit_id,
                branch_id=branch_id,
                label=metrics.get("label"),
                answer_accuracy=metrics.get("answer_accuracy"),
                citation_precision=metrics.get("citation_precision"),
                refusal_rate=metrics.get("refusal_rate"),
                retrieval_recall_at_5=metrics.get("retrieval_recall_at_5"),
                mean_grounding_score=metrics.get("mean_grounding_score"),
                total_questions=metrics.get("total_questions", 0),
                results_detail=metrics.get("results_detail"),
            )
            db.add(run)
            await db.commit()
            await db.refresh(run)
            print(f"\nEval run saved to DB: {run.id}")

    asyncio.run(_save())


def main():
    parser = argparse.ArgumentParser(description="ProFAQ eval runner")
    parser.add_argument("--subject-id", required=True)
    parser.add_argument("--questions", default="eval/questions/sample_set.json")
    parser.add_argument("--commit-id", default=None)
    parser.add_argument("--branch-id", default=None)
    parser.add_argument("--label", default=None, help="Human label for this run, e.g. 'before reranker'")
    args = parser.parse_args()

    questions = load_questions(args.questions)
    print(f"Running eval: {len(questions)} questions on subject {args.subject_id}\n")

    metrics = evaluate(args.subject_id, questions, args.label)

    print("\n--- Results ---")
    print(f"Answer accuracy:      {metrics['answer_accuracy']}")
    print(f"Citation precision:   {metrics['citation_precision']}")
    print(f"Correct refusal rate: {metrics['refusal_rate']}")
    print(f"Mean grounding score: {metrics['mean_grounding_score']}")
    print(f"Total questions:      {metrics['total_questions']}")

    save_eval_run(args.subject_id, args.commit_id, args.branch_id, metrics)


if __name__ == "__main__":
    main()
