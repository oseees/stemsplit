"""Tempo (BPM) and beat-grid detection.

BPM comes from a parabolic-interpolated autocorrelation of the onset envelope
(sub-frame precision, so we don't get stuck on 123-vs-125 quantization), with
the beat tracker's tempo used only to disambiguate the octave. The result is
rounded to the nearest integer because virtually all DAW-made beats sit on
whole-number BPMs. Beat times come from the tracker and anchor the grid.
"""
from __future__ import annotations

from dataclasses import dataclass

import librosa
import numpy as np

HOP = 256  # finer than 512 -> better tempo resolution


@dataclass
class TempoResult:
    bpm: float
    beat_times: np.ndarray   # seconds
    first_beat: float        # seconds (timeline origin)


def _parabolic(y: np.ndarray, x: int) -> float:
    """Sub-sample peak location via parabolic interpolation around index x."""
    if x <= 0 or x >= len(y) - 1:
        return float(x)
    a, b, c = y[x - 1], y[x], y[x + 1]
    denom = a - 2 * b + c
    return x + 0.5 * (a - c) / denom if denom else float(x)


def _acf_candidates(oenv: np.ndarray, fps: float):
    """Return (bpm, strength) for the strongest autocorrelation peaks."""
    ac = librosa.autocorrelate(oenv, max_size=len(oenv))
    ac[:1] = 0.0
    lags = np.arange(len(ac))
    bpms = 60.0 * fps / np.maximum(lags, 1)
    valid = np.where((bpms >= 55) & (bpms <= 210))[0]
    peaks = [i for i in valid
             if 1 <= i < len(ac) - 1 and ac[i] >= ac[i - 1] and ac[i] >= ac[i + 1]]
    peaks.sort(key=lambda i: ac[i], reverse=True)
    return [(60.0 * fps / _parabolic(ac, i), float(ac[i])) for i in peaks[:6]]


def _refine_tempo(oenv: np.ndarray, fps: float, anchor: float) -> float:
    cands = _acf_candidates(oenv, fps)
    if not cands:
        return anchor if anchor > 0 else 120.0

    def fold_to_anchor(b: float) -> float:
        for _ in range(3):
            if b < anchor / 1.4:
                b *= 2
            elif b > anchor * 1.4:
                b /= 2
        return b

    best_bpm, best_score = anchor, -1.0
    for bpm, strength in cands:
        folded = fold_to_anchor(bpm)
        score = strength / (1.0 + abs(folded - anchor) / max(anchor, 1.0))
        if score > best_score:
            best_score, best_bpm = score, folded

    b = best_bpm
    while b < 70:
        b *= 2
    while b > 180:
        b /= 2
    return b


def detect_tempo(y: np.ndarray, sr: int) -> TempoResult:
    """Detect BPM and beat times from a (percussive-rich) signal."""
    fps = sr / HOP
    onset_env = librosa.onset.onset_strength(y=y, sr=sr, hop_length=HOP)

    tempo_bt, beat_frames = librosa.beat.beat_track(
        onset_envelope=onset_env, sr=sr, hop_length=HOP, trim=False)
    anchor = float(np.atleast_1d(tempo_bt)[0])
    beat_times = librosa.frames_to_time(beat_frames, sr=sr, hop_length=HOP)

    bpm = round(_refine_tempo(onset_env, fps, anchor))
    first_beat = float(beat_times[0]) if len(beat_times) else 0.0
    return TempoResult(bpm=float(bpm), beat_times=beat_times, first_beat=first_beat)
