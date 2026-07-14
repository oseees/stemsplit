# VocalPerfect

One-click vocal chain plugin (AU / VST3 / Standalone) for Afrobeats & R&B.
Drop it on a vocal, pick a preset, done. The chain is fixed — the same signal
path the top mixers run — and the presets are their recipes.

## The study: what the best vocal mixers actually do

**Jaycen Joshua** (Beyoncé, Rihanna, SZA, Chris Brown) — his chain never
changes; he gain-stages the *input* so the vocal hits fixed thresholds
correctly. That's why one-click chains usually fail: the thresholds only work
at one input level. VocalPerfect copies the move — an auto gain-stager rides
the input to −18 dBFS RMS before anything else, so every preset lands the same
on a whisper demo or a hot take. He also compresses in series: two compressors
doing 2–3 dB each sound transparent where one doing 6 dB pumps.

**Manny Marroquin** (Alicia Keys, Whitney Houston) — subtractive EQ *before*
compression, additive *after*. Cut the mud (250–350 Hz) and box (700–900 Hz)
first so the compressor doesn't squeeze frequencies you were going to remove.

**Derek "MixedByAli" Ali** (Kendrick Lamar, SZA) — de-ess *before* the
compressors. Compression brings sibilance up; if esses drive the comp it
pumps on every "s". Clean first, then compress.

**Tony Maserati** (Beyoncé, Mary J. Blige) — low-shelf warmth (~220 Hz) and
slow optical compression for ballads: density without grabbing transients.

**Dave Pensado** (Destiny's Child, Mary J. Blige) — surgical mud cuts plus an
aggressive 4–5 kHz presence bell for a dry, in-your-face pop vocal.

**Afrobeats** (Swaps — Burna Boy; STG — Wizkid "Essence") — tight high-pass
(100–150 Hz) so the vocal clears the log-drum/bass-heavy production, a big air
shelf at 11 kHz+, saturation for density, and the genre signature: a mono slap
delay (~120 ms) with darkened repeats plus a short plate. Ad-libs run brighter
and wetter than the lead.

## The chain (fixed order)

```
auto gain-stage (→ −18 dBFS RMS)      Jaycen: stage INTO the chain
→ HPF → mud cut → box cut             Marroquin: subtract before compressing
→ de-esser (>6.5 kHz)                 Ali: de-ess before the comps
→ fast comp 4:1 (1176 role)           peaks
→ slow comp 2.5:1 (LA-2A role)        density — serial pair, few dB each
→ tanh saturation                     harmonics
→ warmth shelf → presence bell → air shelf
→ mono slap delay → plate reverb      Afrobeats space
→ safety limiter (−1 dB)              "perfect" never clips
```

## Presets

| Preset | Recipe |
|---|---|
| **Afro Lead** | HPF 100, air +4 @ 11k, presence +2.5 @ 4k, sat, slap 120 ms + short plate |
| **Afro Adlib** | HPF 150, air +5, more sat, much wetter slap/plate — sits behind the lead |
| **RnB Silk** | Jaycen-style: heavier serial compression, silk air +3.5 @ 13.5k, warmth +1, plate only |
| **RnB Warm Ballad** | Maserati-style: HPF 75, warmth +2 @ 220, gentle slow comp, bigger darker verb |
| **Presence Pop** | Pensado-style: deep mud/box cuts, presence +3.5 @ 4.5k, nearly dry |
| **Clean** | Just polish: light comp, small air — for already-mixed vocals |

## Controls

- **Preset** — the recipe (also exposed as DAW programs)
- **Amount** — 0 = bypass-ish, 1 = full recipe; everything scales together
- **Space** — scales slap + reverb (0 = dry, 2 = double)
- **Output** — trim ±12 dB

## Build

```sh
cmake -B build && cmake --build build -j8
```

Installs AU + VST3 to `~/Library/Audio/Plug-Ins` automatically. Reuses the
JUCE checkout from `../vocalmatch/build/_deps` (no re-download).

Check: `./build/TestChain_artefacts/TestChain` and
`auval -v aufx Vpfc Osea`.
