"""End-to-end analysis: audio file -> stems -> BPM/key + chord/bass/melody MIDI.

Everything is quantized to a grid derived from the detected tempo and shifted so
the first beat lands at t=0, so the exported .mid files drop straight onto the
grid in FL Studio (set the project tempo to the reported BPM).
"""
from __future__ import annotations

import json
import os
import tempfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Dict, List, Optional

import librosa
import numpy as np

from . import basic_pitch_engine
from . import chords as chords_mod
from . import key as key_mod
from . import notes_to_chords
from . import postprocess
from . import separation
from . import tempo as tempo_mod
from . import transcribe
from .midi_utils import (Note, build_grid, quantize_notes, shift_to_origin,
                         write_midi)

Progress = Optional[Callable[[str, float], None]]

SR = 22050

# We always transcribe as completely as possible (richer notes => better chord
# labels AND higher fidelity to the source, both confirmed empirically). The
# Detail level then only sets how aggressively notes.mid is cleaned up, so the
# user trades note density without ever degrading the chord read.
_BP_PARAMS = dict(minimum_note_length=110.0, minimum_frequency=90.0,
                  maximum_frequency=1320.0, onset_threshold=0.5,
                  frame_threshold=0.3)
_CLEAN_LEVEL = {"detailed": "none", "balanced": "light", "clean": "full"}


@dataclass
class AnalysisResult:
    bpm: float
    key: str
    key_confidence: float
    midi_files: Dict[str, str] = field(default_factory=dict)
    stems: Dict[str, str] = field(default_factory=dict)
    chords: List[str] = field(default_factory=list)
    chord_segments: List[dict] = field(default_factory=list)
    output_dir: str = ""

    def to_dict(self) -> dict:
        return {
            "bpm": self.bpm,
            "key": self.key,
            "key_confidence": self.key_confidence,
            "midi_files": self.midi_files,
            "stems": self.stems,
            "chord_progression": self.chords,
            "chord_segments": self.chord_segments,
            "output_dir": self.output_dir,
        }


def _seg_dicts(segs) -> List[dict]:
    """Timed chord segments for the GUI timeline."""
    return [{"name": s.name, "root": int(s.root),
             "start": round(float(s.start), 3),
             "end": round(float(s.end), 3)} for s in segs]


def _load(path: str) -> np.ndarray:
    y, _ = librosa.load(path, sr=SR, mono=True)
    return y


def _write_temp_wav(y: np.ndarray, sr: int) -> str:
    """Write an in-memory signal to a temp WAV (basic-pitch needs a file)."""
    import soundfile as sf
    fd, path = tempfile.mkstemp(prefix="t2m_harm_", suffix=".wav")
    os.close(fd)
    sf.write(path, y, sr)
    return path


def _rms(y: np.ndarray) -> float:
    return float(np.sqrt(np.mean(y ** 2))) if y.size else 0.0


def _parse_key(s: Optional[str]):
    """Parse 'A minor' / 'C# maj' / 'Bb min' -> (tonic_index, mode) or (None, None)."""
    if not s:
        return None, None
    import re
    m = re.search(r"([A-Ga-g])\s*(#|b|♯|♭)?\s*(maj|min|major|minor|m)?",
                  s.strip(), re.IGNORECASE)
    if not m:
        return None, None
    flats = {"Db": "C#", "Eb": "D#", "Gb": "F#", "Ab": "G#", "Bb": "A#"}
    note = m.group(1).upper() + (m.group(2) or "").replace("♯", "#").replace("♭", "b")
    note = flats.get(note, note).replace("b", "")
    if note not in key_mod.PITCHES:
        return None, None
    qual = (m.group(3) or "minor").lower()
    mode = "major" if qual in ("maj", "major") else "minor"
    return key_mod.PITCHES.index(note), mode


def analyze(input_path: str, output_dir: str,
            model: str = "htdemucs",
            device: Optional[str] = None,
            quantize_div: int = 4,
            key_override: Optional[str] = None,
            separate: bool = True,
            chord_style: str = "sustain",
            detail: str = "balanced",
            full_chords: bool = False,
            progress: Progress = None) -> AnalysisResult:
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    midi_dir = out / "midi"
    midi_dir.mkdir(exist_ok=True)

    def report(msg: str, frac: float):
        if progress:
            progress(msg, frac)

    # 1. Stem separation -------------------------------------------------
    # Sample mode (separate=False) skips Demucs entirely — right for a single
    # instrument / loop, where there's nothing to separate.
    if separate:
        stems = separation.separate(input_path, str(out), model=model,
                                    device=device, progress=progress)
    else:
        report("Sample mode — skipping separation…", 0.05)
        stems = {}

    # 2. Tempo from the full mix ----------------------------------------
    report("Detecting tempo…", 0.50)
    full = _load(input_path)
    duration = librosa.get_duration(y=full, sr=SR)
    t = tempo_mod.detect_tempo(full, SR)
    bpm, beat_times, origin = t.bpm, t.beat_times, t.first_beat

    # Harmonic (no-drums) mix for key + chords; the raw signal in sample mode.
    harm = None
    for name in ("bass", "other", "vocals"):
        if name in stems:
            s = _load(stems[name])
            if harm is None:
                harm = s
            else:
                n = min(len(harm), len(s))
                harm = harm[:n] + s[:n]
    if harm is None:
        harm = full

    # Load the bass stem once — used for both chord roots and bass MIDI.
    bass_y = _load(stems["bass"]) if "bass" in stems else None

    # 3. Key -------------------------------------------------------------
    report("Detecting key…", 0.58)
    det = key_mod.detect_key(harm, SR)
    ov_tonic, ov_mode = _parse_key(key_override)
    if ov_tonic is not None:
        tonic_idx, key_mode = ov_tonic, ov_mode
        key_str = f"{key_mod.PITCHES[tonic_idx]} {key_mode}"
        key_conf = 1.0
        key_locked = True
    else:
        tonic_idx = key_mod.PITCHES.index(det.tonic) if det.tonic in key_mod.PITCHES else None
        key_mode, key_str, key_conf, key_locked = det.mode, det.key, det.confidence, False

    # 4-6. Notes / chords / bass / melody --------------------------------
    grid = build_grid(bpm, origin, duration, subdivisions=quantize_div)
    min_len = 60.0 / bpm / max(1, quantize_div) * 0.5
    midi_files: Dict[str, str] = {}
    chord_names: List[str] = []
    chord_segs: List[dict] = []
    use_bp = basic_pitch_engine.available()

    if not separate:
        # Sample mode: one trained-model transcription drives everything — the
        # right tool for pulling accurate MIDI out of an arbitrary sample.
        # With Quantize on (default) we tighten the output to the grid and
        # gap-fill held notes so the piano roll is full & arranged; with
        # Quantize Off we keep exact timing for layering over the source.
        report("Transcribing (trained model)…", 0.55)
        # Transcribe as completely as possible; chords are derived from these
        # full notes for the best labels.
        raw = basic_pitch_engine.transcribe(input_path, **_BP_PARAMS)

        report("Labelling chords…", 0.72)
        segs = notes_to_chords.detect_chords_from_notes(
            raw, beat_times, tonic=tonic_idx, mode=key_mode)
        chord_names = _dedupe([s.name for s in segs])
        chord_segs = _seg_dicts(segs)

        def finish(ns: List[Note], gap_beats: float = 1.0,
                   merge: bool = True) -> List[Note]:
            """Shift to bar 1 and snap to grid (unless Quantize is Off).

            ``merge`` gap-fills chopped fragments into held notes. It MUST be
            off for pre-blocked notes (chord blocks / legato) or adjacent chord
            blocks of the same pitch fuse into one endless note.
            """
            if not (quantize_div and quantize_div > 0):
                return ns
            ns = shift_to_origin(ns, origin)
            if merge:
                return postprocess.tighten(ns, bpm, quantize_div,
                                           gap_beats=gap_beats)
            return quantize_notes(ns, grid, min_len)

        # Chords: full blocks per segment, re-struck at each chord change.
        cnotes = finish(notes_to_chords.chords_to_blocks_real(raw, segs),
                        merge=False)
        chords_path = str(midi_dir / "chords.mid")
        write_midi(cnotes, bpm, chords_path, program=0, name="chords")
        midi_files["chords"] = chords_path

        # notes.mid at the chosen density (chords above are unaffected).
        clean_notes = postprocess.clean(raw, level=_CLEAN_LEVEL.get(detail, "light"))
        if full_chords:
            # Legato blocks already span each chord — quantize only, don't merge.
            notes_out = finish(notes_to_chords.legato_to_chords(clean_notes, segs),
                               merge=False)
        else:
            notes_out = finish(clean_notes, gap_beats=1.0)
        notes_path = str(midi_dir / "notes.mid")
        write_midi(notes_out, bpm, notes_path, program=0, name="notes")
        midi_files["notes"] = notes_path

        report("Extracting bass & melody…", 0.88)
        bline = notes_to_chords.voice_line(clean_notes, pick="low")
        if bline:
            if full_chords:
                bnotes_out = finish(notes_to_chords.legato_to_chords(bline, segs),
                                    merge=False)
            else:
                bnotes_out = finish(bline, gap_beats=1.0)
            bpth = str(midi_dir / "bass.mid")
            write_midi(bnotes_out, bpm, bpth, program=33, name="bass")
            midi_files["bass"] = bpth
        mline = notes_to_chords.voice_line(clean_notes, pick="high")
        if mline:
            mpth = str(midi_dir / "melody.mid")
            write_midi(finish(mline), bpm, mpth, program=0, name="melody")
            midi_files["melody"] = mpth
    else:
        # Full-song mode: Demucs stems. Chords come from the trained model run
        # on the no-drums mix when available (far more accurate than chroma),
        # with the chroma matcher as a fallback. Bass/melody from the isolated
        # stems via pitch tracking (cleaner mono lines).
        report("Detecting chords…", 0.62)
        if use_bp:
            harm_wav = _write_temp_wav(harm, SR)
            try:
                hnotes = basic_pitch_engine.transcribe(harm_wav)
            finally:
                try:
                    os.remove(harm_wav)
                except OSError:
                    pass
            segs = notes_to_chords.detect_chords_from_notes(
                hnotes, beat_times, tonic=tonic_idx, mode=key_mode)
            chord_names = _dedupe([s.name for s in segs])
            chord_segs = _seg_dicts(segs)
            cnotes = shift_to_origin(
                notes_to_chords.chords_to_blocks(segs), origin)
        else:
            csegs = chords_mod.detect_chords(harm, SR, beat_times, bass=bass_y,
                                             tonic=tonic_idx, mode=key_mode,
                                             key_locked=key_locked)
            chord_names = _dedupe([s.name for s in csegs])
            chord_segs = _seg_dicts(csegs)
            cnotes = shift_to_origin(chords_mod.chords_to_notes(csegs), origin)
        chords_path = str(midi_dir / "chords.mid")
        write_midi(cnotes, bpm, chords_path, program=0, name="chords")
        midi_files["chords"] = chords_path

        # 5. Bass
        report("Transcribing bass…", 0.72)
        if bass_y is not None:
            bnotes = transcribe.transcribe_mono(
                bass_y, SR, fmin=librosa.note_to_hz("E1"),
                fmax=librosa.note_to_hz("E4"), velocity=100)
            bnotes = quantize_notes(shift_to_origin(bnotes, origin), grid, min_len)
            bpth = str(midi_dir / "bass.mid")
            write_midi(bnotes, bpm, bpth, program=33, name="bass")
            midi_files["bass"] = bpth

        # 6. Melody
        report("Transcribing melody…", 0.88)
        melody_src = _pick_melody_stem(stems)
        if melody_src:
            ym = _load(melody_src)
            mnotes = transcribe.transcribe_mono(
                ym, SR, fmin=librosa.note_to_hz("C2"),
                fmax=librosa.note_to_hz("C6"), velocity=96)
            mnotes = quantize_notes(shift_to_origin(mnotes, origin), grid, min_len)
            mpth = str(midi_dir / "melody.mid")
            write_midi(mnotes, bpm, mpth, program=0, name="melody")
            midi_files["melody"] = mpth

    # 7. Summary ---------------------------------------------------------
    result = AnalysisResult(
        bpm=bpm, key=key_str, key_confidence=key_conf,
        midi_files=midi_files, stems=stems, chords=chord_names,
        chord_segments=chord_segs, output_dir=str(out))
    with open(out / "analysis.json", "w") as f:
        json.dump(result.to_dict(), f, indent=2)
    report("Done.", 1.0)
    return result


def _pick_melody_stem(stems: Dict[str, str]) -> Optional[str]:
    """Use vocals if present and audible, otherwise the 'other' stem."""
    if "vocals" in stems:
        yv = _load(stems["vocals"])
        if _rms(yv) > 0.005:
            return stems["vocals"]
    return stems.get("other")


def _dedupe(seq: List[str]) -> List[str]:
    out: List[str] = []
    for s in seq:
        if not out or out[-1] != s:
            out.append(s)
    return out
