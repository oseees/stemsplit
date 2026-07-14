"""Musical key detection via the Krumhansl-Schmuckler key-finding algorithm.

We build a 12-bin chroma profile for the track and correlate it against the
24 major/minor key profiles, picking the best match. Confidence is the gap
between the best and second-best correlation.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Tuple

import librosa
import numpy as np

PITCHES = ["C", "C#", "D", "D#", "E", "F",
           "F#", "G", "G#", "A", "A#", "B"]

# Krumhansl-Kessler key profiles (major / minor).
_MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09,
                   2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53,
                   2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


@dataclass
class KeyResult:
    key: str            # e.g. "F# minor"
    tonic: str          # e.g. "F#"
    mode: str           # "major" / "minor"
    confidence: float   # 0..1


def _corr(a: np.ndarray, b: np.ndarray) -> float:
    a = a - a.mean()
    b = b - b.mean()
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    return float(np.dot(a, b) / denom) if denom else 0.0


def detect_key(y: np.ndarray, sr: int) -> KeyResult:
    """Estimate the key from harmonic audio (ideally a no-drums mix)."""
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=2048)
    profile = chroma.mean(axis=1)
    if profile.sum() <= 0:
        return KeyResult("C major", "C", "major", 0.0)
    profile = profile / profile.sum()

    scores = []  # (score, tonic_index, mode)
    for i in range(12):
        scores.append((_corr(profile, np.roll(_MAJOR, i)), i, "major"))
        scores.append((_corr(profile, np.roll(_MINOR, i)), i, "minor"))
    scores.sort(reverse=True)

    best_score, tonic_idx, mode = scores[0]
    # Confidence = how well the winning profile fits, lightly boosted by the
    # margin over the best *different-tonic* rival (parallel major/minor sharing
    # the tonic shouldn't be treated as a competitor).
    rival = next((s for s, i, m in scores[1:] if i != tonic_idx), best_score)
    margin = max(0.0, best_score - rival)
    confidence = float(np.clip(0.85 * max(best_score, 0.0) + 0.6 * margin, 0, 1))
    tonic = PITCHES[tonic_idx]
    return KeyResult(f"{tonic} {mode}", tonic, mode, round(confidence, 3))
