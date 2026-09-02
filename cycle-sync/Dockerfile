# Attune — one file, one image. SQLite lives on a volume mounted at /app/data.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
RUN pip install --upgrade pip && pip install fastapi uvicorn

COPY app.py .

# Mount a Railway volume at /app/data so attune.db survives redeploys.
RUN mkdir -p /app/data
ENV ATTUNE_DB=/app/data/attune.db

EXPOSE 8000

# $PORT injected by Railway; --proxy-headers + forwarded-allow-ips '*' so uvicorn trusts
# Railway's proxy, sees https, and mints the session cookie with its Secure flag.
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips '*'"]
