"""Beat-grid construction, quantization, and MIDI writing helpers.

The whole point of this module is to make exported MIDI line up *perfectly*
when dropped into FL Studio: every note is snapped to a grid derived from the
detected tempo, and the timeline is shifted so the first detected beat sits at
t=0 (FL bar 1, beat 1). Set the FL project tempo to the reported BPM and the
clips drop straight onto the grid.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence

import numpy as np
import pretty_midi


@dataclass
class Note:
    start: float          # seconds (already grid-relative)
    end: float
    pitch: int            # MIDI note number
    velocity: int = 96


def build_grid(bpm: float, first_beat: float, duration: float,
               subdivisions: int = 4) -> np.ndarray:
    """Uniform grid of lines in *seconds*, relative to ``first_beat``.

    ``subdivisions`` is per beat: 4 -> 16th notes, 2 -> 8th notes, 1 -> beats.
    The grid starts at 0 (the first beat) and covers the whole track.
    """
    beat = 60.0 / float(bpm)
    step = beat / max(1, subdivisions)
    n = int(np.ceil((duration + beat) / step)) + 1
    return np.arange(n) * step


def quantize_time(t: float, grid: np.ndarray) -> float:
    """Snap a time (already grid-relative) to the nearest grid line."""
    idx = int(np.argmin(np.abs(grid - t)))
    return float(grid[idx])


def quantize_notes(notes: Sequence[Note], grid: np.ndarray,
                   min_len: float) -> List[Note]:
    """Snap note starts/ends to the grid; drop notes that collapse to zero."""
    out: List[Note] = []
    step = grid[1] - grid[0] if len(grid) > 1 else min_len
    for n in notes:
        s = quantize_time(n.start, grid)
        e = quantize_time(n.end, grid)
        if e <= s:
            e = s + step  # keep at least one grid cell
        if e - s < min_len:
            continue
        out.append(Note(s, e, n.pitch, n.velocity))
    return out


def write_midi(notes: Sequence[Note], bpm: float, path: str,
               program: int = 0, name: str = "track",
               is_drum: bool = False) -> str:
    """Write notes to a single-instrument MIDI file at the given tempo."""
    pm = pretty_midi.PrettyMIDI(initial_tempo=float(bpm))
    inst = pretty_midi.Instrument(program=program, is_drum=is_drum, name=name)
    for n in notes:
        if n.end <= n.start:
            continue
        inst.notes.append(pretty_midi.Note(
            velocity=int(np.clip(n.velocity, 1, 127)),
            pitch=int(np.clip(n.pitch, 0, 127)),
            start=float(n.start), end=float(n.end)))
    pm.instruments.append(inst)
    pm.write(path)
    return path


def shift_to_origin(notes: Sequence[Note], origin: float) -> List[Note]:
    """Subtract the timeline origin (first beat) so the grid starts at 0."""
    out = []
    for n in notes:
        s = max(0.0, n.start - origin)
        e = max(s, n.end - origin)
        out.append(Note(s, e, n.pitch, n.velocity))
    return out
