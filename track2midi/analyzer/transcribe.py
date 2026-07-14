"""Monophonic pitch -> MIDI notes for the bass and melody stems.

Uses librosa's pYIN to extract a fundamental-frequency contour, smooths it in
cents space, then segments runs of equal (rounded) pitch into note events.
Short blips are dropped and tiny same-pitch gaps are bridged.
"""
from __future__ import annotations

from typing import List, Optional

import librosa
import numpy as np
from scipy.ndimage import median_filter

from .midi_utils import Note

HOP = 512


def _hz_to_midi(f0: np.ndarray) -> np.ndarray:
    out = np.full_like(f0, np.nan, dtype=float)
    valid = f0 > 0
    out[valid] = 69.0 + 12.0 * np.log2(f0[valid] / 440.0)
    return out


def transcribe_mono(y: np.ndarray, sr: int,
                    fmin: float, fmax: float,
                    min_note_dur: float = 0.07,
                    gap_merge: float = 0.06,
                    velocity: int = 96,
                    octave_shift: int = 0) -> List[Note]:
    """Extract monophonic notes from an isolated stem.

    ``octave_shift`` transposes the result in octaves (handy if a stem tracks an
    octave off). ``fmin``/``fmax`` bound the pYIN search to the instrument range.
    """
    f0, voiced, _ = librosa.pyin(
        y, fmin=fmin, fmax=fmax, sr=sr, hop_length=HOP,
        fill_na=np.nan, center=True)
    times = librosa.times_like(f0, sr=sr, hop_length=HOP)

    midi = _hz_to_midi(f0)
    # Smooth to kill single-frame jitter. Forward/back-fill the gaps with the
    # nearest valid pitch *before* filtering so the median never bleeds toward
    # zero across unvoiced frames (which used to spawn bogus C-1 notes).
    valid = ~np.isnan(midi)
    if valid.any():
        idx = np.where(valid, np.arange(len(midi)), 0)
        np.maximum.accumulate(idx, out=idx)          # forward-fill indices
        filled = midi[idx]
        first = midi[valid][0]
        filled = np.where(np.isnan(filled), first, filled)  # back-fill leaders
        smooth = median_filter(filled, size=5)
    else:
        smooth = midi
    midi = np.where(np.isnan(midi), np.nan, smooth)
    rounded = np.round(midi)

    # Guard rail: never emit a note outside the requested instrument range.
    lo = int(round(_hz_to_midi(np.array([fmin]))[0]))
    hi = int(round(_hz_to_midi(np.array([fmax]))[0]))

    notes: List[Note] = []
    cur: Optional[int] = None
    start = 0.0
    for i, t in enumerate(times):
        p = None
        if voiced[i] and not np.isnan(rounded[i]):
            cand = int(rounded[i]) + 12 * octave_shift
            if lo <= cand <= hi:
                p = cand
        if p != cur:
            if cur is not None:
                notes.append(Note(start, float(t), cur, velocity))
            cur = p
            start = float(t)
    if cur is not None:
        notes.append(Note(start, float(times[-1]), cur, velocity))

    # Merge adjacent same-pitch notes separated by a tiny gap.
    merged: List[Note] = []
    for n in notes:
        if merged and merged[-1].pitch == n.pitch and (n.start - merged[-1].end) <= gap_merge:
            merged[-1].end = n.end
        else:
            merged.append(n)

    # Drop blips.
    return [n for n in merged if (n.end - n.start) >= min_note_dur]
