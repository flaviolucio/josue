import os
from pathlib import Path

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./cifra.db")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
STORAGE_DIR = Path(os.getenv("STORAGE_DIR", "./storage")).resolve()
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "large-v3")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "cuda")  # "cuda" ou "cpu"
WHISPER_COMPUTE = os.getenv("WHISPER_COMPUTE", "float16")  # "int8" em CPU
DEMUCS_MODEL = os.getenv("DEMUCS_MODEL", "htdemucs")
DEMUCS_DEVICE = os.getenv("DEMUCS_DEVICE", "cuda")
CORS_ORIGINS = os.getenv("CORS_ORIGINS", "*").split(",")
MAX_BYTES = 100 * 1024 * 1024
MAX_SECONDS = 20 * 60
# Sem Redis (desenvolvimento): processa numa thread do próprio servidor.
USE_QUEUE = os.getenv("USE_QUEUE", "1") == "1"

STORAGE_DIR.mkdir(parents=True, exist_ok=True)
