#!/usr/bin/env python
# Run ONCE to connect your YouTube channel: python youtube_auth.py
# Opens your browser to log in with Google; saves token.json next to this file.
# Needs client_secret.json (Google Cloud > OAuth client, type "Desktop app") here first.
from google_auth_oauthlib.flow import InstalledAppFlow

from youtube import CLIENT_SECRET, SCOPES, TOKEN

if not CLIENT_SECRET.exists():
    raise SystemExit(
        f"Missing {CLIENT_SECRET.name}. Create an OAuth 'Desktop app' client in Google Cloud "
        "(with the YouTube Data API v3 enabled), download it, and save it there.")

creds = InstalledAppFlow.from_client_secrets_file(str(CLIENT_SECRET), SCOPES).run_local_server(port=0)
TOKEN.write_text(creds.to_json())
print(f"Connected. Saved {TOKEN.name}. You can now upload from BeatVideo.")
