# YouTube upload — local only. Tokens live on this Mac; Railway can't use this.
# One-time setup: put a Google OAuth "Desktop app" client_secret.json next to this file,
# then run `python youtube_auth.py` once to log in (writes token.json).
from pathlib import Path
from typing import Optional

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build as build_service
from googleapiclient.http import MediaFileUpload

HERE = Path(__file__).parent
CLIENT_SECRET = HERE / "client_secret.json"
TOKEN = HERE / "token.json"
SCOPES = ["https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube.readonly"]  # read = reuse past details


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


def list_recent(max_results: int = 20) -> list[dict]:
    """Recent uploads on the user's channel with their title/description/tags, to reuse."""
    yt = build_service("youtube", "v3", credentials=_credentials())
    chans = yt.channels().list(part="contentDetails", mine=True).execute().get("items", [])
    if not chans:
        return []
    uploads = chans[0]["contentDetails"]["relatedPlaylists"]["uploads"]
    items = yt.playlistItems().list(
        part="contentDetails", playlistId=uploads, maxResults=max_results).execute().get("items", [])
    ids = [i["contentDetails"]["videoId"] for i in items]
    if not ids:
        return []
    vids = yt.videos().list(part="snippet", id=",".join(ids)).execute().get("items", [])
    return [{"id": v["id"], "title": v["snippet"]["title"],
             "description": v["snippet"].get("description", ""),
             "tags": v["snippet"].get("tags", [])} for v in vids]


def upload(path: Path, title: str, description: str = "", privacy: str = "private",
           tags: Optional[list[str]] = None, publish_at: Optional[str] = None) -> str:
    """Resumable-upload a video, return its youtube.com URL. privacy: private|unlisted|public.
    publish_at: RFC3339 UTC string — YouTube uploads it private and makes it public then."""
    if privacy not in ("private", "unlisted", "public"):
        raise ValueError(f"bad privacy {privacy!r}")
    yt = build_service("youtube", "v3", credentials=_credentials())
    snippet = {"title": title[:100] or "BeatVideo", "description": description[:5000]}
    if tags:
        snippet["tags"] = tags[:60]  # YouTube caps total tag text ~500 chars; 60 tags is safe
    status = {"privacyStatus": privacy, "selfDeclaredMadeForKids": False}
    if publish_at:
        status["privacyStatus"] = "private"  # scheduling requires private; YT flips it public
        status["publishAt"] = publish_at
    body = {"snippet": snippet, "status": status}
    req = yt.videos().insert(
        part="snippet,status", body=body,
        media_body=MediaFileUpload(str(path), chunksize=-1, resumable=True))
    resp = req.execute()  # chunksize=-1 uploads in one shot; fine for our short videos
    return resp["id"]


def set_thumbnail(video_id: str, path: Path) -> None:
    """Set a custom thumbnail. Raises RuntimeError with a friendly message on failure."""
    yt = build_service("youtube", "v3", credentials=_credentials())
    try:
        yt.thumbnails().set(videoId=video_id, media_body=MediaFileUpload(str(path))).execute()
    except Exception as e:  # never let a thumbnail problem lose an already-uploaded video
        # most common: 403 (channel not phone-verified for custom thumbnails) or >2MB image
        raise RuntimeError("Video uploaded, but thumbnail wasn't set (channel may need phone "
                           "verification for custom thumbnails, or image is over 2MB).") from e
