"""Clean up a raw transcription so it's playable without gutting the harmony.

basic-pitch emits stuttered fragments (one held note split into several), octave
"ghost" notes (a short note an octave above a real, longer one), and isolated
blips. Merging fragments is a near-pure win for usability; ghost/blip removal
trades a little completeness for cleanliness, so it's gated by ``level``.
"""
from __future__ import annotations

from collections import defaultdict
from typing import List

from .midi_utils import Note


def merge_fragments(notes: List[Note], gap: float = 0.07) -> List[Note]:
    """Join same-pitch notes separated by <= ``gap`` seconds into one."""
    by_pitch = defaultdict(list)
    for n in notes:
        by_pitch[n.pitch].append(n)
    out: List[Note] = []
    for p, lst in by_pitch.items():
        lst.sort(key=lambda n: n.start)
        cur = Note(lst[0].start, lst[0].end, p, lst[0].velocity)
        for nx in lst[1:]:
            if nx.start - cur.end <= gap:
                cur.end = max(cur.end, nx.end)
                cur.velocity = max(cur.velocity, nx.velocity)
            else:
                out.append(cur)
                cur = Note(nx.start, nx.end, p, nx.velocity)
        out.append(cur)
    out.sort(key=lambda n: (n.start, n.pitch))
    return out


def remove_octave_ghosts(notes: List[Note], dur_ratio: float = 1.8,
                         max_ghost: float = 0.5) -> List[Note]:
    """Drop a short note that sits an exact octave above a much longer one."""
    keep: List[Note] = []
    for n in notes:
        nd = n.end - n.start
        ghost = False
        if nd < max_ghost:
            for m in notes:
                if m.pitch == n.pitch - 12 and (m.end - m.start) > nd * dur_ratio:
                    if min(n.end, m.end) - max(n.start, m.start) > 0:
                        ghost = True
                        break
        if not ghost:
            keep.append(n)
    return keep


def remove_short_isolated(notes: List[Note], min_dur: float = 0.12) -> List[Note]:
    """Drop very short notes that don't overlap anything (lone blips)."""
    final: List[Note] = []
    for n in notes:
        if (n.end - n.start) >= min_dur:
            final.append(n)
            continue
        if any(o is not n and min(o.end, n.end) > max(o.start, n.start)
               for o in notes):
            final.append(n)
    return final


def tighten(notes: List[Note], bpm: float, subdivisions: int,
            gap_beats: float = 1.0) -> List[Note]:
    """Snap notes to a tempo grid and fill gaps so held notes are *full*.

    1. Quantize every start/end to the grid (``subdivisions`` per beat).
    2. Per pitch, merge notes whose gap is <= ``gap_beats`` — so a chord that
       basic-pitch chopped into separate plucks becomes one sustained note.
    3. Guarantee at least one grid cell of length (no sub-grid slivers).

    Notes are assumed already shifted so the first beat sits at t=0.
    """
    if not notes or subdivisions <= 0:
        return notes
    beat = 60.0 / float(bpm)
    step = beat / subdivisions

    q: List[Note] = []
    for n in notes:
        s = round(n.start / step) * step
        e = round(n.end / step) * step
        if e <= s:
            e = s + step
        q.append(Note(s, e, n.pitch, n.velocity))

    gap = gap_beats * beat + 1e-6
    by_pitch = defaultdict(list)
    for n in q:
        by_pitch[n.pitch].append(n)
    out: List[Note] = []
    for p, lst in by_pitch.items():
        lst.sort(key=lambda n: n.start)
        cur = Note(lst[0].start, lst[0].end, p, lst[0].velocity)
        for nx in lst[1:]:
            if nx.start - cur.end <= gap:
                cur.end = max(cur.end, nx.end)
                cur.velocity = max(cur.velocity, nx.velocity)
            else:
                out.append(cur)
                cur = Note(nx.start, nx.end, p, nx.velocity)
        out.append(cur)
    out.sort(key=lambda n: (n.start, n.pitch))
    return out


def clean(notes: List[Note], level: str = "light") -> List[Note]:
    """Apply cleanup by level: 'none' (merge only), 'light' (+ghosts),
    'full' (+isolated-blip removal)."""
    notes = merge_fragments(notes)
    if level in ("light", "full"):
        notes = remove_octave_ghosts(notes)
    if level == "full":
        notes = remove_short_isolated(notes)
    notes.sort(key=lambda n: (n.start, n.pitch))
    return notes
