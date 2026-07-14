"""Polyphonic audio -> MIDI via Spotify's basic-pitch (a trained neural model).

This is the right engine for the project's core job — pulling *accurate* MIDI
out of arbitrary samples (Splice loops, sample packs) — because it transcribes
the actual notes it hears instead of guessing a chord from a blurry chroma.

basic-pitch lives in an ISOLATED venv (``track2midi/bp-venv``) so its
dependencies can't disturb the main torch/librosa/numpy-2 environment. We shell
out to its CLI and read the resulting MIDI back with pretty_midi.
"""
from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path
from typing import List, Optional

import pretty_midi

from .midi_utils import Note

_ROOT = Path(__file__).resolve().parent.parent          # track2midi/
_BP_BIN = _ROOT / "bp-venv" / "bin" / "basic-pitch"


def available() -> bool:
    """True if the isolated basic-pitch venv is installed."""
    return _BP_BIN.exists()


def transcribe(input_path: str,
               minimum_note_length: Optional[float] = None,   # ms
               minimum_frequency: Optional[float] = None,      # Hz
               maximum_frequency: Optional[float] = None,      # Hz
               onset_threshold: float = 0.5,
               frame_threshold: float = 0.3) -> List[Note]:
    """Run basic-pitch and return its transcribed notes (seconds, MIDI pitch).

    Higher ``onset_threshold`` / ``frame_threshold`` -> fewer, more confident
    notes (less transient noise). A ``minimum_note_length`` in milliseconds
    drops very short blips.
    """
    if not available():
        raise RuntimeError(
            f"basic-pitch not installed at {_BP_BIN}.\n"
            "Create it with:\n"
            "  python3.9 -m venv track2midi/bp-venv\n"
            "  track2midi/bp-venv/bin/pip install basic-pitch onnxruntime")

    out_dir = tempfile.mkdtemp(prefix="t2m_bp_")
    cmd = [str(_BP_BIN), out_dir, str(input_path), "--save-midi",
           "--onset-threshold", str(onset_threshold),
           "--frame-threshold", str(frame_threshold)]
    if minimum_note_length is not None:
        cmd += ["--minimum-note-length", str(minimum_note_length)]
    if minimum_frequency is not None:
        cmd += ["--minimum-frequency", str(minimum_frequency)]
    if maximum_frequency is not None:
        cmd += ["--maximum-frequency", str(maximum_frequency)]

    # Run with a clean env so the parent's PYTHONPATH can't leak the main venv.
    env = dict(os.environ)
    env.pop("PYTHONPATH", None)
    proc = subprocess.run(cmd, capture_output=True, env=env, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"basic-pitch failed:\n{proc.stderr[-2000:]}")

    stem = Path(input_path).stem
    mid_path = Path(out_dir) / f"{stem}_basic_pitch.mid"
    if not mid_path.exists():
        mids = list(Path(out_dir).glob("*.mid"))
        if not mids:
            raise RuntimeError("basic-pitch produced no MIDI file")
        mid_path = mids[0]

    pm = pretty_midi.PrettyMIDI(str(mid_path))
    notes: List[Note] = []
    for inst in pm.instruments:
        if inst.is_drum:
            continue
        for n in inst.notes:
            notes.append(Note(float(n.start), float(n.end),
                              int(n.pitch), int(n.velocity)))
    notes.sort(key=lambda n: (n.start, n.pitch))
    return notes
