FROM python:3.11-slim

# ffmpeg is required by Demucs/torchaudio for MP3/AAC decoding
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

# Persist uploads/outputs/jobs/licenses to a mounted volume
ENV DATA_DIR=/data
VOLUME ["/data"]

ENV PORT=8000
EXPOSE 8000

# Single worker: separation jobs run as in-process background tasks
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 1"]
