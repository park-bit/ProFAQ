"""
LLM generation supporting multiple providers (Groq, Ollama, OpenAI, Gemini, Hybrid).
Produces structured cited answers.
"""
from __future__ import annotations

import json
import os
import re

import httpx

from app.config import settings

SYSTEM_PROMPT = """You are an expert academic document Q&A assistant. Answer questions using ONLY the context passages provided below.

Output Formatting Rules:
- Render responses in rich, clean GitHub-flavored Markdown like ChatGPT.
- Use bold text (**concept**) for core terminology, definitions, and emphasis.
- Organize answers logically with clean Markdown headings (##, ###).
- Use structured bullet points (- item) and numbered lists (1. item) for multiple points, steps, and procedures.
- When comparing concepts or attributes, always include a clean Markdown table (| Dimension | Aspect A | Aspect B |).
- For workflows, architectures, code, or data structures, include syntax-highlighted code blocks or clean ASCII diagrams in ``` fences.
- If the answer is supported by the context, cite source passages accurately using inline citations like [1], [2].
- If the user asks about the presence or existence of a topic, section, or feature and it is absent from the documents, state factually that it is not covered or present in the available documents.
- If the question is completely out of scope, irrelevant, or cannot be answered from the documents, respond: "I cannot answer this question from the available documents." and set refused: true.
- Never invent facts. Never use prior knowledge beyond the provided context.

Respond in this exact JSON format:
{
  "answer": "<your rich Markdown answer with bold key terms, headings, bullet lists, tables, ASCII/code snippets, and inline citations like [1], [2]>",
  "citations": [<list of passage numbers you cited, e.g. 1, 2>],
  "confidence": <float 0.0-1.0>,
  "refused": <true if out of scope, false otherwise>
}"""


def _build_exam_prompt(
    target_length: str = "standard",
    format_style: str = "structured",
    include_tables: bool = True,
    include_diagrams: bool = True,
) -> str:
    if target_length in ("assignment", "extended", "3page"):
        length_desc = (
            "Target Size: Academic Assignment / Multi-Page Research Report (approx. 2 to 3 full pages / 1500-2500 words).\n"
            "- Compose an in-depth, exhaustive academic assignment with extensive theoretical grounding and multi-tiered analysis.\n"
            "- Subdivide into thorough numbered sections:\n"
            "  1. Executive Summary & Problem Formulation\n"
            "  2. Exhaustive Formal Definitions & Foundations\n"
            "  3. Deep Technical Architecture & Mechanics (detailed walkthrough with steps, algorithms, and ASCII/mermaid diagrams)\n"
            "  4. Comprehensive Multi-Criteria Comparison Table (detailed breakdown across multiple dimensions)\n"
            "  5. Practical Case Studies, Real-World Implications & Edge Cases\n"
            "  6. Critical Evaluation, Trade-offs & Limitations\n"
            "  7. Academic Synthesis & Conclusion\n"
            "- Provide complete derivations, full paragraph expositions, and detailed bullet breakdowns for each section without rushing or truncating."
        )
    elif target_length == "short":
        length_desc = (
            "Target Size: Short answer (approx. 5 marks / 0.5 page / 200-350 words).\n"
            "- Deliver a direct, high-scoring definition.\n"
            "- Outline 3-5 core principles or key points in concise bullet points.\n"
            "- Provide a brief synthesis or quick summary comparison table."
        )
    elif target_length == "comprehensive":
        length_desc = (
            "Target Size: Comprehensive thesis (approx. 15-20 marks / 2 full pages / 900-1400 words).\n"
            "- Provide an exhaustive, rigorous academic treatise.\n"
            "- Subdivide into clear numbered sections (e.g. 1. Introduction & Formal Definition, 2. Theoretical Principles, 3. Architectural / Technical Breakdown, 4. Comparative Analysis, 5. Case Analysis / Applications, 6. Critical Evaluation & Conclusion).\n"
            "- Elaborate each section in depth with precise terminology from the documents."
        )
    else:  # standard (10 marks)
        length_desc = (
            "Target Size: Standard university answer (approx. 10 marks / 1 full page / 450-700 words).\n"
            "- Include Introduction & Formal Definition, Key Concepts / Mechanisms, Analytical Comparison, and Concluding Synthesis."
        )

    if format_style == "bullets":
        format_desc = (
            "Formatting Style: High-density Bullet Point Revision Sheet.\n"
            "- Organize content under clear Markdown headings (##).\n"
            "- Present explanations as structured, bold-prefixed bullet points (e.g., `- **Key Concept**: explanation [1]`).\n"
            "- Maximize scannability, memorability, and clarity."
        )
    elif format_style == "narrative":
        format_desc = (
            "Formatting Style: Formal Academic Essay.\n"
            "- Write in coherent, articulate academic prose with well-developed paragraphs.\n"
            "- Use section headings (##) with fluent narrative transitions."
        )
    else:  # structured
        format_desc = (
            "Formatting Style: Structured University Exam Model Solution.\n"
            "- Use clean Markdown hierarchy (##, ###).\n"
            "- Blend precise definitions, bold bulleted analysis, tables, and visual workflows."
        )

    table_desc = ""
    if include_tables:
        table_desc = (
            "- Comparative Table: When comparing 2 or more concepts, features, components, or attributes, always include a clean Markdown table (| Metric / Aspect | Concept A | Concept B |) summarizing the differences."
        )

    diagram_desc = ""
    if include_diagrams:
        diagram_desc = (
            "- Architectural / Flowchart Diagram: When describing processes, hierarchies, workflows, or architectures, include a clean Mermaid diagram using ```mermaid code fences (e.g. `graph TD` or `sequenceDiagram`) or clean ASCII block diagram representing the flow."
        )

    return f"""You are a university professor and chief academic examiner.
Your goal is to compose model, top-grade university exam answers using ONLY the context passages provided below.

Rules:
- Formulate the response with exceptional academic rigor, clarity, and precision.
- Every claim, definition, and technical statement MUST cite its source passage using inline citations like [1], [2].
- If a question cannot be answered from the documents, respond: "I cannot answer this question from the available documents." and set refused: true.
- Never invent facts. Never use prior knowledge outside the provided context.

Structure & Length Requirements:
{length_desc}

{format_desc}

Visual & Structural Elements:
{table_desc}
{diagram_desc}

Respond in this exact JSON format:
{{
  "answer": "<your complete, formatted Markdown answer with headings, tables, diagrams, and inline citations like [1], [2]>",
  "citations": [<list of passage numbers cited, e.g. 1, 2>],
  "confidence": <float 0.0-1.0>,
  "refused": <true if out of scope, false otherwise>
}}"""


def _build_context(chunks: list[dict]) -> str:
    lines = []
    for i, chunk in enumerate(chunks, start=1):
        filename = chunk.get("filename", "")
        doc_header = f" [{filename}]" if filename else ""
        lines.append(f"[{i}] (page {chunk['page_no']}{doc_header}):\n{chunk['text']}")
    return "\n\n---\n\n".join(lines)


def _parse_response(raw: str) -> dict:
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        try:
            return json.loads(match.group())
        except json.JSONDecodeError:
            pass
    return {
        "answer": raw.strip(),
        "citations": [],
        "confidence": 0.3,
        "refused": False,
    }


def _build_messages(
    history: list[dict] | None,
    user_message: str,
    system_prompt: str = SYSTEM_PROMPT,
) -> list[dict]:
    messages = [{"role": "system", "content": system_prompt}]
    if history:
        for h in history[-8:]:
            role = h.get("role")
            content = h.get("content") or h.get("answer") or ""
            if role in ("user", "assistant") and content.strip():
                messages.append({"role": role, "content": content.strip()})
    messages.append({"role": "user", "content": user_message})
    return messages


async def _generate_groq(
    messages: list[dict],
    api_key: str | None = None,
    model: str | None = None,
    max_tokens: int = 2048,
) -> str:
    key = api_key or settings.groq_api_key or os.environ.get("GROQ_API_KEY", "")
    if not key:
        raise ValueError("Groq API key not provided. Please enter your API key in LLM Settings.")

    url = "https://api.groq.com/openai/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model or settings.groq_model,
        "messages": messages,
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
        "max_tokens": max_tokens,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def _generate_ollama(
    messages: list[dict],
    model: str | None = None,
    base_url: str | None = None,
    max_tokens: int = 2048,
) -> str:
    host = (base_url or settings.ollama_base_url).rstrip("/")
    payload = {
        "model": model or settings.ollama_model,
        "messages": messages,
        "stream": False,
        "format": "json",
        "options": {
            "num_predict": max_tokens,
            "num_ctx": max(4096, max_tokens + 2048),
            "temperature": 0.1,
        },
    }

    async with httpx.AsyncClient(timeout=180.0) as client:
        response = await client.post(f"{host}/api/chat", json=payload)
        response.raise_for_status()
        data = response.json()
        return data.get("message", {}).get("content", "")


async def _generate_openai(
    messages: list[dict],
    api_key: str | None = None,
    model: str | None = None,
    base_url: str | None = None,
    max_tokens: int = 2048,
) -> str:
    key = api_key or settings.openai_api_key or os.environ.get("OPENAI_API_KEY", "")
    if not key:
        raise ValueError("OpenAI API key not provided. Please enter your API key in LLM Settings.")

    endpoint = (base_url or settings.openai_base_url).rstrip("/")
    url = f"{endpoint}/chat/completions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model or settings.openai_model,
        "messages": messages,
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
        "max_tokens": max_tokens,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def _generate_gemini(
    messages: list[dict],
    api_key: str | None = None,
    model: str | None = None,
    max_tokens: int = 2048,
) -> str:
    key = api_key or settings.gemini_api_key or os.environ.get("GEMINI_API_KEY", "")
    if not key:
        raise ValueError("Gemini API key not provided. Please enter your API key in LLM Settings.")

    url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model or settings.gemini_model,
        "messages": messages,
        "response_format": {"type": "json_object"},
        "temperature": 0.1,
        "max_tokens": max_tokens,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def _generate_custom(
    messages: list[dict],
    base_url: str,
    api_key: str | None = None,
    model: str | None = None,
    max_tokens: int = 2048,
) -> str:
    endpoint = base_url.rstrip("/")
    url = f"{endpoint}/chat/completions" if not endpoint.endswith("/chat/completions") else endpoint
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model or "default",
        "messages": messages,
        "temperature": 0.1,
        "max_tokens": max_tokens,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]


async def generate_answer(
    question: str,
    chunks: list[dict],
    history: list[dict] | None = None,
    provider: str | None = None,
    api_key: str | None = None,
    model_name: str | None = None,
    base_url: str | None = None,
    answer_mode: str = "general",
    target_length: str = "standard",
    format_style: str = "structured",
    include_tables: bool = True,
    include_diagrams: bool = True,
    max_tokens: int | None = None,
) -> dict:
    """Call selected LLM provider with conversational context and return {answer, citations, confidence, refused}."""
    if not chunks:
        return {
            "answer": "I cannot answer this question from the available documents.",
            "citations": [],
            "confidence": 0.0,
            "refused": True,
        }

    # Determine token budget
    if max_tokens and max_tokens > 0:
        effective_max_tokens = max_tokens
    elif target_length in ("assignment", "extended", "3page"):
        effective_max_tokens = 4096
    elif target_length == "comprehensive":
        effective_max_tokens = 2048
    elif target_length == "short":
        effective_max_tokens = 768
    else:
        effective_max_tokens = 1536

    context = _build_context(chunks)
    user_message = f"Context:\n{context}\n\nQuestion: {question}"

    if answer_mode == "exam":
        system_prompt = _build_exam_prompt(
            target_length=target_length,
            format_style=format_style,
            include_tables=include_tables,
            include_diagrams=include_diagrams,
        )
    else:
        system_prompt = SYSTEM_PROMPT

    messages = _build_messages(history, user_message, system_prompt=system_prompt)

    chosen_provider = (provider or settings.llm_provider or "").lower()

    if not chosen_provider:
        return {
            "answer": "No LLM configured. Please configure your API key (Groq, OpenAI, Gemini) or local model (Ollama, custom endpoint) in LLM Settings.",
            "citations": [],
            "confidence": 0.0,
            "refused": True,
        }

    if chosen_provider == "groq":
        raw = await _generate_groq(messages, api_key=api_key, model=model_name, max_tokens=effective_max_tokens)
    elif chosen_provider == "ollama":
        raw = await _generate_ollama(messages, model=model_name, base_url=base_url, max_tokens=effective_max_tokens)
    elif chosen_provider == "openai":
        raw = await _generate_openai(messages, api_key=api_key, model=model_name, base_url=base_url, max_tokens=effective_max_tokens)
    elif chosen_provider == "gemini":
        raw = await _generate_gemini(messages, api_key=api_key, model=model_name, max_tokens=effective_max_tokens)
    elif chosen_provider == "custom":
        if not base_url:
            raise ValueError("Base URL is required for custom LLM provider.")
        raw = await _generate_custom(messages, base_url=base_url, api_key=api_key, model=model_name, max_tokens=effective_max_tokens)
    elif chosen_provider == "hybrid":
        try:
            if api_key:
                raw = await _generate_groq(messages, api_key=api_key, model=model_name, max_tokens=effective_max_tokens)
            else:
                raw = await _generate_ollama(messages, model=model_name, base_url=base_url, max_tokens=effective_max_tokens)
        except Exception:
            raw = await _generate_ollama(messages, model=model_name, base_url=base_url, max_tokens=effective_max_tokens)
    else:
        raise ValueError(f"Unknown or unconfigured LLM provider: {chosen_provider}. Please select a provider in LLM Settings.")

    return _parse_response(raw)

    return _parse_response(raw)


async def test_llm_connection(
    provider: str,
    api_key: str | None = None,
    model_name: str | None = None,
    base_url: str | None = None,
) -> dict:
    """Test connectivity for selected provider, api_key, model, and base_url."""
    test_chunk = [{
        "chunk_db_id": "test",
        "page_no": 1,
        "text": "Software verification ensures system specification correctness.",
    }]
    try:
        res = await generate_answer(
            question="What does software verification ensure?",
            chunks=test_chunk,
            history=None,
            provider=provider,
            api_key=api_key,
            model_name=model_name,
            base_url=base_url,
        )
        return {
            "success": True,
            "message": f"Connected to {provider} successfully.",
            "reply": res.get("answer", ""),
        }
    except Exception as exc:
        return {
            "success": False,
            "message": str(exc),
            "reply": None,
        }
