#!/usr/bin/env python3
"""Improved tempo estimator: parabolic-interpolated ACF + octave disambiguation."""
import os
import warnings
warnings.filterwarnings("ignore")
import librosa
import numpy as np

SR = 22050
HOP = 256  # finer than 512 -> better BPM resolution

TRUTH = [
    ("/Users/oseabhi/Downloads/sonoma coast (prod. TERMULA) 125 BPM A Min.mp3", 125),
    ("/Users/oseabhi/Downloads/redemption (prod. TERMULA) 93 BPM A Min.mp3", 93),
    ("/Users/oseabhi/Downloads/room 304 (prod. TERMULA) 129 BPM C# Min.mp3", 129),
    ("/Users/oseabhi/Downloads/give you the world (prod. TERMULA) 118 BPM D Min.mp3", 118),
    ("/Users/oseabhi/Downloads/blue eyed lover (prod. TERMULA) 125 F Min.mp3", 125),
    ("/Users/oseabhi/Downloads/old fashion '68 (prod. TERMULA) 105 BPM C# Min.mp3", 105),
    ("/Users/oseabhi/Downloads/overdue (prod. TERMULA) 121 BPM C# Min.mp3", 121),
    ("/Users/oseabhi/Downloads/STREAM-84-afro-105-bmin.mp3", 105),
    ("/Users/oseabhi/Downloads/STREAM-74-afro-a-maj-120.mp3", 120),
    ("/Users/oseabhi/Downloads/STREAM-69-rnb-gmin-133.mp3", 133),
]
FPS = SR / HOP


def parabolic(y, x):
    """Refine peak index x using parabolic interpolation; return refined x."""
    if x <= 0 or x >= len(y) - 1:
        return float(x)
    a, b, c = y[x - 1], y[x], y[x + 1]
    denom = (a - 2 * b + c)
    if denom == 0:
        return float(x)
    return x + 0.5 * (a - c) / denom


def acf_candidates(oenv):
    ac = librosa.autocorrelate(oenv, max_size=len(oenv))
    ac[:1] = 0
    lags = np.arange(len(ac))
    bpms = 60.0 * FPS / np.maximum(lags, 1)
    mask = (bpms >= 55) & (bpms <= 210)
    region = np.where(mask)[0]
    # find local maxima in the valid region
    peaks = [i for i in region if 1 <= i < len(ac) - 1 and ac[i] >= ac[i-1] and ac[i] >= ac[i+1]]
    peaks.sort(key=lambda i: ac[i], reverse=True)
    out = []
    for i in peaks[:6]:
        lag = parabolic(ac, i)
        out.append((60.0 * FPS / lag, ac[i]))
    return out  # list of (bpm, strength)


def estimate(y):
    oenv = librosa.onset.onset_strength(y=y, sr=SR, hop_length=HOP)
    cands = acf_candidates(oenv)
    if not cands:
        return 120.0
    # beat tracker gives a reliable "felt" tempo to anchor the octave
    tempo_bt, _ = librosa.beat.beat_track(onset_envelope=oenv, sr=SR, hop_length=HOP, trim=False)
    anchor = float(np.atleast_1d(tempo_bt)[0])
    # score candidates: prefer strong ACF peaks whose octave is near the anchor
    def score(bpm, strength):
        b = bpm
        # fold candidate toward anchor's octave
        for _ in range(3):
            if b < anchor / 1.4: b *= 2
            elif b > anchor * 1.4: b /= 2
        return strength / (1 + abs(b - anchor) / anchor), b
    best_bpm, best_s = None, -1
    for bpm, strength in cands:
        s, folded = score(bpm, strength)
        if s > best_s:
            best_s, best_bpm = s, folded
    # final fold into musical range
    b = best_bpm
    while b < 70: b *= 2
    while b > 180: b /= 2
    return b


print(f"{'track':<30}{'true':>5}{'est':>8}{'round':>7}  hit")
print("-" * 56)
hit = 0
for path, true in TRUTH:
    y, _ = librosa.load(path, sr=SR, mono=True)
    est = estimate(y)
    r = round(est)
    ok = abs(r - true) <= 1
    hit += ok
    print(f"{os.path.basename(path)[:28]:<30}{true:>5}{est:>8.2f}{r:>7}  {'✓' if ok else '✗'}")
print("-" * 56)
print(f"within ±1 BPM: {hit}/10")
