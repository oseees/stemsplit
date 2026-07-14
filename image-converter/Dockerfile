FROM python:3.11-slim

WORKDIR /app

# Install backend dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./backend/

# Copy frontend static files
COPY frontend/ ./frontend/

# Set working directory to backend for uvicorn
WORKDIR /app/backend

ENV PORT=8000
EXPOSE 8000

# Single worker — image processing is CPU-bound but fast
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 1"]