"""
LLM generation via Ollama. Produces structured cited answers.
"""
from __future__ import annotations

import json
import re

import httpx

from app.config import settings

SYSTEM_PROMPT = """You are a document Q&A assistant. Answer questions ONLY using the context passages provided below.

Rules:
- If the answer is in the context, give a clear, factual answer and cite the source passages by their [N] number.
- If the answer is NOT in the context, respond exactly: "I cannot answer this question from the available documents."
- Never invent facts. Never use prior knowledge beyond the context.
- Always include at least one citation [N] when answering.

Respond in this exact JSON format:
{
  "answer": "<your answer with inline citations like [1], [2]>",
  "citations": [<list of passage numbers you cited, e.g. 1, 2>],
  "confidence": <float 0.0-1.0>,
  "refused": <true if you cannot answer, false otherwise>
}"""


def _build_context(chunks: list[dict]) -> str:
    lines = []
    for i, chunk in enumerate(chunks, start=1):
        lines.append(f"[{i}] (page {chunk['page_no']}):\n{chunk['text']}")
    return "\n\n---\n\n".join(lines)


def _parse_response(raw: str) -> dict:
    # Try to extract JSON from the response
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    # Fallback
    return {
        "answer": raw.strip(),
        "citations": [],
        "confidence": 0.3,
        "refused": False,
    }


async def generate_answer(question: str, chunks: list[dict]) -> dict:
    """Call Ollama and return {answer, citations, confidence, refused}."""
    if not chunks:
        return {
            "answer": "I cannot answer this question from the available documents.",
            "citations": [],
            "confidence": 0.0,
            "refused": True,
        }

    context = _build_context(chunks)
    user_message = f"Context:\n{context}\n\nQuestion: {question}"

    payload = {
        "model": settings.ollama_model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        "stream": False,
        "format": "json",
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            f"{settings.ollama_base_url}/api/chat",
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

    raw = data.get("message", {}).get("content", "")
    return _parse_response(raw)
