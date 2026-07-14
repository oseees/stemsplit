# Track2MIDI

Drag a song in → get **stems**, **chord / bass / melody MIDI**, plus the
detected **BPM** and **key**, all snapped to a tempo grid so the `.mid` files
drop straight into **FL Studio**.

## How it works

```
audio ─▶ Demucs (drums/bass/other/vocals)
          ├─ full mix      ─▶ tempo + beat grid     ─▶ BPM
          ├─ no-drums mix  ─▶ key (Krumhansl-Schmuckler)
          ├─ no-drums mix  ─▶ chords (beat-sync chroma templates) ─▶ chords.mid
          ├─ bass stem     ─▶ pYIN pitch tracking   ─▶ bass.mid
          └─ vocals/other  ─▶ pYIN pitch tracking   ─▶ melody.mid
```

All MIDI is quantized to a grid built from the detected BPM and shifted so the
first beat sits at t=0.

## Run

```bash
./run.sh                 # desktop app
# or the CLI:
../backend/venv/bin/python cli.py "song.mp3" -o out/song
```

Outputs land in `~/Track2MIDI/<trackname>/`:
- `stems/` — separated wavs
- `midi/chords.mid`, `midi/bass.mid`, `midi/melody.mid`
- `analysis.json` — BPM, key, chord progression

## Using the MIDI in FL Studio

1. Set the project tempo to the reported **BPM**.
2. Drag each `.mid` from `midi/` into the playlist (or piano roll).
3. They land on bar 1, on the grid. Assign your own instruments.

## Accuracy notes (honest)

- **BPM** — very reliable; half/double-time is auto-corrected into 70–150.
- **Key** — Krumhansl-Schmuckler on the harmonic mix; relative major/minor is
  the usual confusion.
- **Bass** — most reliable MIDI (isolated + monophonic).
- **Chords** — triads/7ths per beat; good on clear progressions, weaker on
  dense or ambiguous harmony.
- **Melody** — cleanest on isolated vocals; busy "lead" layers are harder.

Transcription is never 100%. Treat the MIDI as a strong starting point you
clean up in the piano roll, not a final master.

## Setup (fresh machine)

Reuses the sibling `backend/venv` (Python 3.9, torch + demucs already there).
To build standalone:

```bash
python3.9 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```
