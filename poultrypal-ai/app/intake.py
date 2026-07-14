"""Turn a farmer's free-spoken description into structured form fields.

After Whisper transcribes the voice clip, this asks Claude to pull out the flock
intake fields (bird type, age, flock size, vaccinations, state, symptoms, ...) and
NORMALISE them to the form's expected values — e.g. "six weeks" -> "6 weeks",
"broilers" -> "Chicken — broiler", "Kano" -> the state option. The farmer reviews
and edits everything before diagnosing; nothing is auto-submitted.

Requires an API key. Without one, the caller falls back to putting the raw
transcript into the symptoms box.
"""
from __future__ import annotations

import json

from . import config, reference_ng
from .llm import get_client

# Must match the form's <select name="species"> options exactly (note the em dash).
SPECIES_OPTIONS = [
    "Chicken — layer", "Chicken — broiler", "Chicken — backyard/mixed",
    "Duck", "Turkey", "Guinea fowl", "Other",
]

# All-string schema so unknown values are simply "" (avoids null/union edge cases).
INTAKE_JSON_SCHEMA: dict = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "species": {"type": "string"},
        "age": {"type": "string"},
        "flock_size": {"type": "string"},
        "sick_count": {"type": "string"},
        "dead_count": {"type": "string"},
        "days_since_onset": {"type": "string"},
        "vaccination_history": {"type": "string"},
        "state": {"type": "string"},
        "recent_changes": {"type": "string"},
        "symptoms": {"type": "string"},
    },
    "required": [
        "species", "age", "flock_size", "sick_count", "dead_count",
        "days_since_onset", "vaccination_history", "state", "recent_changes", "symptoms",
    ],
}


def _system() -> str:
    return (
        "You extract poultry-flock intake details from a Nigerian farmer's spoken description. "
        "Return ONLY the structured JSON. Use an empty string \"\" for anything the farmer did "
        "not clearly state — NEVER guess or invent.\n\n"
        "Normalisation rules:\n"
        f"- species: choose EXACTLY one of {SPECIES_OPTIONS}, else \"\".\n"
        f"- state: choose EXACTLY one Nigerian state from {reference_ng.NIGERIA_STATES}, else \"\".\n"
        "- age: a short phrase like \"6 weeks\" or \"1.5 years\" (convert words to digits).\n"
        "- flock_size, sick_count, dead_count, days_since_onset: digits only (e.g. \"50\"), else \"\".\n"
        "- vaccination_history: the vaccines named, comma-separated (e.g. \"Newcastle, Gumboro\"); "
        "if the farmer says none/not vaccinated, use \"none\"; if not mentioned, \"\".\n"
        "- symptoms: the clinical signs in the farmer's own words, cleaned up; \"\" if none.\n"
        "- recent_changes: new birds, feed/water/weather/relocation changes, else \"\"."
    )


def extract_fields(transcript: str) -> dict:
    """Extract & normalise intake fields from a transcript. Raises LLMUnavailable
    (from get_client) if no API key is configured."""
    client = get_client()
    with client.messages.stream(
        model=config.MODEL,
        max_tokens=1500,
        thinking={"type": "adaptive"},
        system=_system(),
        messages=[{"role": "user", "content": f"Farmer said:\n\"\"\"\n{transcript}\n\"\"\"\n\nExtract the intake fields."}],
        output_config={"format": {"type": "json_schema", "schema": INTAKE_JSON_SCHEMA}},
    ) as stream:
        resp = stream.get_final_message()
    raw = next((b.text for b in resp.content if b.type == "text"), "{}")
    data = json.loads(raw)

    # Hard-validate the normalised picks so the UI only ever gets known values.
    if data.get("species") not in SPECIES_OPTIONS:
        data["species"] = ""
    if data.get("state") not in reference_ng.NIGERIA_STATES:
        data["state"] = ""
    # Keep only non-empty fields so we don't clobber anything the farmer typed.
    return {k: v for k, v in data.items() if isinstance(v, str) and v.strip()}
