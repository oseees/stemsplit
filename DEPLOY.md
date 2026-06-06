# StemSplit AI — Deployment Guide

The app is two services: a **Next.js frontend** and a **FastAPI backend** (runs Demucs).
Both have Dockerfiles and are wired together with `docker-compose.yml`.

## Important: where this can run

Demucs needs **ffmpeg, RAM, and CPU/GPU time** and runs jobs as long background
processes that write to disk. It **cannot** run on Vercel/Netlify/serverless.
Deploy the backend to a host that gives you a real container + persistent disk:
**Render, Railway, Fly.io, or any VM**. CPU-only works but a 3-min track takes
~2–4 min; a GPU host makes it seconds.

The frontend is static-friendly and can go anywhere (Vercel, or the same host).

---

## 1. Set up PayPal (you must do this — I can't access your account)

1. Go to https://developer.paypal.com/dashboard/applications/sandbox
2. Create an app → copy the **Client ID** and **Secret**.
3. Start in **sandbox** mode and test with PayPal's sandbox buyer account.
4. When ready for real money: create a **Live** app and set `PAYPAL_MODE=live`.

## 2. Configure environment

**Backend** (`backend/.env`, see `.env.example`):
```
ALLOWED_ORIGINS=https://yourdomain.com
PAYPAL_CLIENT_ID=...
PAYPAL_SECRET=...
PAYPAL_MODE=sandbox
PRO_PRICE=9.99
PRO_CURRENCY=USD
```

**Frontend** (`frontend/.env`, see `.env.example`) — baked in at build time:
```
NEXT_PUBLIC_API_URL=https://api.yourdomain.com
```

## 3. Run locally with Docker

```bash
# from project root, with PAYPAL_* exported or in a root .env
docker compose up --build
# frontend → http://localhost:3000   backend → http://localhost:8000
```

## 4. Recommended budget deploy (~$5/mo): Hetzner VPS + Vercel

Frontend on Vercel (free). Backend on a small VPS running Docker. Caddy gives the
backend automatic HTTPS (required for PayPal webhooks).

### A. Buy the pieces
- A domain (~$10/yr; Cloudflare or Namecheap).
- A Hetzner Cloud server: **CX22** (2 vCPU / 4 GB RAM / 40 GB) — ~€4.5/mo.
  Pick Ubuntu 24.04. 4 GB RAM matters: Demucs OOMs on 512 MB–1 GB boxes.

### B. DNS
- `api.yourdomain.com` → **A record** → your VPS IP.
- `yourdomain.com` (and `www`) → Vercel (set later when you add the domain in Vercel).

### C. Backend on the VPS
```bash
ssh root@YOUR_VPS_IP

# install docker
curl -fsSL https://get.docker.com | sh

# get the code (git clone your repo, or scp the project up)
git clone <your-repo-url> stemsplit && cd stemsplit

# create backend/.env from the example and fill in real values
cp backend/.env.example backend/.env
nano backend/.env
#   ALLOWED_ORIGINS=https://yourdomain.com
#   PAYPAL_CLIENT_ID=...   PAYPAL_SECRET=...   PAYPAL_MODE=live
#   PRO_PRICE=9.99   PRO_CURRENCY=USD   PAYPAL_WEBHOOK_ID=...(after step E)

# point Caddy at your real domain
nano Caddyfile          # replace api.yourdomain.com

# launch backend + Caddy (auto HTTPS)
docker compose -f docker-compose.prod.yml up -d --build
```
Verify: `https://api.yourdomain.com/health` → `{"status":"ok"}`.
First separation is slow (downloads the ~80 MB Demucs model once, then caches it).

### D. Frontend on Vercel
- Import the repo in Vercel, set **Root Directory = `frontend`**.
- Add env var `NEXT_PUBLIC_API_URL = https://api.yourdomain.com`.
- Deploy, then add `yourdomain.com` under the project's Domains tab and follow
  Vercel's DNS instructions.

### E. PayPal webhook (refund/dispute auto-revoke)
- PayPal Dashboard → Webhooks → add `https://api.yourdomain.com/payments/webhook`.
- Subscribe to `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`,
  `CUSTOMER.DISPUTE.CREATED`.
- Copy the Webhook ID into `PAYPAL_WEBHOOK_ID` in `backend/.env`, then
  `docker compose -f docker-compose.prod.yml up -d` to reload.

### Updating later
```bash
cd stemsplit && git pull
docker compose -f docker-compose.prod.yml up -d --build
```

### Alternative one-box host (Render)
- **Backend**: Web Service from `backend/` (Docker), persistent disk at `/data`,
  the 2 GB plan (~$25/mo — smaller plans OOM). Set the same env vars.
- **Frontend**: Vercel, or a second Render service from `frontend/`.
- Point `ALLOWED_ORIGINS` at the frontend URL. Pricier but no server admin.

## Notes / limits of this MVP

- **Pro unlock is client-side**: after a successful PayPal capture, the backend
  issues a license key stored in the browser's localStorage. It gates the UI but
  is not tied to real user accounts. For production billing integrity, add real
  auth (e.g. email login) and enforce limits server-side per user.
- **PayPal webhook** (`POST /payments/webhook`): refunds, reversals, and disputes
  auto-revoke the Pro license. In the PayPal dashboard create a webhook pointing at
  `https://api.yourdomain.com/payments/webhook`, subscribe it to
  `PAYMENT.CAPTURE.REFUNDED`, `PAYMENT.CAPTURE.REVERSED`, `CUSTOMER.DISPUTE.CREATED`,
  then set `PAYPAL_WEBHOOK_ID` so incoming events are signature-verified. The
  frontend re-checks license validity on load and drops Pro if it was revoked.
- Uploaded files and stems auto-delete after 24h (on backend startup sweep).
- Backend runs a **single worker** because jobs are in-process background tasks.
  To scale, move to a real job queue (Celery/RQ + Redis) and shared storage (S3).
