"""Central configuration, loaded once from the environment."""
from __future__ import annotations

import os
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:  # dotenv is optional; env vars may be set another way
    pass

# --- Paths -----------------------------------------------------------------
APP_DIR = Path(__file__).resolve().parent
PROJECT_DIR = APP_DIR.parent
KNOWLEDGE_DIR = APP_DIR / "knowledge"
SOURCES_DIR = KNOWLEDGE_DIR / "sources"
INDEX_DIR = KNOWLEDGE_DIR / "index"
INDEX_PATH = INDEX_DIR / "knowledge_index.json"
WEB_DIR = PROJECT_DIR / "web"

# --- Voice / ASR (isolated Whisper venv, called as a subprocess) -----------
# Whisper runs in its OWN venv (.venv-asr, Python 3.9 + faster-whisper) so the
# heavy ctranslate2/av wheels never enter the app's Python 3.14 venv.
# --- Case / outcome store (sqlite, local) ----------------------------------
# DATA_DIR is env-overridable so a deploy can point it at a mounted volume
# (e.g. Railway volume at /app/data) and keep the case/feedback DB across redeploys.
DATA_DIR = Path(os.environ.get("POULTRYPAL_DATA_DIR", str(PROJECT_DIR / "data")))
CASES_DB = DATA_DIR / "cases.db"

ASR_DIR = PROJECT_DIR / "asr"
ASR_WORKER = ASR_DIR / "transcribe_worker.py"
ASR_VENV_PYTHON = Path(
    os.environ.get("POULTRYPAL_ASR_PYTHON", str(PROJECT_DIR / ".venv-asr" / "bin" / "python"))
)
# small = fast + good; bump to "medium" or "large-v3" for best accuracy, especially
# for Hausa / Yoruba / Igbo (slower, larger one-time download).
WHISPER_MODEL = os.environ.get("POULTRYPAL_WHISPER_MODEL", "small")
WHISPER_COMPUTE = os.environ.get("POULTRYPAL_WHISPER_COMPUTE", "int8")
ASR_TIMEOUT_SECONDS = int(os.environ.get("POULTRYPAL_ASR_TIMEOUT", "180"))

# --- Model / API -----------------------------------------------------------
# Default to Opus 4.8: multimodal (handles the image-findings step) and strong
# at the structured clinical reasoning we ask for.
MODEL = os.environ.get("POULTRYPAL_MODEL", "claude-opus-4-8")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "").strip()

# --- Retrieval -------------------------------------------------------------
TOP_K = int(os.environ.get("POULTRYPAL_TOP_K", "6"))

# --- Upload limits ---------------------------------------------------------
MAX_IMAGES = 4
MAX_IMAGE_BYTES = 8 * 1024 * 1024  # 8 MB per image
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}

MAX_AUDIO_BYTES = 25 * 1024 * 1024  # 25 MB voice clip
# Languages offered for voice input (ISO code -> label). "" = auto-detect.
ASR_LANGUAGES = {"": "Auto-detect", "en": "English", "ha": "Hausa", "yo": "Yoruba", "ig": "Igbo"}


# --- WhatsApp (Meta Cloud API) --------------------------------------------
# To go live: create a Meta WhatsApp Business app, then set these in .env and
# point the webhook at https://<your-public-host>/whatsapp/webhook.
WHATSAPP_VERIFY_TOKEN = os.environ.get("WHATSAPP_VERIFY_TOKEN", "poultrypal-verify").strip()
WHATSAPP_TOKEN = os.environ.get("WHATSAPP_TOKEN", "").strip()
WHATSAPP_PHONE_NUMBER_ID = os.environ.get("WHATSAPP_PHONE_NUMBER_ID", "").strip()
WHATSAPP_API_BASE = os.environ.get("WHATSAPP_API_BASE", "https://graph.facebook.com/v21.0").rstrip("/")


def has_api_key() -> bool:
    return bool(ANTHROPIC_API_KEY)


def has_whatsapp() -> bool:
    return bool(WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID)


def has_asr() -> bool:
    """True if the isolated Whisper venv is present and runnable."""
    return ASR_VENV_PYTHON.exists() and ASR_WORKER.exists()
