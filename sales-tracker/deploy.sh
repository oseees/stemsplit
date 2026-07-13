#!/usr/bin/env bash
# Deploy to Railway with automatic retry + verification.
#
# `railway up` intermittently fails on the FIRST attempt with a transient
# error from Railway's own upload API (a timed-out request or a bare 500) —
# every single time we've hit this, a plain retry succeeded with no other
# change needed. This script absorbs that flakiness so it's invisible: it
# retries automatically and only gives up (loudly) after repeated real
# failures, instead of you having to notice a failure and re-run it by hand.
#
# (Separately: the upload used to time out because the build context was
# 141M — android/, android-webview/, backend/.venv/ all got swept in. That
# was a real bug and is fixed for good via .railwayignore, which is why
# uploads are fast now. This script handles whatever flakiness is left on
# Railway's end, which is out of this repo's control.)
set -uo pipefail
cd "$(dirname "$0")"

ATTEMPTS=5
ok=0
for i in $(seq 1 "$ATTEMPTS"); do
  echo "=== railway up attempt $i/$ATTEMPTS ==="
  railway up --ci 2>&1 | tee /tmp/salespal_railway_up.log
  rc="${PIPESTATUS[0]}"
  if [ "$rc" -eq 0 ] && ! grep -qiE "operation timed out|failed to upload|error sending request|internal server error" /tmp/salespal_railway_up.log; then
    ok=1
    break
  fi
  if [ "$i" -lt "$ATTEMPTS" ]; then
    echo "--- attempt $i looked transient (exit=$rc) — retrying in 10s ---"
    sleep 10
  fi
done

if [ "$ok" -ne 1 ]; then
  echo "DEPLOY FAILED after $ATTEMPTS attempts — this is no longer transient, stopping to avoid masking a real problem."
  exit 1
fi

echo
echo "Upload succeeded. Recent deployments:"
railway deployment list | head -4
echo
echo "Health check:"
curl -sf https://salespal.online/api/health && echo || echo "  (health check failed — investigate before assuming this deploy is good)"
