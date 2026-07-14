#!/usr/bin/env python
"""Standalone Whisper transcription worker.

Run by the isolated ASR venv (`.venv-asr`, Python 3.9 + faster-whisper) and invoked
as a subprocess by the main app, so the heavy ASR dependency (ctranslate2/av) never
has to enter the app's Python 3.14 venv.

Usage:
    python transcribe_worker.py --audio in.wav [--language en] [--model small] [--compute int8]

Emits ONE JSON line on stdout:
    {"text": "...", "language": "en", "language_probability": 0.98, "duration": 12.3}
On failure: writes "ASR_ERROR: ..." to stderr and exits non-zero.
"""
import argparse
import json
import sys

# Bias the decoder toward poultry/veterinary vocabulary so disease and drug names
# are transcribed correctly. Only applied for English (initial_prompt is language-specific).
POULTRY_PROMPT = (
    "Poultry health report. Terms may include Newcastle disease, Gumboro, infectious bursal "
    "disease, coccidiosis, fowl pox, fowl cholera, avian influenza, bird flu, Marek's disease, "
    "infectious bronchitis, mycoplasma, CRD, layers, broilers, chicks, comb, wattles, vent, "
    "droppings, diarrhoea, mortality, vaccination, amprolium, oxytetracycline, enrofloxacin."
)

_MODEL_CACHE = {}


def get_model(name: str, compute_type: str):
    from faster_whisper import WhisperModel  # imported lazily so --help is fast

    key = (name, compute_type)
    if key not in _MODEL_CACHE:
        _MODEL_CACHE[key] = WhisperModel(name, device="cpu", compute_type=compute_type)
    return _MODEL_CACHE[key]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--audio", required=True)
    ap.add_argument("--language", default="", help='ISO code (en, ha, yo, ig); "" = auto-detect')
    ap.add_argument("--model", default="small")
    ap.add_argument("--compute", default="int8")
    args = ap.parse_args()

    try:
        model = get_model(args.model, args.compute)
        lang = args.language or None
        segments, info = model.transcribe(
            args.audio,
            language=lang,
            beam_size=5,
            temperature=0.0,  # deterministic, most-likely decoding
            condition_on_previous_text=False,
            initial_prompt=POULTRY_PROMPT if lang in (None, "en") else None,
        )
        text = " ".join(s.text.strip() for s in segments).strip()
        out = {
            "text": text,
            "language": info.language,
            "language_probability": round(float(info.language_probability), 3),
            "duration": round(float(info.duration), 2),
        }
        sys.stdout.write(json.dumps(out))
    except Exception as e:  # surface a clean error to the parent process
        sys.stderr.write(f"ASR_ERROR: {type(e).__name__}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
