"""FastAPI app: serves the mobile-friendly UI and the /api/diagnose endpoint."""
from __future__ import annotations

import base64
import json
import uuid

from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from . import whatsapp

from . import config, store_cases
from .classifier import ImageInput
from .diagnosis import diagnose
from .knowledge import get_store, reload_store
from .llm import LLMUnavailable
from .schemas import FarmInfo, FeedbackIn, PerformanceRequest
from .transcribe import TranscriptionError, TranscriptionUnavailable, default_transcriber
from .intake import extract_fields
from .performance import optimize

app = FastAPI(title="PoultryPal AI", version="0.1.0")
store_cases.init_db()


@app.middleware("http")
async def no_store(request, call_next):
    """Disable browser caching so UI updates always reach the user (no stale JS/CSS)."""
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
    return response


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "has_api_key": config.has_api_key(),
        "model": config.MODEL,
        "knowledge_chunks": len(get_store()),
        "has_voice": config.has_asr(),
        "voice_languages": config.ASR_LANGUAGES,
        "whisper_model": config.WHISPER_MODEL,
        "has_whatsapp": config.has_whatsapp(),
    }


@app.post("/api/reindex")
def reindex():
    """Rebuild the knowledge index from sources/ (after adding new reference docs)."""
    store = reload_store()
    return {"status": "ok", "knowledge_chunks": len(store)}


@app.post("/api/transcribe")
async def api_transcribe(
    audio: UploadFile = File(..., description="Recorded voice clip"),
    language: str = Form("", description='ISO code (en/ha/yo/ig) or "" to auto-detect'),
):
    """Speech-to-text for the symptom description. Returns the transcript for the
    farmer to REVIEW and edit before diagnosing — it is never fed straight in."""
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=422, detail="Empty audio.")
    if len(data) > config.MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio clip too large (max 25 MB).")
    try:
        result = default_transcriber().transcribe(data, language=language)
    except TranscriptionUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except TranscriptionError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")
    return {
        "text": result.text,
        "language": result.language,
        "language_probability": result.language_probability,
        "duration": result.duration,
    }


@app.post("/api/voice-intake")
async def api_voice_intake(
    audio: UploadFile = File(..., description="Recorded voice clip"),
    language: str = Form("", description='ISO code (en/ha/yo/ig) or "" to auto-detect'),
):
    """Voice → transcript → structured form fields (bird type, age, flock size,
    vaccinations, state, symptoms…). Fields are returned for the farmer to REVIEW
    and edit before diagnosing. If no API key, returns transcript-only (symptoms)."""
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=422, detail="Empty audio.")
    if len(data) > config.MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Audio clip too large (max 25 MB).")
    try:
        t = default_transcriber().transcribe(data, language=language)
    except TranscriptionUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except TranscriptionError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Transcription failed: {e}")

    fields: dict = {}
    extracted = False
    if t.text and config.has_api_key():
        try:
            fields = extract_fields(t.text)
            extracted = True
        except Exception:
            fields = {}  # extraction is best-effort; fall back to the transcript
    if not extracted and t.text:
        fields = {"symptoms": t.text}  # no key / extraction failed -> at least fill symptoms

    return {
        "transcript": t.text,
        "language": t.language,
        "language_probability": t.language_probability,
        "extracted": extracted,
        "fields": fields,
    }


@app.post("/api/diagnose")
async def api_diagnose(
    farm: str = Form(..., description="JSON-encoded FarmInfo"),
    images: list[UploadFile] = File(default=[]),
):
    # --- validate farm payload ---
    try:
        farm_info = FarmInfo(**json.loads(farm))
    except (json.JSONDecodeError, ValidationError) as e:
        raise HTTPException(status_code=422, detail=f"Invalid farm data: {e}")

    # --- validate + encode images ---
    if len(images) > config.MAX_IMAGES:
        raise HTTPException(status_code=413, detail=f"Max {config.MAX_IMAGES} images.")
    image_inputs: list[ImageInput] = []
    for up in images:
        if up.content_type not in config.ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=415,
                detail=f"Unsupported image type: {up.content_type}. Use JPEG/PNG/WebP/GIF.",
            )
        data = await up.read()
        if len(data) > config.MAX_IMAGE_BYTES:
            raise HTTPException(status_code=413, detail=f"{up.filename} exceeds 8 MB.")
        image_inputs.append(
            ImageInput(data_b64=base64.standard_b64encode(data).decode(), media_type=up.content_type)
        )

    # --- run the pipeline ---
    try:
        result = diagnose(farm_info, image_inputs)
    except LLMUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:  # surface a clean error to the UI rather than a 500 stack
        raise HTTPException(status_code=502, detail=f"Diagnosis failed: {e}")

    data = result.model_dump()
    # Save the case so the farmer/vet can report the outcome later (accuracy loop).
    data["case_id"] = uuid.uuid4().hex
    try:
        store_cases.save_case(data["case_id"], farm_info.model_dump(), data)
    except Exception:
        pass  # never fail a diagnosis because storage hiccuped
    return JSONResponse(data)


@app.post("/api/optimize")
def api_optimize(req: PerformanceRequest):
    """Production optimizer: grounded plan to raise broiler weight gain or layer egg output."""
    try:
        plan = optimize(req)
    except LLMUnavailable as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Optimization failed: {e}")
    return JSONResponse(plan.model_dump())


@app.post("/api/feedback")
def api_feedback(fb: FeedbackIn):
    """Record what was actually confirmed / the outcome, tied to a diagnosis case_id."""
    try:
        store_cases.save_feedback(
            fb.case_id,
            confirmed_disease=fb.confirmed_disease or "",
            treatment_used=fb.treatment_used or "",
            outcome=fb.outcome or "",
            helpful=fb.helpful,
            notes=fb.notes or "",
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not save feedback: {e}")
    return {"status": "ok"}


@app.get("/api/stats")
def api_stats():
    """Aggregate accuracy/outcome stats from collected feedback (owner view)."""
    return store_cases.stats()


@app.get("/whatsapp/webhook")
def whatsapp_verify(request: Request):
    """Meta calls this once to verify the webhook subscription."""
    q = request.query_params
    challenge = whatsapp.verify_challenge(
        q.get("hub.mode"), q.get("hub.verify_token"), q.get("hub.challenge")
    )
    if challenge is None:
        raise HTTPException(status_code=403, detail="Verification failed")
    return PlainTextResponse(challenge)


@app.post("/whatsapp/webhook")
async def whatsapp_incoming(request: Request, background: BackgroundTasks):
    """Receive an inbound WhatsApp message; process in the background and 200 fast
    (Meta retries if we're slow)."""
    payload = await request.json()
    background.add_task(whatsapp.process_payload, payload)
    return {"status": "received"}


# Static UI mounted last so it doesn't shadow the /api/* routes above.
app.mount("/", StaticFiles(directory=str(config.WEB_DIR), html=True), name="web")
