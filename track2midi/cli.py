#!/usr/bin/env python3
"""Track2MIDI command-line entry point.

    python cli.py <audio-file> [-o OUTPUT_DIR] [--device cpu|mps]

Produces stems + chords.mid / bass.mid / melody.mid and prints BPM + key.
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from analyzer import analyze


def _key_from_filename(name: str):
    """Pull a key like 'A Min' / 'c-maj' / 'F#min' out of a filename."""
    import re
    m = re.search(r"\b([A-Ga-g])\s*(#|b|♯|♭)?[\s_-]*(maj|min|major|minor)\b",
                  name, re.IGNORECASE)
    if not m:
        return None
    return f"{m.group(1)}{m.group(2) or ''} {m.group(3)}"


def _progress(msg: str, frac: float):
    bar = "█" * int(frac * 30)
    print(f"\r[{bar:<30}] {int(frac * 100):3d}%  {msg:<45}", end="", flush=True)


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Analyze a track -> MIDI + BPM/key")
    ap.add_argument("input", help="audio file (mp3/wav/flac/m4a)")
    ap.add_argument("-o", "--output", default=None,
                    help="output directory (default: ./out/<trackname>)")
    ap.add_argument("--model", default="htdemucs", help="demucs model")
    ap.add_argument("--device", default=None, help="cpu / mps / cuda")
    ap.add_argument("--quantize", type=int, default=4,
                    help="grid subdivisions per beat (4=16th notes)")
    ap.add_argument("--key", default=None,
                    help="lock the key, e.g. 'A minor' (default: auto from "
                         "filename if present, else detect)")
    ap.add_argument("--no-filename-key", action="store_true",
                    help="ignore any key written in the filename")
    ap.add_argument("--sample", action="store_true",
                    help="single instrument / loop: skip Demucs separation")
    ap.add_argument("--strum", action="store_true",
                    help="retrigger chords on each strum onset (vs sustained)")
    ap.add_argument("--detail", default="balanced",
                    choices=["balanced", "detailed", "clean"],
                    help="sample transcription density (default: balanced)")
    ap.add_argument("--full-chords", action="store_true",
                    help="legato: stretch every chord tone to fill its chord")
    args = ap.parse_args(argv)

    src = Path(args.input)
    if not src.exists():
        print(f"error: {src} not found", file=sys.stderr)
        return 1
    out = Path(args.output) if args.output else Path("out") / src.stem

    key_override = args.key
    if key_override is None and not args.no_filename_key:
        key_override = _key_from_filename(src.name)

    t0 = time.time()
    result = analyze(str(src), str(out), model=args.model, device=args.device,
                     quantize_div=args.quantize, key_override=key_override,
                     separate=not args.sample,
                     chord_style="strum" if args.strum else "sustain",
                     detail=args.detail, full_chords=args.full_chords,
                     progress=_progress)
    print()  # newline after progress bar

    locked = " (locked)" if result.key_confidence == 1.0 else ""
    print(f"\n  Tempo : {result.bpm} BPM")
    print(f"  Key   : {result.key}{locked}  (confidence {result.key_confidence})")
    if result.chords:
        prog = " ".join(result.chords[:16])
        print(f"  Chords: {prog}{' …' if len(result.chords) > 16 else ''}")
    print(f"\n  MIDI written to {out / 'midi'}/")
    for kind, path in result.midi_files.items():
        print(f"    - {kind:7s} {Path(path).name}")
    print(f"\n  Done in {time.time() - t0:.0f}s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
