# VocalMatch

Reference tone-match plugin (VST3 / AU / Standalone, macOS). Learns the tonal
balance, level, and dynamics of reference vocal(s) and applies a matching
linear-phase EQ, gain, and compressor to your vocal in real time, plus an
optional one-knob reverb.

For pitch correction, put FL's Pitcher (or NewTone) BEFORE VocalMatch in the
chain — tune first, then match tone.

## Build

```sh
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j8
```

Installs automatically to `~/Library/Audio/Plug-Ins/{VST3,Components}`.
Self-check: `./build/TestMatch_artefacts/Release/TestMatch` (prints OK).

## Use (FL Studio or any DAW)

1. Insert **VocalMatch** on your vocal track/mixer insert.
2. **Load Reference…** — pick reference track(s). With **Extract vocals
   (Demucs)** ticked (default when Demucs is found), full mixes are separated
   first and only the vocal stem is analysed — takes a few minutes per track.
   Untick it for acapellas/stems. Loading more files averages them.
3. Hit **Learn Vocal**, play your vocal for 10+ seconds, hit **Stop learning**.
4. Matching turns on automatically. **Amount** blends 0–100%.
5. **De-ess**, **Breath**, **Level**, and **Harsh** knobs (0 = off) tame
   sibilance, duck breaths between phrases, hold a constant volume, and
   soften harshness. They work with or without a reference loaded.

**Harsh (reduce harshness)** is a dynamic band tamer: it isolates the
2.5–6.5 kHz harshness zone (below the de-esser's band) and ducks it only
when it gets hot — up to −12 dB at 100%. A quiet, smooth vocal passes
untouched, so presence and clarity are preserved.

**Level (constant volume)** is a slow gain rider: it pushes the short-term
loudness toward its own ~1.5 s running average, so quiet lines come up and loud
ones settle to one steady level (±12 dB range at 100%, gated so silence isn't
boosted, stereo-linked). The status line shows the live gain it's applying.

## Multi-track vocals (lead / backgrounds / adlibs)

Bus them: route all BGVs to one mixer insert, adlibs to another, lead on its
own — one VocalMatch per bus. Load the reference ONCE anywhere; every other
instance gets it instantly with **Reuse Last Ref** (saved to
`~/Library/Application Support/VocalMatch/`). Then Learn each bus separately.
Typical settings: lead Amount 100%, BGVs ~60% + more Reverb, adlibs to taste.

## Safety rails ("no mistakes")

- EQ and gain moves hard-capped at ±12 dB, compressor ratio capped at 4:1
- Compression only tightens (never expands) and is derived from measured
  loudness spread, with automatic makeup gain
- Silent passages skipped during analysis
- No correction below 40 Hz or above 16 kHz (no fake sub-bass/hiss)
- Bins where either signal has no real content are left alone
- Linear-phase FIR (no phase smear); ~46 ms latency, host-compensated
- De-ess reduction capped at −14 dB, breath attenuation at −24 dB

Note: the breath remover is a downward expander (a gentle gate), not
spectral repair — it ducks quiet inter-phrase noise but can't surgically
remove a breath that overlaps a held note. For that, use RX-style tools.
