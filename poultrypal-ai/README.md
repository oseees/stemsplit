# 🐔 PoultryPal AI

A mobile-friendly web app that helps poultry farmers reason about possible diseases from
symptoms, flock data, and photos. It gives the **top 3 possibilities with confidence
estimates**, reasoning, immediate actions, isolation steps, a treatment plan, **drugs drawn
only from a knowledge base** (never invented), **confirmatory tests to request**, prevention,
clear guidance on when to call a vet, and a **directory of Nigerian veterinary labs** to get
those tests done.

**Localised for Nigeria:** drugs are framed for Nigerian poultry practice; a hard
**NAFDAC banned-drug guard** ensures chloramphenicol, nitrofurans/furazolidone, metronidazole
and the other banned food-animal drugs are never recommended; and the lab directory points to
NVRI Vom (national reference lab + 23 outstations), state veterinary services, and university
veterinary teaching hospitals.

> ⚠️ **Not a veterinary diagnosis.** Confidence figures are estimates. The knowledge docs are
> educational drafts — confirm drugs, doses and withdrawal periods against the NAFDAC-registered
> product label and a licensed vet, and verify lab contact details before travelling.

## Architecture (hybrid)

```
 Farmer (mobile browser)
        │  symptoms + flock data + photos
        ▼
 FastAPI  ── /api/diagnose ──────────────────────────────────────────┐
        │                                                             │
        │ 1. Image findings  ──► classifier.py (Claude vision)        │  ← pluggable:
        │                          observations only, no diagnosis    │    swap for a
        │                                                             │    trained model
        │ 2. Retrieval       ──► knowledge/ (TF-IDF vector store)     │  ← pluggable:
        │                          top-k passages + citations         │    swap embedder
        │                                                             │    for embeddings/Chroma
        │ 3. Grounded reason ──► Claude (claude-opus-4-8)             │
        │                          structured JSON; drugs ONLY from   │
        │                          retrieved sources                  │
        ▼                                                             │
 Structured result ◄──────────────────────────────────────────────────┘
        │
        ▼  rendered in the PoultryPal format (Summary / Likely diseases / …)
 web/ (vanilla HTML+CSS+JS, mobile-first)
```

- **Backend:** FastAPI (`app/`)
- **Knowledge layer:** curated docs in `app/knowledge/sources/` → chunked + indexed into a
  vector store (`app/knowledge/store.py`). Default embedder is dependency-free **TF-IDF**
  (Python 3.14-safe, no torch). The `Embedder` protocol is the seam to swap in
  sentence-transformers / Voyage / Chroma for semantic search later.
- **Reasoning + vision:** Anthropic API (`claude-opus-4-8`).
- **Frontend:** `web/` — a single mobile-first page, no build step.

## Run it

```bash
cd poultrypal-ai
./run.sh                 # creates .venv, installs deps, builds index, starts server
```

Then open http://localhost:8000.

Add your key to `.env` to enable AI diagnosis:

```
ANTHROPIC_API_KEY=sk-ant-...
```

Without a key the app still runs and the knowledge base still loads — `/api/diagnose`
returns a clear 503 explaining the key is missing.

### Manual steps (if you prefer)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python -m app.knowledge.ingest        # build the index
uvicorn app.main:app --reload --port 8000
```

## Deploy it (public HTTPS — Railway)

For real farmers to install the PWA or for WhatsApp to deliver messages, the app must be
reachable on a public HTTPS URL. The repo ships a lean **`Dockerfile`** (no voice/Whisper —
see below) and a **`railway.json`**; Railway builds the image in the cloud, so you don't need
Docker locally.

```bash
cd poultrypal-ai
railway login           # interactive (opens a browser)
railway init            # create/select a project
railway up              # uploads this folder, builds the Dockerfile, deploys
railway variables --set ANTHROPIC_API_KEY=sk-ant-...   # required for AI diagnosis
railway domain          # generate the public https URL
```

- The image builds the TF-IDF knowledge index at build time and starts uvicorn on `$PORT`.
- `railway.json` sets the health check to `/api/health` and forces the Dockerfile builder.
- **Persistence:** the sqlite case/feedback DB lives at `/app/data` (env `POULTRYPAL_DATA_DIR`).
  Add a Railway **volume mounted at `/app/data`** to keep it across redeploys (otherwise it
  resets each deploy — fine to start with).
- **Voice is intentionally excluded** from this image to keep it small and cheap. The app
  detects its absence: the web mic button stays hidden and WhatsApp voice notes get a polite
  "please type" reply. To add voice later, install `ffmpeg` + `faster-whisper` in the image and
  point `POULTRYPAL_ASR_PYTHON` at the container's `python` (it can share one interpreter on a
  Linux base image — the separate `.venv-asr` is only needed on the dev Mac's Python 3.14).

Once deployed, set the WhatsApp webhook (below) to `https://<your-railway-domain>/whatsapp/webhook`.

## Replacing the sample knowledge with real sources

1. Drop vet-reviewed `.md`, `.txt`, or `.pdf` references into `app/knowledge/sources/`
   (one disease per file works well; the first `# Heading` becomes the citation title).
2. Rebuild the index: `python -m app.knowledge.ingest` — or POST `/api/reindex` while running.

Because drugs are surfaced **only** from retrieved source text, the quality and safety of
treatment advice is exactly the quality of what you put in `sources/`.

## Voice input (speech-to-text)

A farmer can **describe symptoms by voice** instead of typing — useful in the field and for
low-literacy users. The transcript is dropped into the editable Symptoms box with a prompt to
**review and correct it before diagnosing**; it is never fed straight into the model. Supports
English + Hausa/Yoruba/Igbo (auto-detect by default).

- **Engine:** on-device [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) (OpenAI
  Whisper) — accurate, multilingual, **runs offline**, no per-use cost, audio never leaves the
  machine.
- **Isolation:** Whisper has no Python 3.14 wheels yet, so it runs in its **own** `.venv-asr`
  (built from Python 3.9–3.13) and is called as a subprocess. The app's 3.14 venv and the
  protected Demucs `backend/venv` are both left untouched. Browser audio is transcoded to
  16 kHz mono WAV with `ffmpeg` before transcription.
- **Setup:** `./run.sh` builds `.venv-asr` automatically if a suitable Python is found
  (override with `POULTRYPAL_ASR_PYTHON=/path/to/python3.x`). `ffmpeg` must be installed.
- **Accuracy tuning:** the model defaults to `small`. For best accuracy — especially for
  Hausa/Yoruba/Igbo — set `POULTRYPAL_WHISPER_MODEL=medium` (or `large-v3`); larger = more
  accurate but slower and a bigger one-time download. Swap the engine via the `Transcriber`
  protocol in `app/transcribe.py`.

> ⚠️ No speech-to-text is error-free. The review-and-edit step is the safeguard — it keeps a
> mis-heard word from silently changing the diagnosis.

## Install it / use it offline (PWA)

PoultryPal is an installable Progressive Web App. On a phone, open the site and choose
**Add to Home Screen** (Android Chrome shows an install prompt; iOS Safari → Share → Add to
Home Screen). It then opens full-screen like a native app.

- A service worker (`web/sw.js`) pre-caches the app shell, so the form, **Visual symptom
  guide** and **Vaccination schedule** load **with no internet**.
- Caching is **network-first**: when online you always get the latest code (no stale cache);
  the cache is only a fallback when offline.
- The AI **diagnosis** itself needs a connection (it calls the server/Claude); offline, the
  app says so clearly and the reference content still works.
- Bump `CACHE_NAME` in `web/sw.js` to force all installed clients to refresh the shell.

## WhatsApp bot (`app/whatsapp.py`)

Farmers can message the diagnosis in over WhatsApp — typed or as a **voice note** — and get a
concise reply (top diseases, drugs, tests, when to call a vet, nearby labs). It reuses the
exact same pipeline as the web app.

**Endpoints:** `GET /whatsapp/webhook` (Meta verification) and `POST /whatsapp/webhook`
(inbound messages, processed in the background).

**Go live (Meta WhatsApp Cloud API):**
1. Create a Meta WhatsApp Business app and get a phone number ID + access token.
2. Set in `.env`: `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and a `WHATSAPP_VERIFY_TOKEN`
   of your choice (default `poultrypal-verify`).
3. Expose the server over HTTPS (deploy, or tunnel during testing, e.g. `ngrok http 8000`).
4. In the Meta dashboard set the webhook URL to `https://<host>/whatsapp/webhook` and the
   verify token to match, then subscribe to `messages`.

Without these, the bot logic is still fully testable locally (see `compose_reply` /
`build_farm` in `app/whatsapp.py`).

## Production optimizer (`app/performance.py`)

Beyond disease, farmers can raise **output**: a **📈 Boost production** tool gives a grounded plan
to push **broiler weight gain** (towards a good ~2.0–2.5 kg by 6 weeks) or **layer egg production**
(towards peak hen-day). The farmer picks broiler/layer and gives age, current weight or %
production, feed, lighting and challenges; `POST /api/optimize` retrieves the performance docs and
returns a structured plan: current-vs-benchmark assessment, likely gaps, a phase-by-phase feeding
plan, management actions, health checks, a week-by-week timeline, and honest expected outcomes.

Same safety discipline as diagnosis: **numbers are grounded** in two new knowledge sources
(`broiler_performance_nigeria.md`, `layer_performance_nigeria.md`) rather than invented, and the
model is hard-instructed to **never recommend hormones, illegal "boosters", growth-promoter
antibiotics, or NAFDAC-banned drugs** — performance comes from feed quality, management and health.

## Nigeria reference data (`app/reference_ng.py`)

Two things live here as **code, not model output**, so they stay factual:

- **NAFDAC banned-drug guard** — `is_banned()` is applied to every drug after the model
  responds, so a banned food-animal drug can never reach the farmer even if a source names it.
  Update the `NAFDAC_BANNED` list if NAFDAC's list changes.
- **Lab directory** — `lab_directory()` returns the government veterinary route, NVRI Vom (with
  its verified contact), and university veterinary teaching hospitals. Lab names, addresses and
  phone numbers are never generated by the model. Edit this list to add your trusted local labs;
  every contact is flagged "verify current contact" because such details change.

Which **confirmatory test** to request is grounded in the `**Confirmatory test:**` line in each
disease source, so updating a source updates the test guidance too.

## API

| Method | Path             | Purpose                                                        |
| ------ | ---------------- | -------------------------------------------------------------- |
| GET    | `/api/health`    | status, whether a key is set, model, indexed chunk count       |
| POST   | `/api/diagnose`  | multipart: `farm` (JSON) + `images[]` → structured diagnosis (incl. `drugs`, `recommended_tests`, `labs`) |
| POST   | `/api/optimize`  | JSON: `PerformanceRequest` (`bird_type` broiler/layer + flock/feed details) → grounded production plan (targets, gaps, feeding plan, weekly plan) |
| POST   | `/api/transcribe`| multipart: `audio` + `language` → `{ text, language, language_probability }` (voice → text) |
| POST   | `/api/voice-intake`| multipart: `audio` + `language` → `{ transcript, fields }` (voice → filled form fields) |
| POST   | `/api/feedback`  | JSON: `{ case_id, confirmed_disease, outcome, helpful, notes }` → records the outcome    |
| GET    | `/api/stats`     | aggregate accuracy / outcome stats from collected feedback                               |
| GET/POST | `/whatsapp/webhook` | Meta WhatsApp Cloud API: verification + inbound messages                           |
| POST   | `/api/reindex`   | rebuild the knowledge index from `sources/`                    |

## Roadmap / swap-in points

- **Image model:** replace `ClaudeVisionClassifier` in `app/classifier.py` with a model
  fine-tuned on a poultry-image dataset (same `analyze(images) -> str` contract).
- **Semantic retrieval:** implement the `Embedder` protocol in `app/knowledge/store.py`
  with real embeddings + a vector DB.
- **Auth, history, multi-language, offline PWA** as needed for the field.
