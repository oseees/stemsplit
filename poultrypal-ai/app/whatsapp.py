"""WhatsApp bot via the Meta WhatsApp Cloud API.

A farmer messages the business number with a description (typed or a voice note);
the bot reuses the SAME pipeline as the web app — extract fields -> diagnose -> reply —
and sends back a concise text summary with the top diseases, drugs, tests, when to
call a vet, and where to get tested.

Going live needs: a Meta WhatsApp Business app, WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID
in .env, and a public HTTPS webhook URL pointing at /whatsapp/webhook (deploy, or tunnel
with e.g. ngrok during testing). The message-handling/compose logic below is testable
locally without any of that (see compose_reply / build_farm).
"""
from __future__ import annotations

import base64

from . import config, reference_ng
from .classifier import ImageInput
from .diagnosis import diagnose
from .intake import extract_fields
from .schemas import DiagnosisResult, FarmInfo


# ---------------- webhook verification (GET) ----------------
def verify_challenge(mode: str | None, token: str | None, challenge: str | None) -> str | None:
    """Meta calls GET with hub.* params once to verify the webhook."""
    if mode == "subscribe" and token == config.WHATSAPP_VERIFY_TOKEN:
        return challenge
    return None


# ---------------- incoming payload parsing ----------------
def parse_incoming(payload: dict) -> dict | None:
    """Pull the first message out of a Meta webhook payload. Returns
    {from, type, text, media_id} or None (e.g. status callbacks)."""
    try:
        value = payload["entry"][0]["changes"][0]["value"]
        msg = value["messages"][0]
    except (KeyError, IndexError, TypeError):
        return None
    t = msg.get("type")
    out = {"from": msg.get("from"), "type": t, "text": "", "media_id": None}
    if t == "text":
        out["text"] = msg.get("text", {}).get("body", "")
    elif t in ("audio", "voice"):
        out["media_id"] = (msg.get(t) or {}).get("id")
    elif t == "image":
        out["media_id"] = (msg.get("image") or {}).get("id")
        out["text"] = (msg.get("image") or {}).get("caption", "")
    return out


# ---------------- build a FarmInfo from extracted fields ----------------
def _to_int(v):
    try:
        return int(str(v).strip())
    except (ValueError, TypeError):
        return None


def build_farm(text: str) -> FarmInfo:
    """Extract structured fields from a free-text description (best-effort) and
    fall back to using the raw text as the symptom description."""
    fields = {}
    if text and config.has_api_key():
        try:
            fields = extract_fields(text)
        except Exception:
            fields = {}
    return FarmInfo(
        species=fields.get("species") or "chicken (unspecified)",
        state=fields.get("state") or None,
        age=fields.get("age") or None,
        flock_size=_to_int(fields.get("flock_size")),
        sick_count=_to_int(fields.get("sick_count")),
        dead_count=_to_int(fields.get("dead_count")),
        days_since_onset=_to_int(fields.get("days_since_onset")),
        vaccination_history=fields.get("vaccination_history") or None,
        recent_changes=fields.get("recent_changes") or None,
        symptoms=fields.get("symptoms") or text or "unspecified",
    )


# ---------------- format a concise WhatsApp reply ----------------
_URGENCY = {"routine": "🟢 Routine", "soon": "🟡 See a vet soon", "urgent": "🔴 Call a vet URGENTLY"}


def format_reply(result: DiagnosisResult) -> str:
    L: list[str] = ["🐔 *PoultryPal AI* (AI guidance — not a vet diagnosis)\n"]
    L.append("*Most likely:*")
    for i, d in enumerate(result.likely_diseases[:3], 1):
        L.append(f"{i}. {d.name} — {d.confidence_percent}%")
    if result.immediate_actions:
        L.append("\n*Do now:*")
        L += [f"• {a}" for a in result.immediate_actions[:4]]
    if result.drugs:
        L.append("\n*Possible drugs (from references — a vet sets the dose):*")
        L += [f"• {d.name} ({d.source})" for d in result.drugs[:6]]
    if result.recommended_tests:
        L.append("\n*Tests to ask for:*")
        L += [f"• {t.test}" for t in result.recommended_tests[:3]]
    v = result.call_vet
    if v:
        L.append(f"\n*Vet:* {_URGENCY.get(v.urgency, 'See a vet')} — {v.reason}")
    if result.labs:
        L.append("\n*Where to get tested (Nigeria):*")
        L += [f"• {lab.name}: {lab.contact}" for lab in result.labs[:2]]
    L.append("\n⚠️ Confirm drugs/doses with a NAFDAC-registered product label and a licensed vet.")
    return "\n".join(L)


# ---------------- compose (testable without Meta) ----------------
def compose_reply(text: str, image_bytes: bytes | None = None, image_type: str = "image/jpeg") -> str:
    """Full pipeline for one message -> reply text. No network to Meta needed."""
    if not config.has_api_key():
        return (
            "PoultryPal is not fully set up yet (no AI key). Please describe the bird type, age, "
            "number sick/dead, vaccinations, your state, and what you see."
        )
    farm = build_farm(text)
    images = []
    if image_bytes:
        images.append(
            ImageInput(data_b64=base64.standard_b64encode(image_bytes).decode(), media_type=image_type)
        )
    result = diagnose(farm, images)
    return format_reply(result)


# ---------------- Meta Cloud API I/O ----------------
def _client():
    import httpx

    return httpx.Client(timeout=60)


def send_text(to: str, body: str) -> None:
    if not config.has_whatsapp():
        return  # not configured; nothing to send (local/testing)
    url = f"{config.WHATSAPP_API_BASE}/{config.WHATSAPP_PHONE_NUMBER_ID}/messages"
    headers = {"Authorization": f"Bearer {config.WHATSAPP_TOKEN}"}
    payload = {"messaging_product": "whatsapp", "to": to, "type": "text", "text": {"body": body[:4096]}}
    with _client() as c:
        c.post(url, headers=headers, json=payload)


def download_media(media_id: str) -> bytes | None:
    if not (media_id and config.has_whatsapp()):
        return None
    headers = {"Authorization": f"Bearer {config.WHATSAPP_TOKEN}"}
    with _client() as c:
        meta = c.get(f"{config.WHATSAPP_API_BASE}/{media_id}", headers=headers).json()
        media_url = meta.get("url")
        if not media_url:
            return None
        return c.get(media_url, headers=headers).content


def process_payload(payload: dict) -> None:
    """Handle one inbound webhook: parse -> diagnose -> reply. Safe to call in the
    background; swallows errors after attempting a courteous fallback message."""
    msg = parse_incoming(payload)
    if not msg or not msg.get("from"):
        return
    sender = msg["from"]
    try:
        text = msg.get("text", "")
        image_bytes = None
        image_type = "image/jpeg"
        if msg["type"] in ("audio", "voice") and msg.get("media_id"):
            from .transcribe import TranscriptionUnavailable, default_transcriber

            audio = download_media(msg["media_id"])
            if audio:
                try:
                    text = default_transcriber().transcribe(audio).text
                except TranscriptionUnavailable:
                    # Voice not enabled on this deploy — ask the farmer to type instead.
                    send_text(sender, "Voice notes aren't supported here yet. Please *type* the bird type, "
                                      "age, numbers sick/dead, vaccinations, your state, and what you're seeing.")
                    return
        elif msg["type"] == "image" and msg.get("media_id"):
            image_bytes = download_media(msg["media_id"])
        if not text and not image_bytes:
            send_text(sender, "Please send a short description (or voice note) of the bird type, age, "
                              "numbers sick/dead, vaccinations, your state, and what you're seeing.")
            return
        send_text(sender, compose_reply(text, image_bytes, image_type))
    except Exception:
        send_text(sender, "Sorry — something went wrong. Please try again with a short description.")
