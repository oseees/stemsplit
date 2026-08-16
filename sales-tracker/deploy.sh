#!/usr/bin/env bash
# Deploy to Railway with automatic retry + verification.
#
# `railway up` intermittently fails from a transient error on Railway's own
# upload API (a timed-out request or a bare 500). Every time we've hit that, a
# plain retry succeeded. This script absorbs that flakiness so it's invisible.
#
# CRUCIALLY it does NOT judge the deploy by the CLI's exit code. `railway up`
# streams build logs, and when that stream drops it exits non-zero and prints
# something like "unknown: connection dropped" — even though the deployment was
# created and goes on to succeed. Trusting the exit code made this script cry
# wolf: on 2026-08-16 it reported "DEPLOY FAILED after 5 attempts" and uploaded
# four redundant deploys while the build it had already started was fine. So we
# pull the deployment id out of the Build Logs URL and ask Railway what actually
# happened to THAT deployment.
#
# (Separately: the upload used to time out because the build context was 141M —
# android/, android-webview/, backend/.venv/ all got swept in. Fixed for good
# via .railwayignore, which is why uploads are fast now.)
set -uo pipefail
cd "$(dirname "$0")"

ATTEMPTS=3          # only for uploads that never produced a deployment
POLL_SECS=10
POLL_MAX=60         # 10 minutes; a cold build is a few minutes
LOG=/tmp/salespal_railway_up.log
HEALTH_URL=https://salespal.online/api/health

# Status of one deployment id, or "" while Railway hasn't listed it yet.
dep_status() {
  railway deployment list 2>/dev/null | grep -F "$1" | head -1 \
    | awk -F'|' '{ gsub(/ /, "", $2); print $2 }'
}

deploy_id=""
for i in $(seq 1 "$ATTEMPTS"); do
  echo "=== railway up attempt $i/$ATTEMPTS ==="
  railway up --ci 2>&1 | tee "$LOG"
  rc="${PIPESTATUS[0]}"

  # The Build Logs line carries the deployment id: ...?id=<uuid>&
  deploy_id=$(grep -oE '[?&]id=[0-9a-f-]{36}' "$LOG" | head -1 | cut -d= -f2)

  if [ -n "$deploy_id" ]; then
    echo
    echo "Deployment $deploy_id created (railway up exit=$rc)."
    [ "$rc" -ne 0 ] && echo "  (non-zero exit is usually just the log stream dropping — checking the real status)"
    break
  fi

  # No deployment id => the upload itself never landed. That's the genuinely
  # transient case worth retrying.
  echo "--- attempt $i produced no deployment (exit=$rc) — retrying in 10s ---"
  [ "$i" -lt "$ATTEMPTS" ] && sleep 10
done

if [ -z "$deploy_id" ]; then
  echo
  echo "UPLOAD FAILED after $ATTEMPTS attempts — no deployment was ever created."
  echo "Check your connection and \`railway whoami\`, then try again."
  exit 1
fi

echo
echo -n "Waiting for build"
status=""
for _ in $(seq 1 "$POLL_MAX"); do
  status=$(dep_status "$deploy_id")
  case "$status" in
    SUCCESS)            echo " → SUCCESS"; break ;;
    FAILED|CRASHED)     echo " → $status"; break ;;
    # Ours got superseded — someone deployed again while this build was running.
    REMOVED|REMOVING)   echo " → $status"; break ;;
    *)                  echo -n "."; sleep "$POLL_SECS" ;;
  esac
done

echo
if [ "$status" = "SUCCESS" ]; then
  echo "Deployed: $deploy_id"
elif [ "$status" = "FAILED" ] || [ "$status" = "CRASHED" ]; then
  # A build that genuinely failed will fail again from the same commit, so
  # re-uploading would only add noise. Send them to the logs instead.
  echo "DEPLOY FAILED — the build reported $status. Re-running won't help; read the build log:"
  grep -oE 'https://railway.com[^ ]*' "$LOG" | head -1
  exit 1
elif [ "$status" = "REMOVED" ] || [ "$status" = "REMOVING" ]; then
  echo "This deployment was superseded by a newer one before it went live."
  echo "Nothing is broken — check what's running: railway deployment list"
  exit 1
else
  echo "Gave up waiting after $((POLL_SECS * POLL_MAX / 60))m; last status: ${status:-unknown}."
  echo "The build may still be running — check: railway deployment list"
  exit 1
fi

echo
echo "Recent deployments:"
railway deployment list | head -4

echo
echo -n "Health check: "
if curl -sf --max-time 20 --retry 3 --retry-delay 5 "$HEALTH_URL"; then
  echo
  echo "Live and healthy."
else
  echo
  echo "HEALTH CHECK FAILED — the build succeeded but the app isn't answering."
  echo "Check: railway logs"
  exit 1
fi
