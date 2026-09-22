"""
NLI-based grounding check.

For each sentence in the answer, checks whether it is entailed by at least
one of the retrieved chunks. Returns a mean entailment score and flags
ungrounded sentences.
"""
from __future__ import annotations

import re

from app.config import settings

_nli_model = None


def get_nli_model():
    global _nli_model
    if _nli_model is None:
        from sentence_transformers import CrossEncoder
        _nli_model = CrossEncoder(settings.nli_model)
    return _nli_model


def _split_sentences(text: str) -> list[str]:
    sentences = re.split(r"(?<=[.!?])\s+", text.strip())
    return [s.strip() for s in sentences if len(s.strip()) > 10]


def check_grounding(answer: str, chunks: list[dict]) -> dict:
    """
    Returns:
        grounding_score: float 0.0-1.0 (mean entailment across sentences)
        sentence_scores: list of {sentence, score, grounded}
        ungrounded_sentences: list of sentences with score < 0.5
    """
    if not answer or not chunks:
        return {"grounding_score": 0.0, "sentence_scores": [], "ungrounded_sentences": []}

    sentences = _split_sentences(answer)
    if not sentences:
        return {"grounding_score": 1.0, "sentence_scores": [], "ungrounded_sentences": []}

    model = get_nli_model()
    chunk_texts = [c["text"] for c in chunks]

    sentence_scores = []
    for sentence in sentences:
        # Check sentence against all chunks; take max entailment score
        pairs = [(sentence, chunk_text) for chunk_text in chunk_texts]
        scores = model.predict(pairs)

        # deberta-v3 NLI returns [contradiction, neutral, entailment] logits
        # For cross-encoder/nli-deberta-v3-small the label order is:
        # 0: contradiction, 1: entailment, 2: neutral
        # We want the entailment probability. When scores is 1D (single pair)
        # or scores is per-pair scalar, handle both shapes.
        import numpy as np
        scores_arr = np.array(scores)
        if scores_arr.ndim == 2:
            # shape (n_pairs, n_labels) -> entailment is label index 1
            entailment_scores = scores_arr[:, 1]
        else:
            # scalar per pair (binary cross-encoder) - treat directly as entailment
            entailment_scores = scores_arr

        best_score = float(np.max(entailment_scores))
        # Normalize from logit to 0-1 via sigmoid if needed
        if best_score > 1.0 or best_score < 0.0:
            best_score = float(1 / (1 + np.exp(-best_score)))

        sentence_scores.append({
            "sentence": sentence,
            "score": round(best_score, 3),
            "grounded": best_score >= 0.5,
        })

    grounded = [s for s in sentence_scores if s["grounded"]]
    grounding_score = len(grounded) / len(sentence_scores) if sentence_scores else 1.0
    ungrounded = [s["sentence"] for s in sentence_scores if not s["grounded"]]

    return {
        "grounding_score": round(grounding_score, 3),
        "sentence_scores": sentence_scores,
        "ungrounded_sentences": ungrounded,
    }
