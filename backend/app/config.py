import os
import pathlib
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./data/profaq.db"

    qdrant_host: str = "localhost"
    qdrant_port: int = 6333

    embedding_model: str = "BAAI/bge-small-en-v1.5"
    reranker_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    nli_model: str = "cross-encoder/nli-deberta-v3-small"

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b"

    bm25_top_k: int = 20
    dense_top_k: int = 20
    rerank_top_k: int = 5
    similarity_threshold: float = 0.35

    chunk_size: int = 400
    chunk_overlap: int = 50

    upload_dir: str = "./data/uploads"

    # HuggingFace cache dirs - set these to keep models inside the project folder
    hf_home: str = "./data/hf_cache"
    transformers_cache: str = "./data/hf_cache/hub"
    sentence_transformers_home: str = "./data/hf_cache/sentence_transformers"


settings = Settings()

# Apply HF cache paths to environment so sentence-transformers and transformers
# pick them up even if the caller didn't export them before importing.
os.environ.setdefault("HF_HOME", str(pathlib.Path(settings.hf_home).resolve()))
os.environ.setdefault("TRANSFORMERS_CACHE", str(pathlib.Path(settings.transformers_cache).resolve()))
os.environ.setdefault("SENTENCE_TRANSFORMERS_HOME", str(pathlib.Path(settings.sentence_transformers_home).resolve()))
