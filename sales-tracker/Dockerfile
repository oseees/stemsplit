# SalesPal — production image for Railway/Render.
# FastAPI app that also serves its own static mobile frontend. Data is a single
# SQLite file under /app/data — mount a volume there to persist across redeploys.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install deps first so this layer caches across code changes.
COPY backend/requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Application code + static frontend.
COPY backend/ ./

# Writable data dir for the SQLite DB. Mount a Railway volume at /app/data so
# sales/invoices/expenses survive redeploys.
RUN mkdir -p /app/data
ENV SALESPAL_DB=/app/data/salespal.db

EXPOSE 8000

# Railway injects $PORT at runtime; default to 8000 locally. Shell form so ${PORT}
# expands. Bind 0.0.0.0 so it's reachable from outside the container.
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
