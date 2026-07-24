#!/usr/bin/env bash
# One-time setup for the nightly off-box backup to Telegram.
#
# Prompts for the bot token (hidden), finds your chat id, and sets both Railway
# variables. The token is never echoed, never written to a file, and never
# reaches your shell history. Run from anywhere:  ./setup-backup.sh
set -euo pipefail

# railway links a PROJECT to a DIRECTORY — this only works from the repo dir.
cd "$(dirname "$0")"

TG=$(python3 -c 'import getpass; print(getpass.getpass("Paste bot token (hidden, nothing will appear): "))')
[ -n "$TG" ] || { echo "No token entered." >&2; exit 1; }

# Fail early with a clear reason instead of setting a dud token.
if ! python3 - "$TG" <<'PY'
import json, sys, urllib.request
try:
    with urllib.request.urlopen(f"https://api.telegram.org/bot{sys.argv[1]}/getMe", timeout=20) as r:
        print("Bot:", json.load(r)["result"]["username"])
except Exception:
    sys.exit("That token was rejected by Telegram. Check you copied all of it, "
             "and that you revoked/reissued it in @BotFather.")
PY
then exit 1; fi

CHAT=$(python3 - "$TG" <<'PY'
import json, sys, urllib.request
with urllib.request.urlopen(f"https://api.telegram.org/bot{sys.argv[1]}/getUpdates", timeout=20) as r:
    updates = json.load(r)["result"]
ids = {str(u[k]["chat"]["id"]) for u in updates
       for k in ("message", "channel_post") if k in u}
if not ids:
    sys.exit("No messages found. Open Telegram, send your bot any message, then re-run.")
if len(ids) > 1:
    sys.exit(f"Several chats found ({', '.join(ids)}). Set SALESPAL_BACKUP_TG_CHAT by hand.")
print(ids.pop())
PY
)

# --skip-deploys on the first so the service restarts once, with BOTH set.
printf '%s' "$TG" | railway variable set SALESPAL_BACKUP_TG_TOKEN --stdin --skip-deploys
unset TG
railway variable set SALESPAL_BACKUP_TG_CHAT="$CHAT"

echo
echo "Done — chat id $CHAT. Railway is redeploying now."
echo "Verify: salespal.online -> Admin -> Send off-box copy"
