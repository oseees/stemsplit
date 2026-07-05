# BeatVideo — python + ffmpeg, single-file app.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN pip install fastapi uvicorn python-multipart

COPY app.py .

EXPOSE 8000

# Railway injects $PORT at runtime; shell form so it expands.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000}"]
