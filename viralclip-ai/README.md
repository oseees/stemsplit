# ViralClip AI

Turn long-form videos into viral-ready TikTok / YouTube Shorts / Instagram Reels.
Next.js 15 (App Router) · TypeScript · TailwindCSS · Supabase (Auth + DB + Storage)
· Stripe subscriptions · OpenAI-compatible AI · FFmpeg.

> **Honesty note:** every score is a **prediction** based on content patterns — never a
> guarantee of virality. The product is designed to help you make **original,
> transformative** content, not to bypass copyright.

---

## 1. Project structure

```
viralclip-ai/
├─ supabase/
│  ├─ schema.sql            # tables, enums, triggers, RPCs
│  └─ policies.sql          # RLS + storage policies
├─ src/
│  ├─ app/
│  │  ├─ page.tsx           # landing
│  │  ├─ login/ signup/     # auth pages
│  │  ├─ auth/callback      # OAuth + email confirm
│  │  ├─ auth/signout
│  │  ├─ dashboard/         # overview, upload, clips, competitor, trends, billing
│  │  └─ api/
│  │     ├─ uploads/sign    # create row + signed upload URL
│  │     ├─ uploads/complete# probe metadata, finalize
│  │     ├─ transcribe      # FFmpeg audio extract + Whisper STT (timestamped)
│  │     ├─ analyze         # AI moment + retention analysis, clip detection
│  │     ├─ clips           # list / adjust
│  │     ├─ clips/export    # ffmpeg render 9:16 + thumbnail
│  │     ├─ intelligence    # hooks/titles/captions/descriptions/hashtags/scores
│  │     ├─ narration       # script (+ /tts for speech)
│  │     ├─ competitor      # URL analysis
│  │     ├─ trends          # trend center
│  │     └─ stripe/         # checkout, portal, webhook
│  ├─ lib/
│  │  ├─ supabase/          # browser, server, admin, middleware clients
│  │  ├─ ai/                # client, analysis, intelligence, narration, competitor, trends
│  │  ├─ stripe.ts plans.ts usage.ts ffmpeg.ts auth.ts api.ts utils.ts
│  ├─ components/           # auth-form, dashboard/*
│  └─ types/database.ts     # typed schema mirror
├─ middleware.ts            # session refresh + route protection
└─ .env.example
```

## 2. Database & Supabase setup

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run **`supabase/schema.sql`** then **`supabase/policies.sql`**.
   - This creates all 9 tables (`profiles`, `subscriptions`, `uploads`, `clips`,
     `analysis`, `narrations`, `viral_scores`, `competitor_reports`,
     `usage_tracking`), enables RLS (owner-scoped), and wires a trigger that
     auto-creates a `profile` + free `subscription` on signup.
   - `policies.sql` also creates a **private** `uploads` storage bucket and
     namespaced read/write policies (`<user_id>/...`).
3. **Auth providers:** Dashboard → Authentication → Providers → enable **Email** and
   **Google** (add Google OAuth client id/secret). Set the redirect URL to
   `https://YOUR_DOMAIN/auth/callback` (and `http://localhost:3000/auth/callback` for dev).
4. Copy your keys into `.env` (see step 4).

## 3. Stripe setup

1. Create two recurring **Products/Prices** (Pro, Agency). Copy their `price_…` ids.
2. Add a webhook endpoint → `https://YOUR_DOMAIN/api/stripe/webhook`, subscribe to
   `checkout.session.completed`, `customer.subscription.created|updated|deleted`.
   Copy the signing secret.
3. Put the keys in `.env`. The webhook keeps the `subscriptions` table in sync using the
   Supabase **service role** key (server-only).

## 4. Environment

```bash
cp .env.example .env   # then fill in values
```

Required: Supabase URL + anon + service-role keys, `AI_API_KEY` (+ optional
`AI_BASE_URL`/`AI_MODEL` for any OpenAI-compatible provider), Stripe keys + price ids,
`NEXT_PUBLIC_SITE_URL`.

## 5. AI architecture

- One OpenAI-compatible client (`src/lib/ai/client.ts`) — point `AI_BASE_URL` at OpenAI,
  OpenRouter, Groq, Together, or a local vLLM server.
- **Analysis** consumes a *timestamped transcript* (produced by a speech-to-text step
  such as Whisper) + duration, and returns moments (hook/emotional/high-energy/suspense/
  funny/educational) and a retention report. Clip windows (15/30/60s) are then derived
  deterministically around the strongest moments.
- **Intelligence** generates 10 hooks, 20 titles, 5 caption styles, 3 platform
  descriptions, 3 hashtag groups, and predicted virality/retention/engagement scores
  with reasons + improvements.
- **Narration / Competitor / Trends** are independent prompt modules.

**Transcription worker** (`src/lib/ai/transcribe.ts` + `/api/transcribe`): downloads the
uploaded file, extracts mono 16kHz audio with FFmpeg, splits long media into ~20-minute
chunks (kept under the API size limit), transcribes each via the provider's Whisper
endpoint with `verbose_json` + segment timestamps, offsets each chunk back onto a
continuous timeline, and stores the segments on `uploads.transcript`. The upload flow
calls it between *complete* and *analyze* (best-effort — if FFmpeg/Whisper aren't
available it skips and analysis falls back). `/api/analyze` prefers a transcript in the
request body, then the stored one, then a placeholder. Set `AI_TRANSCRIBE_MODEL`
(default `whisper-1`). For very long videos, invoke `transcribeFile()` from a queue
worker instead of the request path.

## 6. FFmpeg integration

`src/lib/ffmpeg.ts` shells out to `ffmpeg`/`ffprobe` for metadata probing, 9:16 clip
rendering, and thumbnails. Install FFmpeg on the host (`brew install ffmpeg` /
`apt install ffmpeg`). On serverless platforms without FFmpeg, move `clips/export` and
server-side probing into a worker (Railway/Fly/Render/a container) — the function
signatures are unchanged. The upload flow reads duration client-side, so probing is
optional in dev.

## 7. Run locally

```bash
npm install
npm run dev        # http://localhost:3000
npm run typecheck  # strict TS check
npm run build      # production build
```

Use the Stripe CLI to test webhooks locally:
`stripe listen --forward-to localhost:3000/api/stripe/webhook`.

## 8. Deployment

- **App:** deploy to Vercel (Next.js 15 native). Add all `.env` vars in project settings.
  Set the Supabase Auth redirect + Stripe webhook to your production domain.
- **FFmpeg jobs:** Vercel functions don't ship FFmpeg — run the export/probe routes (or a
  dedicated queue worker) on a container host (Railway/Fly/Render) and call them, or use a
  layer/binary. Everything else (auth, AI, Stripe, dashboard) runs on Vercel as-is.
- After deploy, re-run `schema.sql`/`policies.sql` only if you didn't already, and verify
  the webhook delivers (`subscriptions` row flips to `pro`/`agency` after checkout).

## 9. Subscription tiers

| | Free | Pro | Agency |
|---|---|---|---|
| Uploads / month | 5 | ∞ | ∞ |
| AI analysis & clip detection | ✓ | ✓ | ✓ |
| Viral intelligence | — | ✓ | ✓ |
| AI narration | — | ✓ | ✓ |
| Competitor analysis | — | ✓ | ✓ |
| Team / bulk / priority | — | — | ✓ |

Quotas are enforced in `src/lib/usage.ts`; feature gates in `src/lib/plans.ts` +
`withAuth({ feature })`.

## 10. What's stubbed (and where to extend)

- **Transcription** — implemented via FFmpeg + Whisper (`/api/transcribe`, see §5). For
  very long media move `transcribeFile()` into a background queue worker.
- **TTS** — `/api/narration/tts` calls the provider's `audio.speech`; not all
  OpenAI-compatible endpoints support it.
- **Team accounts / bulk / priority queue** — Agency limits are defined but the
  multi-seat + queue infra is left as the next milestone.
```
