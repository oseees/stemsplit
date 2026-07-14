"""Chord recognition.

Front-end upgraded for accuracy:

  1. **Overtone-suppressed chroma** — a note's harmonics (octave, octave+fifth,
     …) are subtracted in the log-frequency (CQT) domain before folding to
     chroma, so a bass note's overtones stop faking the chord *quality*. This is
     the core idea behind Chordino's NNLS chroma, done lightweight.
  2. **Bass vs treble registers** — the low octaves vote on the *root*, the mid
     octaves on the *quality*. In sample mode (no bass stem) the root cue is
     derived from the signal's own low register.
  3. **Half-beat segmentation + Viterbi** — twice the time resolution of plain
     beat-sync, so chords that change inside a beat aren't merged away, with a
     temporal model that still penalises implausible flicker.

Plus bass-stem root, key-diatonic bias, and a chord vocabulary covering
maj/min/7/min7/maj7/dim/m7b5/sus2/sus4.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

import librosa
import numpy as np

from .key import PITCHES
from .midi_utils import Note

# Chord templates: semitone offsets from the root.
_TEMPLATES: Dict[str, List[int]] = {
    "maj": [0, 4, 7],
    "min": [0, 3, 7],
    "7":   [0, 4, 7, 10],
    "min7": [0, 3, 7, 10],
    "maj7": [0, 4, 7, 11],
    "dim": [0, 3, 6],
    "m7b5": [0, 3, 6, 10],
    "sus2": [0, 2, 7],
    "sus4": [0, 5, 7],
}
_QUALITY_PRIOR = {"maj": 0.0, "min": 0.0, "7": -0.04, "min7": -0.03,
                  "maj7": -0.05, "dim": -0.04, "m7b5": -0.05,
                  "sus2": -0.06, "sus4": -0.06}
_QUALITY_SUFFIX = {"maj": "", "min": "m", "7": "7", "min7": "m7", "maj7": "maj7",
                   "dim": "dim", "m7b5": "m7b5", "sus2": "sus2", "sus4": "sus4"}

# Tuning weights.
_BASS_W = 0.30     # how strongly the bass register pulls the root choice
_KEY_W = 0.10      # diatonic bonus (scaled up when the key is locked)
_TEMP = 0.08       # softmax temperature (smaller = sharper)
_P_STAY = 0.88     # Viterbi self-transition probability (half-beat steps)

# CQT / overtone-suppression config.
_HOP = 512
_CQT_BINS = 72            # 6 octaves from C1
_FMIN = librosa.note_to_hz("C1")
# (semitone offset of overtone, leakage weight to subtract)
_OVERTONES = [(12, 0.55), (19, 0.40), (24, 0.30), (28, 0.22), (31, 0.18)]
_BASS_OCT = (0, 24)       # bins for the bass register (C1–C3)
_TREBLE_OCT = (12, 60)    # bins for the treble register (C2–C5)


def _states() -> Tuple[List[Tuple[int, str]], np.ndarray]:
    labels, rows = [], []
    for quality, offsets in _TEMPLATES.items():
        base = np.zeros(12)
        for o in offsets:
            base[o % 12] = 1.0
        base /= np.linalg.norm(base)
        for root in range(12):
            labels.append((root, quality))
            rows.append(np.roll(base, root))
    return labels, np.array(rows)


_LABELS, _TMATRIX = _states()


def _family(q: str) -> str:
    if q in ("min", "min7"):
        return "min"
    if q in ("dim", "m7b5"):
        return "dim"
    if q in ("sus2", "sus4"):
        return "sus"
    return "maj"


_majorness = _family  # backwards-compatible alias


def _diatonic(tonic: Optional[int], mode: Optional[str]) -> set:
    if tonic is None or mode is None:
        return set()
    if mode == "major":
        degs = [(0, "maj"), (2, "min"), (4, "min"), (5, "maj"),
                (7, "maj"), (9, "min"), (11, "dim")]
    else:
        degs = [(0, "min"), (2, "dim"), (3, "maj"), (5, "min"),
                (7, "min"), (7, "maj"), (8, "maj"), (10, "maj")]
    return {((tonic + d) % 12, fam) for d, fam in degs}


def _clean_cqt(y: np.ndarray, sr: int) -> np.ndarray:
    """Magnitude CQT with harmonic-overtone leakage subtracted."""
    C = np.abs(librosa.cqt(y, sr=sr, hop_length=_HOP, fmin=_FMIN,
                           n_bins=_CQT_BINS, bins_per_octave=12))
    clean = C.copy()
    for off, w in _OVERTONES:
        if off < C.shape[0]:
            shifted = np.zeros_like(C)
            shifted[off:, :] = C[:-off, :]
            clean = np.maximum(0.0, clean - w * shifted)
    return clean


def _fold(cqt: np.ndarray, lo: int, hi: int) -> np.ndarray:
    hi = min(hi, cqt.shape[0])
    ch = np.zeros((12, cqt.shape[1]))
    for b in range(lo, hi):
        ch[b % 12] += cqt[b]
    return ch / np.maximum(np.linalg.norm(ch, axis=0, keepdims=True), 1e-9)


def _halfbeat_bounds(beat_times: np.ndarray) -> np.ndarray:
    bt = np.asarray(beat_times, dtype=float)
    out = []
    for i in range(len(bt) - 1):
        out.append(bt[i])
        out.append((bt[i] + bt[i + 1]) / 2.0)
    out.append(bt[-1])
    return np.array(out)


def _sync(chroma: np.ndarray, bounds: np.ndarray, sr: int) -> np.ndarray:
    frames = librosa.time_to_frames(bounds, sr=sr, hop_length=_HOP)
    frames = np.clip(frames, 0, chroma.shape[1] - 1)
    return librosa.util.sync(chroma, frames, aggregate=np.mean)


@dataclass
class ChordSegment:
    start: float
    end: float
    root: int
    quality: str

    @property
    def name(self) -> str:
        return f"{PITCHES[self.root]}{_QUALITY_SUFFIX[self.quality]}"

    def midi_pitches(self, base_octave: int = 4) -> List[int]:
        base = 12 * base_octave + self.root
        return [base + o for o in _TEMPLATES[self.quality]]


def detect_chords(y: np.ndarray, sr: int, beat_times: np.ndarray,
                  bass: Optional[np.ndarray] = None,
                  tonic: Optional[int] = None,
                  mode: Optional[str] = None,
                  key_locked: bool = False) -> List[ChordSegment]:
    """Detect chords via overtone-suppressed, half-beat, key/bass-biased Viterbi."""
    if len(beat_times) < 2:
        return []

    cqt = _clean_cqt(librosa.effects.harmonic(y, margin=4), sr)
    treble = _fold(cqt, *_TREBLE_OCT)
    # Bass register: a separate stem if we have one, else this signal's lows.
    if bass is not None:
        bass_cqt = _clean_cqt(librosa.effects.harmonic(bass, margin=2), sr)
        bass_ch = _fold(bass_cqt, *_BASS_OCT)
    else:
        bass_ch = _fold(cqt, *_BASS_OCT)

    bounds = _halfbeat_bounds(beat_times)
    t_sync = _sync(treble, bounds, sr)
    b_sync = _sync(bass_ch, bounds, sr)
    n = min(t_sync.shape[1], b_sync.shape[1], len(bounds) - 1)
    t_sync, b_sync = t_sync[:, :n], b_sync[:, :n]

    # Emission scores per segment.
    emission = _TMATRIX @ t_sync                      # S x n
    for s, (root, _q) in enumerate(_LABELS):
        emission[s] += _BASS_W * b_sync[root]
    dia = _diatonic(tonic, mode)
    key_w = _KEY_W * (2.5 if key_locked else 1.0)
    for s, (root, q) in enumerate(_LABELS):
        if (root, _family(q)) in dia:
            emission[s] += key_w
        emission[s] += _QUALITY_PRIOR[q]

    e = emission / _TEMP
    e -= e.max(axis=0, keepdims=True)
    prob = np.exp(e)
    prob /= prob.sum(axis=0, keepdims=True)

    n_states = len(_LABELS)
    trans = np.full((n_states, n_states), (1.0 - _P_STAY) / (n_states - 1))
    np.fill_diagonal(trans, _P_STAY)
    path = librosa.sequence.viterbi(prob, trans)

    segs: List[ChordSegment] = []
    for i in range(n):
        root, qual = _LABELS[int(path[i])]
        start, end = float(bounds[i]), float(bounds[i + 1])
        if segs and segs[-1].root == root and segs[-1].quality == qual:
            segs[-1].end = end
        else:
            segs.append(ChordSegment(start, end, root, qual))
    return segs


def chords_to_notes(segs: List[ChordSegment], velocity: int = 80,
                    base_octave: int = 4,
                    onsets: Optional[np.ndarray] = None,
                    roll: float = 0.012) -> List[Note]:
    """Render chord segments to notes (sustained, or strummed if onsets given)."""
    if onsets is None or len(onsets) == 0:
        notes: List[Note] = []
        for s in segs:
            for p in s.midi_pitches(base_octave):
                notes.append(Note(s.start, s.end, p, velocity))
        return notes

    ons = sorted(float(o) for o in onsets)

    def seg_at(t: float) -> Optional[ChordSegment]:
        for s in segs:
            if s.start - 1e-6 <= t < s.end:
                return s
        return None

    notes = []
    for i, t in enumerate(ons):
        s = seg_at(t)
        if s is None:
            continue
        nxt = ons[i + 1] if i + 1 < len(ons) else s.end
        end = min(nxt, s.end)
        if end <= t:
            continue
        for j, p in enumerate(s.midi_pitches(base_octave)):
            notes.append(Note(t + j * roll, end, p, velocity))
    return notes
