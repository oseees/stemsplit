"""Label chords from *transcribed notes* (not from chroma).

Once we have discrete polyphonic notes (from basic-pitch), naming chords is far
more reliable than template-matching a blurry chroma: we know exactly which
pitches sound and which one is in the bass.

Key design choice learned the hard way: **do NOT force chords diatonic to the
detected key.** Real samples use borrowed/non-diatonic chords (e.g. an Fm7
passing chord in E flat minor), and hard key-locking turns those correct chords
into wrong ones. Key is used, if at all, only as a *mild* tie-breaker.

Pipeline: per-beat bass pitch-class -> smooth -> group consecutive beats with
the same bass into segments -> name one chord per segment from its
duration-weighted pitch-class profile.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Tuple

import numpy as np

from .key import PITCHES
from .midi_utils import Note

# Chord templates: semitone offsets from the root.
_TEMPLATES = {
    "maj":  [0, 4, 7],
    "min":  [0, 3, 7],
    "7":    [0, 4, 7, 10],
    "min7": [0, 3, 7, 10],
    "maj7": [0, 4, 7, 11],
    "6":    [0, 4, 7, 9],
    "min6": [0, 3, 7, 9],
    "dim":  [0, 3, 6],
    "m7b5": [0, 3, 6, 10],
    "dim7": [0, 3, 6, 9],
    "aug":  [0, 4, 8],
    "sus2": [0, 2, 7],
    "sus4": [0, 5, 7],
}
_SUFFIX = {
    "maj": "", "min": "m", "7": "7", "min7": "m7", "maj7": "maj7",
    "6": "6", "min6": "m6", "dim": "dim", "m7b5": "m7b5", "dim7": "dim7",
    "aug": "aug", "sus2": "sus2", "sus4": "sus4",
}
# Bias toward simpler / more-common shapes; rarer colours must earn it.
_SIZE_PEN = {q: 0.0 for q in _TEMPLATES}
_SIZE_PEN.update({"7": 0.10, "min7": 0.10, "maj7": 0.10, "6": 0.12,
                  "min6": 0.12, "m7b5": 0.10, "dim": 0.05, "dim7": 0.12,
                  "aug": 0.18, "sus2": 0.12, "sus4": 0.12})

_BASS_MAX = 52            # MIDI <= E3 counts as a bass-register cue
_PRESENT_TH = 0.18        # pitch-class weight to count a tone as "present"


@dataclass
class Chord:
    start: float
    end: float
    root: int
    quality: str

    @property
    def name(self) -> str:
        return f"{PITCHES[self.root]}{_SUFFIX[self.quality]}"

    def midi_pitches(self, base_octave: int = 3) -> List[int]:
        base = 12 * base_octave + self.root
        return [base + o for o in _TEMPLATES[self.quality]]


def _seg_notes(notes: List[Note], a: float, b: float) -> List[Note]:
    return [n for n in notes if n.start < b and n.end > a]


def _bass_pc(seg: List[Note]) -> Optional[int]:
    if not seg:
        return None
    bw = np.zeros(12)
    for n in seg:
        if n.pitch <= _BASS_MAX:
            bw[n.pitch % 12] += (n.end - n.start)
    if bw.sum() > 0:
        return int(np.argmax(bw))
    return int(min(seg, key=lambda n: n.pitch).pitch % 12)


def _name(seg: List[Note], tonic: Optional[int], mode: Optional[str],
          key_bias: float) -> Optional[Tuple[int, str]]:
    if not seg:
        return None
    w = np.zeros(12)
    for n in seg:
        w[n.pitch % 12] += (n.end - n.start)
    if w.sum() == 0:
        return None
    wn = w / w.max()
    bpc = _bass_pc(seg)
    dia = _diatonic(tonic, mode)

    best = None
    for root in range(12):
        for q, offs in _TEMPLATES.items():
            tmpl = {(root + o) % 12 for o in offs}
            present = sum(min(wn[(root + o) % 12], 1.0) for o in offs) / len(offs)
            covered = sum(1 for o in offs
                          if wn[(root + o) % 12] > _PRESENT_TH) / len(offs)
            extra = sum(wn[k] for k in range(12) if k not in tmpl)
            score = present + 0.7 * covered - 0.25 * extra - _SIZE_PEN[q]
            if bpc is not None and root == bpc:
                score += 0.5
            # Don't call it 'sus' if a real 3rd sounds anywhere in the segment;
            # producers want the triad name, not a strum-decay 'sus'.
            if q in ("sus2", "sus4"):
                third = max(wn[(root + 3) % 12], wn[(root + 4) % 12])
                if third > 0.12:
                    score -= 0.5
            if key_bias and (root, _family(q)) in dia:
                score += key_bias
            if best is None or score > best[0]:
                best = (score, root, q)
    return best[1], best[2]


def _family(q: str) -> str:
    if q in ("min", "min7", "min6"):
        return "min"
    if q in ("dim", "m7b5", "dim7"):
        return "dim"
    if q in ("sus2", "sus4"):
        return "sus"
    return "maj"


def _diatonic(tonic: Optional[int], mode: Optional[str]) -> set:
    if tonic is None or mode is None:
        return set()
    if mode == "major":
        degs = [(0, "maj"), (2, "min"), (4, "min"), (5, "maj"),
                (7, "maj"), (9, "min"), (11, "dim")]
    else:
        degs = [(0, "min"), (2, "dim"), (3, "maj"), (5, "min"),
                (7, "min"), (8, "maj"), (10, "maj")]
    return {((tonic + d) % 12, fam) for d, fam in degs}


def detect_chords_from_notes(notes: List[Note], beat_times: np.ndarray,
                             tonic: Optional[int] = None,
                             mode: Optional[str] = None,
                             key_bias: float = 0.0) -> List[Chord]:
    """Bass-anchored chord segmentation + naming from transcribed notes."""
    bt = [float(t) for t in beat_times]
    if len(bt) < 2 or not notes:
        return []

    # 1. Per-beat bass pitch-class.
    bpcs = [_bass_pc(_seg_notes(notes, bt[i], bt[i + 1]))
            for i in range(len(bt) - 1)]
    # 2. Smooth single-beat bass blips with a width-3 mode filter.
    sm = bpcs[:]
    for i in range(len(bpcs)):
        win = [x for x in bpcs[max(0, i - 1):i + 2] if x is not None]
        if win:
            sm[i] = max(set(win), key=win.count)
    # 2b. Absorb 1-beat bass regions into the previous chord (chords rarely
    #     change for a single beat — those are bass walks / strum artifacts).
    runs = []
    i = 0
    while i < len(sm):
        j = i
        while j + 1 < len(sm) and sm[j + 1] == sm[i]:
            j += 1
        runs.append([i, j, sm[i]])
        i = j + 1
    for k in range(1, len(runs)):
        s, e, _b = runs[k]
        if e - s + 1 < 2:
            runs[k][2] = runs[k - 1][2]
    for s, e, b in runs:
        for t in range(s, e + 1):
            sm[t] = b
    # 3. Group consecutive beats sharing a bass pc into segments.
    segs: List[Chord] = []
    i = 0
    while i < len(sm):
        j = i
        while j + 1 < len(sm) and sm[j + 1] == sm[i]:
            j += 1
        a, b = bt[i], bt[min(j + 1, len(bt) - 1)]
        nm = _name(_seg_notes(notes, a, b), tonic, mode, key_bias)
        if nm is not None:
            root, qual = nm
            if segs and segs[-1].root == root and segs[-1].quality == qual:
                segs[-1].end = b
            else:
                segs.append(Chord(a, b, root, qual))
        i = j + 1

    # Absorb very short transition segments (< ~0.7 beat) into the previous
    # chord — they're boundary artifacts, not real chord changes.
    if len(segs) > 1:
        beat = float(np.median(np.diff(bt))) if len(bt) > 1 else 0.5
        min_dur = 0.7 * beat
        merged: List[Chord] = [segs[0]]
        for s in segs[1:]:
            if (s.end - s.start) < min_dur:
                merged[-1].end = s.end
            elif merged[-1].root == s.root and merged[-1].quality == s.quality:
                merged[-1].end = s.end
            else:
                merged.append(s)
        segs = merged
    return segs


def chords_to_blocks(segs: List[Chord], velocity: int = 80,
                     base_octave: int = 3) -> List[Note]:
    """Render each chord segment as a synthetic root-position block."""
    out: List[Note] = []
    for s in segs:
        for p in s.midi_pitches(base_octave):
            out.append(Note(s.start, s.end, p, velocity))
    return out


def chords_to_blocks_real(notes: List[Note], segs: List[Chord],
                          min_frac: float = 0.30,
                          velocity: int = 80) -> List[Note]:
    """Sustain the *actual* transcribed pitches across each chord segment.

    Keeps the real voicing/octaves from the sample (so it layers correctly)
    instead of a synthetic root triad. A pitch is kept if it sounds for at
    least ``min_frac`` of the segment.
    """
    out: List[Note] = []
    for s in segs:
        span = max(s.end - s.start, 1e-6)
        dur: dict = {}
        for n in notes:
            ov = min(n.end, s.end) - max(n.start, s.start)
            if ov > 0:
                dur[n.pitch] = dur.get(n.pitch, 0.0) + ov
        for p, d in dur.items():
            if d >= min_frac * span:
                out.append(Note(s.start, s.end, int(p), velocity))
    return out


def _chord_pcs(s: Chord) -> set:
    return {(s.root + o) % 12 for o in _TEMPLATES[s.quality]}


def legato_to_chords(notes: List[Note], segs: List[Chord],
                     min_frac: float = 0.20) -> List[Note]:
    """Make chords full *within each chord*, re-struck at every chord change.

    For each chord segment, each chord-tone pitch that actually sounds for at
    least ``min_frac`` of the segment becomes ONE note spanning that segment —
    so the chord is full, but it re-articulates when the chord changes instead
    of fusing into one endless note. Passing/melody notes (non-chord-tones) are
    kept exactly as played, preserving the rhythm.
    """
    if not segs or not notes:
        return notes
    pcs = [_chord_pcs(s) for s in segs]
    out: List[Note] = []

    # One full block note per chord-tone pitch per segment.
    for i, s in enumerate(segs):
        span = max(s.end - s.start, 1e-6)
        dur: dict = {}
        vel: dict = {}
        for n in notes:
            if (n.pitch % 12) not in pcs[i]:
                continue
            ov = min(n.end, s.end) - max(n.start, s.start)
            if ov > 0:
                dur[n.pitch] = dur.get(n.pitch, 0.0) + ov
                vel[n.pitch] = max(vel.get(n.pitch, 0), n.velocity)
        for p, d in dur.items():
            if d >= min_frac * span:
                out.append(Note(s.start, s.end, p, vel[p]))

    # Keep non-chord-tone (melody / passing) notes rhythmic and untouched.
    for n in notes:
        idx = next((i for i, s in enumerate(segs)
                    if s.start - 1e-6 <= n.start < s.end + 1e-6), None)
        if idx is None or (n.pitch % 12) not in pcs[idx]:
            out.append(n)

    out.sort(key=lambda n: (n.start, n.pitch))
    return out


def voice_line(notes: List[Note], pick: str = "low", step: float = 0.05,
               min_dur: float = 0.08) -> List[Note]:
    """Extract a monophonic line: ``pick='low'`` -> bass, ``'high'`` -> melody.

    Skyline/floor-line: at each time step keep the lowest (or highest) sounding
    pitch, then merge consecutive equal pitches into sustained notes.
    """
    if not notes:
        return []
    t0 = min(n.start for n in notes)
    t1 = max(n.end for n in notes)
    times = np.arange(t0, t1, step)
    seq: List[Optional[int]] = []
    vel: List[int] = []
    for t in times:
        active = [n for n in notes if n.start <= t + 1e-6 and n.end > t]
        if not active:
            seq.append(None)
            vel.append(0)
            continue
        chosen = (min(active, key=lambda n: n.pitch) if pick == "low"
                  else max(active, key=lambda n: n.pitch))
        seq.append(chosen.pitch)
        vel.append(chosen.velocity)

    out: List[Note] = []
    i = 0
    while i < len(seq):
        if seq[i] is None:
            i += 1
            continue
        j = i
        while j + 1 < len(seq) and seq[j + 1] == seq[i]:
            j += 1
        start = float(times[i])
        end = float(times[j]) + step
        if end - start >= min_dur:
            out.append(Note(start, end, int(seq[i]),
                            int(max(vel[i:j + 1]) or 96)))
        i = j + 1
    return out
