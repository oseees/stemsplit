#!/usr/bin/env python3
"""beatprep — beat facts in, upload-ready copy + pricing out. One Claude call, no loop.

Usage:
    python beatprep.py "Falling" --bpm 103 --key "F# minor" --genre afrobeats \
        --mood "smooth, romantic, night drive" --artists "Wizkid, Omah Lay"

Needs ANTHROPIC_API_KEY in the environment. `pip install anthropic`.
"""
import argparse, json, sys

# ponytail: pricing is a fixed strategy table, not an LLM job. Edit these to your rates.
# Lease prices are flat; only exclusive scales with genre demand.
LEASES = {
    "MP3 Lease":      {"price": 24.95, "terms": "MP3, non-exclusive, 5,000 streams, 1 music video"},
    "WAV Lease":      {"price": 44.95, "terms": "MP3+WAV, non-exclusive, 10,000 streams, 1 video"},
    "Trackout Lease": {"price": 99.95, "terms": "Full stems, non-exclusive, 100,000 streams, 2 videos"},
}
EXCLUSIVE_BASE = 300  # USD; bumped for hotter genres
GENRE_MULT = {"afrobeats": 1.5, "amapiano": 1.4, "afropop": 1.3, "rnb": 1.2, "neosoul": 1.1}


def pricing(genre: str) -> dict:
    g = genre.lower().replace("-", "").replace("&", "").replace(" ", "").replace("/", "")
    mult = GENRE_MULT.get("rnb" if g in ("randb", "rb") else g, 1.0)
    tiers = dict(LEASES)
    tiers["Exclusive"] = {"price": round(EXCLUSIVE_BASE * mult),
                          "terms": "Full ownership transfer, beat removed from store, unlimited use"}
    return tiers


PROMPT = """You are a BeatStars/YouTube SEO expert for Afrobeats, Afropop, Amapiano, R&B and Neo-Soul producers.
Given the beat below, return ONLY JSON (no prose) with these keys:
- "beatstars_description": 2-3 sentence store description, mood-driven, ends with a call to action.
- "youtube_title": SEO title, format "(FREE) {similar artists} Type Beat \"{name}\" | {genre} Instrumental {year}".
- "youtube_tags": array of 15-20 lowercase search tags (type beat, artist type beats, genre, mood, bpm).
- "caption": one Instagram/TikTok caption, punchy, 2 emojis max, 5-8 hashtags.

Beat: name="{name}", bpm={bpm}, key="{key}", genre="{genre}", mood="{mood}", similar_artists="{artists}", year={year}."""


def generate(beat: dict) -> dict:
    import anthropic
    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-opus-4-8",
        max_tokens=1024,
        messages=[{"role": "user", "content": PROMPT.format(**beat)}],
    )
    text = msg.content[0].text.strip()
    if text.startswith("```"):            # strip a ```json fence if the model adds one
        text = text.split("```")[1].removeprefix("json").strip()
    return json.loads(text)


def render(beat: dict, copy: dict, tiers: dict) -> str:
    lines = [f"=== {beat['name']} — {beat['bpm']} BPM, {beat['key']} ({beat['genre']}) ===\n",
             "-- BeatStars description --", copy["beatstars_description"], "",
             "-- YouTube title --", copy["youtube_title"], "",
             "-- YouTube tags --", ", ".join(copy["youtube_tags"]), "",
             "-- Social caption --", copy["caption"], "",
             "-- Pricing / licensing --"]
    for name, t in tiers.items():
        lines.append(f"  {name:<15} ${t['price']:<7} {t['terms']}")
    return "\n".join(lines)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("name")
    p.add_argument("--bpm", type=int, required=True)
    p.add_argument("--key", required=True)
    p.add_argument("--genre", default="afrobeats")
    p.add_argument("--mood", default="")
    p.add_argument("--artists", default="", help="comma-separated similar artists")
    p.add_argument("--year", type=int, default=2026)
    a = p.parse_args()
    beat = vars(a)
    print(render(beat, generate(beat), pricing(beat["genre"])))


def _selfcheck():
    # ponytail: only the deterministic bits are testable offline; LLM copy isn't.
    assert pricing("afrobeats")["Exclusive"]["price"] == 450
    assert pricing("R&B")["Exclusive"]["price"] == 360
    assert pricing("unknown-genre")["Exclusive"]["price"] == 300
    assert pricing("afrobeats")["MP3 Lease"]["price"] == 24.95
    out = render({"name": "T", "bpm": 100, "key": "C", "genre": "afrobeats"},
                 {"beatstars_description": "d", "youtube_title": "t",
                  "youtube_tags": ["a", "b"], "caption": "c"}, pricing("afrobeats"))
    assert "Exclusive" in out and "$450" in out
    print("selfcheck ok")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--selfcheck":
        _selfcheck()
    else:
        main()
