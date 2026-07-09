# YouTube upload — local only. Tokens live on this Mac; Railway can't use this.
# One-time setup: put a Google OAuth "Desktop app" client_secret.json next to this file,
# then run `python youtube_auth.py` once to log in (writes token.json).
from pathlib import Path

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build as build_service
from googleapiclient.http import MediaFileUpload

HERE = Path(__file__).parent
CLIENT_SECRET = HERE / "client_secret.json"
TOKEN = HERE / "token.json"
SCOPES = ["https://www.googleapis.com/auth/youtube.upload"]


def _credentials() -> Credentials:
    if not TOKEN.exists():
        raise RuntimeError("Not connected to YouTube. Run: python youtube_auth.py")
    creds = Credentials.from_authorized_user_file(str(TOKEN), SCOPES)
    if not creds.valid:
        if creds.expired and creds.refresh_token:
            creds.refresh(Request())
            TOKEN.write_text(creds.to_json())
        else:
            raise RuntimeError("YouTube login expired. Re-run: python youtube_auth.py")
    return creds


def upload(path: Path, title: str, description: str = "", privacy: str = "private") -> str:
    """Resumable-upload a video, return its youtube.com URL. privacy: private|unlisted|public."""
    if privacy not in ("private", "unlisted", "public"):
        raise ValueError(f"bad privacy {privacy!r}")
    yt = build_service("youtube", "v3", credentials=_credentials())
    body = {
        "snippet": {"title": title[:100] or "BeatVideo", "description": description[:5000]},
        "status": {"privacyStatus": privacy, "selfDeclaredMadeForKids": False},
    }
    req = yt.videos().insert(
        part="snippet,status", body=body,
        media_body=MediaFileUpload(str(path), chunksize=-1, resumable=True))
    resp = req.execute()  # chunksize=-1 uploads in one shot; fine for our short videos
    return f"https://youtu.be/{resp['id']}"
