"""
Semantic embedding-based grounding check.

For each sentence or statement in the answer, computes semantic alignment
against the retrieved context passages using the embedding model.
Returns a calibrated mean grounding score (0.0 to 1.0) and flags ungrounded statements.
"""
from __future__ import annotations

import re
import numpy as np

from app.services.ingest import get_embedder


def _split_statements(text: str) -> list[str]:
    """Split response into distinct clauses, sentences, or bullet items."""
    lines = re.split(r"[\n\r]+", text.strip())
    statements = []
    for line in lines:
        cleaned = re.sub(r"^[\s*•\-–—\d\.\)]+", "", line).strip()
        if not cleaned:
            continue
        parts = re.split(r"(?<=[.!?])\s+", cleaned)
        for p in parts:
            p = p.strip()
            if len(p) > 8:
                statements.append(p)
    return statements if statements else [text.strip()]


def check_grounding(answer: str, chunks: list[dict]) -> dict:
    """
    Returns:
        grounding_score: float 0.0-1.0 (mean semantic alignment across statements)
        sentence_scores: list of {sentence, score, grounded}
        ungrounded_sentences: list of statements with score < 0.5
    """
    if not answer or not chunks:
        return {"grounding_score": 0.0, "sentence_scores": [], "ungrounded_sentences": []}

    statements = _split_statements(answer)
    if not statements:
        return {"grounding_score": 1.0, "sentence_scores": [], "ungrounded_sentences": []}

    embedder = get_embedder()
    chunk_texts = [c["text"] for c in chunks if c.get("text")]
    if not chunk_texts:
        return {"grounding_score": 0.0, "sentence_scores": [], "ungrounded_sentences": statements}

    # Encode context chunks and answer statements
    chunk_vecs = embedder.encode(chunk_texts, batch_size=32, normalize_embeddings=True, show_progress_bar=False)
    statement_vecs = embedder.encode(statements, batch_size=32, normalize_embeddings=True, show_progress_bar=False)

    sentence_scores = []
    for stmt, s_vec in zip(statements, statement_vecs):
        sims = np.dot(chunk_vecs, s_vec)
        best_sim = float(np.max(sims))

        # Calibrate: 0.35 baseline (unrelated) to 0.75+ (grounded)
        calibrated = min(1.0, max(0.0, (best_sim - 0.35) / (0.75 - 0.35)))
        sentence_scores.append({
            "sentence": stmt,
            "score": round(calibrated, 3),
            "grounded": calibrated >= 0.5,
        })

    scores = [s["score"] for s in sentence_scores]
    grounding_score = round(float(np.mean(scores)), 3) if scores else 1.0
    ungrounded = [s["sentence"] for s in sentence_scores if not s["grounded"]]

    return {
        "grounding_score": grounding_score,
        "sentence_scores": sentence_scores,
        "ungrounded_sentences": ungrounded,
    }
