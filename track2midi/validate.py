#!/usr/bin/env python3
"""Quick accuracy check: detect BPM + key on files that already have the
ground-truth BPM/key in their filename, and score against it.

Fast path: no Demucs. BPM from the full mix; key from the harmonic component.
"""
import re
import sys
import warnings
from pathlib import Path

warnings.filterwarnings("ignore")
import librosa  # noqa: E402

from analyzer import key as key_mod  # noqa: E402
from analyzer import tempo as tempo_mod  # noqa: E402

SR = 22050
NOTE = r"([A-G]#?)"


def parse_truth(name: str):
    bpm = None
    m = re.search(r"(\d{2,3})\s*BPM", name, re.I) or re.search(r"-(\d{2,3})-", name)
    if m:
        bpm = int(m.group(1))
    key = None
    m = re.search(NOTE + r"\s*[-\s]?\s*(min|maj|m\b|major|minor)", name, re.I)
    if m:
        tonic = m.group(1)
        mode = "minor" if m.group(2).lower().startswith("m") and "maj" not in m.group(2).lower() else "major"
        if m.group(2).lower() in ("maj", "major"):
            mode = "major"
        key = f"{tonic} {mode}"
    return bpm, key


def bpm_ok(det, truth):
    if truth is None:
        return None
    for f in (1, 2, 0.5):
        if abs(det - truth * f) <= 2:
            return True
    return False


def key_ok(det, truth):
    if truth is None:
        return None
    dt, dm = det.split()
    tt, tm = truth.split()
    return dt == tt and dm == tm


def main(paths):
    print(f"{'track':<34}{'BPM det/true':<16}{'key det/true':<22}{'':<4}")
    print("-" * 76)
    bpm_hits = bpm_tot = key_hits = key_tot = 0
    for p in paths:
        name = Path(p).name
        tb, tk = parse_truth(name)
        y, _ = librosa.load(p, sr=SR, mono=True)
        bpm = tempo_mod.detect_tempo(y, SR).bpm
        harm = librosa.effects.harmonic(y)
        k = key_mod.detect_key(harm, SR).key
        bo = bpm_ok(bpm, tb)
        ko = key_ok(k, tk)
        if bo is not None:
            bpm_tot += 1; bpm_hits += int(bo)
        if ko is not None:
            key_tot += 1; key_hits += int(ko)
        mark = "".join(["✓" if bo else "·" if bo is None else "✗",
                        "✓" if ko else "·" if ko is None else "✗"])
        short = (name[:31] + "…") if len(name) > 32 else name
        print(f"{short:<34}{f'{bpm:g}/{tb}':<16}{f'{k} / {tk}':<22}{mark}")
    print("-" * 76)
    print(f"BPM: {bpm_hits}/{bpm_tot}   Key: {key_hits}/{key_tot} "
          f"(✗ on key is usually relative major/minor)")


if __name__ == "__main__":
    main(sys.argv[1:])
