"""Speech-to-text for the voice-input feature.

Design mirrors the app's other swap-in seams (classifier, embedder): a `Transcriber`
protocol with a default Whisper implementation. The default runs faster-whisper in an
ISOLATED venv (`.venv-asr`) as a subprocess, so the heavy ASR wheels stay out of the
app's Python 3.14 venv. Browser audio (webm/opus) is first transcoded to 16 kHz mono
WAV with ffmpeg for format-robust decoding.

To swap engines later (cloud STT, a fine-tuned model), implement `Transcriber.transcribe`
and return it from `default_transcriber()`.
"""
from __future__ import annotations

import json
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from . import config


class TranscriptionUnavailable(RuntimeError):
    """Raised when the ASR environment is not installed."""


class TranscriptionError(RuntimeError):
    """Raised when transcription fails (bad audio, worker crash, timeout)."""


@dataclass
class Transcript:
    text: str
    language: str
    language_probability: float
    duration: float


class Transcriber(Protocol):
    def transcribe(self, audio_bytes: bytes, language: str = "") -> Transcript: ...


def _to_wav16k(audio_bytes: bytes, workdir: Path) -> Path:
    """Transcode arbitrary browser audio to 16 kHz mono WAV via ffmpeg."""
    src = workdir / "in.bin"
    src.write_bytes(audio_bytes)
    wav = workdir / "in.wav"
    proc = subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-ar", "16000", "-ac", "1", str(wav)],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0 or not wav.exists():
        raise TranscriptionError(f"Could not decode audio: {proc.stderr.strip()[:300]}")
    return wav


class WhisperTranscriber:
    """faster-whisper in the isolated ASR venv, invoked per request as a subprocess."""

    def __init__(self, model: str | None = None, compute: str | None = None):
        self.model = model or config.WHISPER_MODEL
        self.compute = compute or config.WHISPER_COMPUTE

    def transcribe(self, audio_bytes: bytes, language: str = "") -> Transcript:
        if not config.has_asr():
            raise TranscriptionUnavailable(
                "Voice transcription is not set up. Create the ASR venv (.venv-asr) with "
                "faster-whisper — see run.sh / README."
            )
        if language and language not in config.ASR_LANGUAGES:
            language = ""  # ignore unknown codes -> auto-detect

        with tempfile.TemporaryDirectory() as td:
            workdir = Path(td)
            wav = _to_wav16k(audio_bytes, workdir)
            cmd = [
                str(config.ASR_VENV_PYTHON),
                str(config.ASR_WORKER),
                "--audio", str(wav),
                "--model", self.model,
                "--compute", self.compute,
                "--language", language,
            ]
            try:
                proc = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=config.ASR_TIMEOUT_SECONDS
                )
            except subprocess.TimeoutExpired as e:
                raise TranscriptionError("Transcription timed out — try a shorter clip.") from e

        if proc.returncode != 0:
            raise TranscriptionError((proc.stderr or "transcription failed").strip()[:300])
        try:
            data = json.loads(proc.stdout)
        except json.JSONDecodeError as e:
            raise TranscriptionError("Transcription returned no result.") from e
        return Transcript(
            text=data.get("text", ""),
            language=data.get("language", ""),
            language_probability=float(data.get("language_probability", 0.0)),
            duration=float(data.get("duration", 0.0)),
        )


def default_transcriber() -> Transcriber:
    return WhisperTranscriber()
