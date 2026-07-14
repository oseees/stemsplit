# PoultryPal AI — lean production image (no voice/Whisper in this build).
# The voice feature (faster-whisper + ffmpeg) is intentionally left out to keep the
# image small and runnable on cheap tiers; the app detects its absence and hides the
# mic button / asks WhatsApp voice-note senders to type. A voice-enabled image can be
# added later (install ffmpeg + faster-whisper and point POULTRYPAL_ASR_PYTHON at python).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install Python deps first so this layer is cached across code changes.
COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Application code, frontend, and knowledge sources.
COPY app ./app
COPY web ./web

# Build the TF-IDF knowledge index at build time (no API key needed — it's dependency-free),
# so the container starts instantly and works even if sources change only at build.
RUN python -m app.knowledge.ingest

# Writable data dir for the sqlite case/feedback store. Mount a volume here on the host
# (e.g. a Railway volume at /app/data) to keep the DB across redeploys.
RUN mkdir -p /app/data
ENV POULTRYPAL_DATA_DIR=/app/data

EXPOSE 8000

# The host (Railway) injects $PORT at runtime; default to 8000 locally. Shell form so
# ${PORT} expands. Bind 0.0.0.0 so it's reachable from outside the container.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
