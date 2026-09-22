import os
import pathlib
import tempfile
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = pathlib.Path(__file__).resolve().parent.parent.parent
ENV_PATH = ROOT_DIR / ".env"
load_dotenv(dotenv_path=ENV_PATH, override=True)

# Centralize ALL cache and temporary directories strictly inside project data directory on D: drive
DATA_DIR = (ROOT_DIR / "data").resolve()
HF_CACHE_DIR = (DATA_DIR / "hf_cache").resolve()
TORCH_CACHE_DIR = (DATA_DIR / "torch_cache").resolve()
TEMP_DIR = (DATA_DIR / "tmp").resolve()
UPLOAD_DIR = (DATA_DIR / "uploads").resolve()
QDRANT_DIR = (DATA_DIR / "qdrant").resolve()
WEBVIEW2_DIR = (DATA_DIR / "webview2_data").resolve()

for directory in [
    DATA_DIR,
    HF_CACHE_DIR,
    HF_CACHE_DIR / "hub",
    HF_CACHE_DIR / "sentence_transformers",
    HF_CACHE_DIR / "datasets",
    TORCH_CACHE_DIR,
    TEMP_DIR,
    UPLOAD_DIR,
    QDRANT_DIR,
    WEBVIEW2_DIR,
    DATA_DIR / ".cache",
    DATA_DIR / "tiktoken_cache",
]:
    directory.mkdir(parents=True, exist_ok=True)

# Export environment variables so HuggingFace, PyTorch, Tokenizers, WebView2, and temp files NEVER touch C: drive
os.environ["HF_HOME"] = str(HF_CACHE_DIR)
os.environ["HUGGINGFACE_HUB_CACHE"] = str(HF_CACHE_DIR / "hub")
os.environ["TRANSFORMERS_CACHE"] = str(HF_CACHE_DIR / "hub")
os.environ["HF_DATASETS_CACHE"] = str(HF_CACHE_DIR / "datasets")
os.environ["SENTENCE_TRANSFORMERS_HOME"] = str(HF_CACHE_DIR / "sentence_transformers")
os.environ["TORCH_HOME"] = str(TORCH_CACHE_DIR)
os.environ["XDG_CACHE_HOME"] = str(DATA_DIR / ".cache")
os.environ["TIKTOKEN_CACHE_DIR"] = str(DATA_DIR / "tiktoken_cache")
os.environ["WEBVIEW2_USER_DATA_FOLDER"] = str(WEBVIEW2_DIR)
os.environ["TEMP"] = str(TEMP_DIR)
os.environ["TMP"] = str(TEMP_DIR)
tempfile.tempdir = str(TEMP_DIR)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(ENV_PATH), ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = f"sqlite+aiosqlite:///{str(DATA_DIR / 'profaq.db').replace(chr(92), '/')}"

    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    qdrant_path: str = str(QDRANT_DIR)
    qdrant_url: str = ""
    qdrant_api_key: str = ""

    embedding_model: str = "BAAI/bge-small-en-v1.5"
    reranker_model: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    nli_model: str = "cross-encoder/nli-deberta-v3-small"

    # LLM Provider: "groq", "ollama", "openai", "gemini", or "custom" (configured by user)
    llm_provider: str = ""

    # Groq settings
    groq_api_key: str = ""
    groq_model: str = "llama-3.3-70b-versatile"

    # Ollama settings
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen2.5:7b"

    # OpenAI settings
    openai_api_key: str = ""
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str = "gpt-4o-mini"

    # Gemini settings
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.0-flash"

    bm25_top_k: int = 20
    dense_top_k: int = 20
    rerank_top_k: int = 5
    similarity_threshold: float = 0.35

    chunk_size: int = 400
    chunk_overlap: int = 50

    upload_dir: str = str(UPLOAD_DIR)

    # HuggingFace cache dirs - strictly inside the project folder
    hf_home: str = str(HF_CACHE_DIR)
    transformers_cache: str = str(HF_CACHE_DIR / "hub")
    sentence_transformers_home: str = str(HF_CACHE_DIR / "sentence_transformers")


settings = Settings()

# Re-enforce environment variables after settings load in case .env overrode them with relative paths
os.environ["HF_HOME"] = str(HF_CACHE_DIR)
os.environ["HUGGINGFACE_HUB_CACHE"] = str(HF_CACHE_DIR / "hub")
os.environ["TRANSFORMERS_CACHE"] = str(HF_CACHE_DIR / "hub")
os.environ["HF_DATASETS_CACHE"] = str(HF_CACHE_DIR / "datasets")
os.environ["SENTENCE_TRANSFORMERS_HOME"] = str(HF_CACHE_DIR / "sentence_transformers")
os.environ["TORCH_HOME"] = str(TORCH_CACHE_DIR)
os.environ["XDG_CACHE_HOME"] = str(DATA_DIR / ".cache")
os.environ["TIKTOKEN_CACHE_DIR"] = str(DATA_DIR / "tiktoken_cache")
os.environ["TEMP"] = str(TEMP_DIR)
os.environ["TMP"] = str(TEMP_DIR)
tempfile.tempdir = str(TEMP_DIR)
