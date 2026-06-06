import asyncio
import json
import os
import shutil
import subprocess
import uuid
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import aiofiles
import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Request, UploadFile

load_dotenv(Path(__file__).parent / ".env")
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

app = FastAPI(title="StemSplit AI API", version="1.0.0")

# CORS origins from env (comma-separated), defaults to local dev
_origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
ALLOWED_ORIGINS = [o.strip() for o in _origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Persistent data dir (override with DATA_DIR for cloud volumes)
BASE_DIR = Path(os.getenv("DATA_DIR", Path(__file__).parent))
UPLOAD_DIR = BASE_DIR / "uploads"
OUTPUT_DIR = BASE_DIR / "outputs"
JOBS_DIR = BASE_DIR / "jobs"
LICENSE_FILE = BASE_DIR / "licenses.json"

for d in [UPLOAD_DIR, OUTPUT_DIR, JOBS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

# ---------- PayPal config ----------
PAYPAL_CLIENT_ID = os.getenv("PAYPAL_CLIENT_ID", "")
PAYPAL_SECRET = os.getenv("PAYPAL_SECRET", "")
PAYPAL_MODE = os.getenv("PAYPAL_MODE", "sandbox")  # "sandbox" or "live"
PAYPAL_API = "https://api-m.paypal.com" if PAYPAL_MODE == "live" else "https://api-m.sandbox.paypal.com"
PAYPAL_WEBHOOK_ID = os.getenv("PAYPAL_WEBHOOK_ID", "")
PRO_PRICE = os.getenv("PRO_PRICE", "9.99")
PRO_CURRENCY = os.getenv("PRO_CURRENCY", "USD")

ALLOWED_TYPES = {"audio/mpeg", "audio/wav", "audio/x-wav", "audio/flac", "audio/aac", "audio/mp3", "audio/mp4"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


# ---------- Job helpers ----------

def job_path(job_id: str) -> Path:
    return JOBS_DIR / f"{job_id}.json"


def read_job(job_id: str) -> dict:
    p = job_path(job_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="Job not found")
    return json.loads(p.read_text())


def write_job(data: dict):
    job_path(data["id"]).write_text(json.dumps(data, indent=2))


def make_job(job_id: str, filename: str) -> dict:
    return {
        "id": job_id,
        "status": "queued",
        "progress": 0,
        "stage": "Queued",
        "filename": filename,
        "created_at": datetime.utcnow().isoformat(),
        "stems": None,
        "error": None,
    }


# ---------- Endpoints ----------

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/upload")
async def upload_audio(file: UploadFile = File(...)):
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, "File too large. Maximum size is 50MB.")

    content_type = file.content_type or ""
    if not any(t in content_type for t in ["audio", "mpeg", "wav", "flac", "aac"]):
        # Accept by extension if content type is wrong
        ext = Path(file.filename or "").suffix.lower()
        if ext not in {".mp3", ".wav", ".flac", ".aac", ".m4a"}:
            raise HTTPException(400, "Unsupported file type.")

    job_id = str(uuid.uuid4())
    ext = Path(file.filename or "track.mp3").suffix or ".mp3"
    upload_path = UPLOAD_DIR / f"{job_id}{ext}"

    async with aiofiles.open(upload_path, "wb") as f:
        await f.write(content)

    job = make_job(job_id, file.filename or "track")
    job["upload_path"] = str(upload_path)
    write_job(job)

    return {"job_id": job_id}


class SeparateRequest(BaseModel):
    job_id: str


@app.post("/separate")
async def separate(req: SeparateRequest):
    job = read_job(req.job_id)
    if job["status"] not in ("queued", "error"):
        return job

    asyncio.create_task(run_separation(req.job_id))
    return job


@app.get("/status/{job_id}")
def status(job_id: str):
    return read_job(job_id)


@app.get("/download/{job_id}/{stem}")
def download(job_id: str, stem: str):
    job = read_job(job_id)
    if job["status"] != "done":
        raise HTTPException(400, "Job not complete yet.")

    output_dir = Path(OUTPUT_DIR) / job_id

    if stem == "zip":
        zip_path = output_dir / "stems.zip"
        if not zip_path.exists():
            _create_zip(job_id, output_dir)
        return FileResponse(str(zip_path), filename=f"{Path(job['filename']).stem}_stems.zip", media_type="application/zip")

    stem_file = output_dir / f"{stem}.wav"
    if not stem_file.exists():
        raise HTTPException(404, f"Stem '{stem}' not found.")

    return FileResponse(
        str(stem_file),
        filename=f"{Path(job['filename']).stem}_{stem}.wav",
        media_type="audio/wav",
        headers={"Accept-Ranges": "bytes"},
    )


@app.get("/history")
def history():
    jobs = []
    for p in sorted(JOBS_DIR.glob("*.json"), key=lambda x: x.stat().st_mtime, reverse=True):
        try:
            jobs.append(json.loads(p.read_text()))
        except Exception:
            pass
    return jobs[:50]


# ---------- PayPal payments (one-time Pro unlock) ----------

def _read_licenses() -> dict:
    if LICENSE_FILE.exists():
        try:
            return json.loads(LICENSE_FILE.read_text())
        except Exception:
            return {}
    return {}


def _write_licenses(data: dict):
    LICENSE_FILE.write_text(json.dumps(data, indent=2))


async def _paypal_token() -> str:
    if not PAYPAL_CLIENT_ID or not PAYPAL_SECRET:
        raise HTTPException(503, "PayPal is not configured. Set PAYPAL_CLIENT_ID and PAYPAL_SECRET.")
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{PAYPAL_API}/v1/oauth2/token",
            auth=(PAYPAL_CLIENT_ID, PAYPAL_SECRET),
            data={"grant_type": "client_credentials"},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
    if resp.status_code != 200:
        raise HTTPException(502, f"PayPal auth failed: {resp.text[:200]}")
    return resp.json()["access_token"]


@app.get("/payments/config")
def payment_config():
    """Public config the frontend needs to render the PayPal button."""
    return {
        "configured": bool(PAYPAL_CLIENT_ID and PAYPAL_SECRET),
        "client_id": PAYPAL_CLIENT_ID,
        "mode": PAYPAL_MODE,
        "price": PRO_PRICE,
        "currency": PRO_CURRENCY,
    }


@app.post("/payments/create-order")
async def create_order():
    token = await _paypal_token()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{PAYPAL_API}/v2/checkout/orders",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "intent": "CAPTURE",
                "purchase_units": [{
                    "amount": {"currency_code": PRO_CURRENCY, "value": PRO_PRICE},
                    "description": "StemSplit AI — Pro lifetime unlock",
                }],
            },
        )
    if resp.status_code not in (200, 201):
        raise HTTPException(502, f"Failed to create order: {resp.text[:200]}")
    return {"order_id": resp.json()["id"]}


class CaptureRequest(BaseModel):
    order_id: str


@app.post("/payments/capture-order")
async def capture_order(req: CaptureRequest):
    token = await _paypal_token()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{PAYPAL_API}/v2/checkout/orders/{req.order_id}/capture",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        )
    if resp.status_code not in (200, 201):
        raise HTTPException(502, f"Failed to capture order: {resp.text[:200]}")

    data = resp.json()
    if data.get("status") != "COMPLETED":
        raise HTTPException(400, f"Payment not completed (status: {data.get('status')}).")

    # Extract the capture ID (used later to match refund/dispute webhooks)
    capture_id = ""
    try:
        capture_id = data["purchase_units"][0]["payments"]["captures"][0]["id"]
    except (KeyError, IndexError):
        pass

    # Issue a Pro license tied to the captured PayPal order
    license_key = str(uuid.uuid4())
    licenses = _read_licenses()
    licenses[license_key] = {
        "order_id": req.order_id,
        "capture_id": capture_id,
        "plan": "pro",
        "status": "active",
        "created_at": datetime.utcnow().isoformat(),
        "payer": data.get("payer", {}).get("email_address", ""),
    }
    _write_licenses(licenses)

    return {"status": "pro", "license": license_key}


@app.get("/payments/verify/{license_key}")
def verify_license(license_key: str):
    licenses = _read_licenses()
    info = licenses.get(license_key)
    active = bool(info) and info.get("status", "active") == "active"
    return {"valid": active, "plan": info["plan"] if active else "free"}


# Webhook events that should revoke a Pro unlock
_REVOKE_EVENTS = {
    "PAYMENT.CAPTURE.REFUNDED",
    "PAYMENT.CAPTURE.REVERSED",
    "CUSTOMER.DISPUTE.CREATED",
}


async def _verify_webhook_signature(headers, body: bytes, event: dict) -> bool:
    """Verify the webhook came from PayPal. Skipped if PAYPAL_WEBHOOK_ID is unset."""
    if not PAYPAL_WEBHOOK_ID:
        return True  # testing mode — no verification
    token = await _paypal_token()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{PAYPAL_API}/v1/notifications/verify-webhook-signature",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "auth_algo": headers.get("paypal-auth-algo"),
                "cert_url": headers.get("paypal-cert-url"),
                "transmission_id": headers.get("paypal-transmission-id"),
                "transmission_sig": headers.get("paypal-transmission-sig"),
                "transmission_time": headers.get("paypal-transmission-time"),
                "webhook_id": PAYPAL_WEBHOOK_ID,
                "webhook_event": event,
            },
        )
    return resp.status_code == 200 and resp.json().get("verification_status") == "SUCCESS"


@app.post("/payments/webhook")
async def paypal_webhook(request: Request):
    body = await request.body()
    try:
        event = json.loads(body)
    except json.JSONDecodeError:
        raise HTTPException(400, "Invalid JSON")

    if not await _verify_webhook_signature(request.headers, body, event):
        raise HTTPException(401, "Webhook signature verification failed")

    event_type = event.get("event_type", "")
    if event_type not in _REVOKE_EVENTS:
        return {"ok": True, "ignored": event_type}

    # Collect candidate identifiers from the raw payload, then revoke any
    # license whose stored capture_id / order_id appears among them.
    raw = body.decode("utf-8", errors="ignore")
    licenses = _read_licenses()
    revoked = []
    for key, info in licenses.items():
        cap = info.get("capture_id") or ""
        order = info.get("order_id") or ""
        if (cap and cap in raw) or (order and order in raw):
            if info.get("status") != "revoked":
                info["status"] = "revoked"
                info["revoked_reason"] = event_type
                info["revoked_at"] = datetime.utcnow().isoformat()
                revoked.append(key)
    if revoked:
        _write_licenses(licenses)

    return {"ok": True, "event": event_type, "revoked": len(revoked)}


# ---------- Background separation ----------

async def run_separation(job_id: str):
    job = read_job(job_id)
    upload_path = job.get("upload_path")

    if not upload_path or not Path(upload_path).exists():
        job.update(status="error", error="Upload file not found.")
        write_job(job)
        return

    output_dir = OUTPUT_DIR / job_id
    output_dir.mkdir(exist_ok=True)

    try:
        job.update(status="processing", progress=10, stage="Analysing audio...")
        write_job(job)

        job.update(status="processing", progress=25, stage="Loading AI model...")
        write_job(job)

        # Run Demucs in subprocess
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _run_demucs, upload_path, str(output_dir), job_id)

        # Find the stem files Demucs outputs
        stems = _find_stems(output_dir, job_id)
        if not stems:
            raise RuntimeError("Demucs did not produce expected output files.")

        _create_zip(job_id, output_dir)

        job.update(
            status="done",
            progress=100,
            stage="Complete",
            stems=stems,
        )
        write_job(job)

    except Exception as e:
        job.update(status="error", error=str(e), stage="Error")
        write_job(job)


def _detect_device() -> str:
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda"
        if torch.backends.mps.is_available():
            return "mps"
    except Exception:
        pass
    return "cpu"


def _run_demucs(upload_path: str, output_dir: str, job_id: str):
    """Run demucs as a subprocess. Uses GPU (cuda/mps) when available."""
    device = _detect_device()

    cmd = [
        "python3", "-m", "demucs",
        "-n", "htdemucs",
        "-d", device,
        "--segment", "7",       # htdemucs transformer max is 7.8; keep under it
        "--overlap", "0.1",     # less overlap = faster (default 0.25)
        "--out", output_dir,
        upload_path,
    ]

    env = {**os.environ, "PYTORCH_ENABLE_MPS_FALLBACK": "1"}
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=900, env=env)

    # Log full output for debugging
    log_file = Path(output_dir) / "demucs.log"
    log_file.write_text(
        f"CMD: {' '.join(cmd)}\nRETURN: {result.returncode}\n\n"
        f"=== STDOUT ===\n{result.stdout}\n\n=== STDERR ===\n{result.stderr}"
    )

    if result.returncode != 0:
        # Surface real errors, skipping the noisy torchaudio deprecation warning
        lines = [l for l in result.stderr.splitlines() if "UserWarning" not in l and "warnings.warn" not in l]
        real_error = "\n".join(lines).strip() or result.stderr
        raise RuntimeError(f"Demucs failed (exit {result.returncode}): {real_error[-800:]}")


def _find_stems(output_dir: Path, job_id: str) -> Optional[dict]:
    """Locate stem wav files after Demucs runs and copy them to a flat structure."""
    stem_names = ["vocals", "drums", "bass", "other"]
    result = {}

    # Demucs outputs to: output_dir/htdemucs/<track_name>/{vocals,drums,bass,other}.wav
    for wav in output_dir.rglob("*.wav"):
        name = wav.stem.lower()
        if name in stem_names:
            dest = output_dir / f"{name}.wav"
            if not dest.exists():
                shutil.copy2(wav, dest)
            result[name] = str(dest)

    if not all(s in result for s in stem_names):
        return None

    return {s: f"/download/{job_id}/{s}" for s in stem_names}


def _create_zip(job_id: str, output_dir: Path):
    zip_path = output_dir / "stems.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for stem in ["vocals", "drums", "bass", "other"]:
            p = output_dir / f"{stem}.wav"
            if p.exists():
                zf.write(p, f"{stem}.wav")


# ---------- Cleanup old files (runs on startup) ----------

@app.on_event("startup")
async def cleanup_old():
    cutoff = datetime.utcnow() - timedelta(hours=24)
    for p in JOBS_DIR.glob("*.json"):
        try:
            job = json.loads(p.read_text())
            created = datetime.fromisoformat(job.get("created_at", ""))
            if created < cutoff:
                job_id = job["id"]
                # Remove upload
                up = job.get("upload_path")
                if up and Path(up).exists():
                    Path(up).unlink(missing_ok=True)
                # Remove output dir
                out = OUTPUT_DIR / job_id
                if out.exists():
                    shutil.rmtree(out)
                p.unlink(missing_ok=True)
        except Exception:
            pass
