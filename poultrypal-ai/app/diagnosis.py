"""The hybrid diagnosis pipeline: image findings + RAG retrieval + grounded reasoning."""
from __future__ import annotations

import json

from . import config, reference_ng
from .classifier import ImageClassifier, ImageInput, default_classifier
from .knowledge import get_store
from .knowledge.store import Chunk
from .llm import get_client
from .schemas import DIAGNOSIS_JSON_SCHEMA, DiagnosisResult, FarmInfo, Lab

DISCLAIMER = (
    "This is AI-assisted guidance, not a veterinary diagnosis. Confidence figures are "
    "estimates. For severe or fast-spreading outbreaks, contact a licensed veterinarian. "
    "Drug suggestions are limited to the retrieved knowledge sources and must be confirmed "
    "by a vet before use."
)

_SYSTEM = """You are PoultryPal AI, a livestock health assistant for poultry farmers in NIGERIA.
Frame all guidance for Nigerian smallholder/commercial poultry conditions and the drugs,
vaccines and veterinary services available there.

Hard rules — follow exactly:
1. Never claim certainty. Always give confidence percentages.
2. Provide the TOP 3 most likely diseases (fewer only if the evidence cannot support 3).
3. Explain why each disease is suspected, tied to the farmer's stated symptoms, the flock
   data (species, age, mortality), and any image findings provided.
4. DRUGS — surface what the sources name; never invent:
   - If a drug or drug class is NAMED in the SOURCES below, you MUST list it. A missing dose is
     NOT a reason to omit it. "Unverified sample" / "no dosages given" notices in a source are
     about data provenance for humans — they do NOT mean withhold the drug name. Leaving out a
     drug the source actually names is an ERROR; the farmer is relying on you to surface it.
   - For each drug set `name` to the drug as the source names it; set `note` to what the source
     says it is for, and append "source gives no dose — a vet must set the dose" whenever no
     dose is stated; set `source` to the citation title it came from.
   - Worked example: a source reads "Amprolium is a widely used anticoccidial given in drinking
     water" with no dose. The correct output includes a drug entry —
     name: "Amprolium",
     note: "Anticoccidial given in drinking water; source gives no dose — a vet must set the dose",
     source: "Coccidiosis".
     Returning an empty `drugs` array here would be WRONG.
   - NEVER invent: do not list a drug whose name is absent from the SOURCES, and never
     fabricate, estimate, or guess a dose. Only when the SOURCES name no drug at all for the
     suspected diseases should `drugs` be an empty array — then rely on supportive care + a
     vet referral.
5. Treatment plan and prevention should draw on the SOURCES; if the sources are thin, give
   general supportive husbandry guidance and say a vet should confirm specifics.
6. Recommend isolation procedures when a contagious disease is plausible.
7. Recommend contacting a licensed veterinarian; set urgency to "urgent" for high mortality,
   rapid spread, or suspicion of a notifiable disease (e.g. avian influenza, Newcastle).
8. Consider species, age, symptoms, mortality rate, and image findings together.
9. BANNED DRUGS (Nigeria/NAFDAC): NEVER recommend any of these for poultry, even if a source
   mentions one — chloramphenicol, furazolidone / nitrofurans (nitrofurantoin, furaltadone),
   carbadox, olaquindox, dimetridazole, metronidazole, ronidazole, ipronidazole, malachite
   green, chlorpromazine, stilbenes/diethylstilbestrol, nitrofural. They are banned in
   food-producing animals. When listing any antibiotic, remind the farmer to use a
   NAFDAC-registered product and observe the egg/meat withdrawal period.
10. RECOMMENDED TESTS: populate `recommended_tests` with the confirmatory lab or clinical
    test(s) that would raise certainty for your TOP suspected diseases — e.g. faecal oocyst
    count for coccidiosis, faecal egg count for worms, post-mortem examination, bacterial
    culture & antibiotic sensitivity for bacterial disease, RT-PCR / HA-HI serology for
    Newcastle or avian influenza, AGID/ELISA for Gumboro. Use any "Confirmatory test" line in
    the SOURCES. For each, say which suspected disease it confirms. These tests are run by the
    veterinary labs the app lists; do NOT invent lab names, phone numbers, or addresses.

Return ONLY the structured JSON the response format requires. Keep `sources_used` limited to
sources you actually relied on."""


def _build_query(farm: FarmInfo, image_findings: str) -> str:
    parts = [farm.species, farm.breed or "", farm.symptoms, image_findings]
    if farm.age:
        parts.append(f"age {farm.age}")
    if farm.vaccination_history:
        parts.append(farm.vaccination_history)
    return " ".join(p for p in parts if p)


def _format_sources(passages: list[tuple[Chunk, float]]) -> str:
    if not passages:
        return "(no matching knowledge sources were found)"
    blocks = []
    for chunk, score in passages:
        blocks.append(f"[Source: {chunk.title} | ref: {chunk.ref} | relevance: {score:.2f}]\n{chunk.text}")
    return "\n\n".join(blocks)


def _format_farm(farm: FarmInfo, image_findings: str) -> str:
    lines = [
        f"Species: {farm.species}",
        f"Location: {farm.state + ' State, Nigeria' if farm.state else 'Nigeria (state unspecified)'}",
        f"Breed: {farm.breed or 'unspecified'}",
        f"Age: {farm.age or 'unspecified'}",
        f"Flock size: {farm.flock_size if farm.flock_size is not None else 'unspecified'}",
        f"Sick: {farm.sick_count if farm.sick_count is not None else 'unspecified'}; "
        f"Dead: {farm.dead_count if farm.dead_count is not None else 'unspecified'}; "
        f"Days since onset: {farm.days_since_onset if farm.days_since_onset is not None else 'unspecified'}",
        f"Vaccination history: {farm.vaccination_history or 'unspecified'}",
        f"Recent changes: {farm.recent_changes or 'none reported'}",
        f"Symptoms (farmer's words): {farm.symptoms}",
    ]
    if image_findings:
        lines.append(f"Image findings (from vision analysis): {image_findings}")
    else:
        lines.append("Image findings: none (no photos provided)")
    return "\n".join(lines)


def diagnose(
    farm: FarmInfo,
    images: list[ImageInput] | None = None,
    classifier: ImageClassifier | None = None,
) -> DiagnosisResult:
    images = images or []
    classifier = classifier or default_classifier()

    # 1. Hybrid image step (pluggable). Skipped cleanly when no photos.
    image_findings = classifier.analyze(images) if images else ""

    # 2. Retrieve grounding passages from the knowledge base.
    store = get_store()
    query = _build_query(farm, image_findings)
    passages = store.query(query, config.TOP_K)

    # 3. Grounded reasoning -> structured JSON.
    user_msg = (
        f"FLOCK & SYMPTOMS\n{_format_farm(farm, image_findings)}\n\n"
        f"SOURCES (the ONLY place drugs may come from)\n{_format_sources(passages)}\n\n"
        "Produce the structured diagnosis now."
    )
    client = get_client()
    # Stream so adaptive thinking + structured output can't hit the request timeout
    # (get_final_message() returns the complete response once streaming finishes).
    with client.messages.stream(
        model=config.MODEL,
        max_tokens=8000,
        thinking={"type": "adaptive"},
        system=_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
        output_config={"format": {"type": "json_schema", "schema": DIAGNOSIS_JSON_SCHEMA}},
    ) as stream:
        resp = stream.get_final_message()
    raw = next((b.text for b in resp.content if b.type == "text"), "{}")
    data = json.loads(raw)

    # 4. Safety guard: drop any NAFDAC-banned drug even if the model surfaced one.
    kept_drugs = []
    for d in data.get("drugs", []):
        if reference_ng.is_banned(d.get("name", "")):
            continue  # never present a banned food-animal drug to the farmer
        kept_drugs.append(d)
    data["drugs"] = kept_drugs

    # 5. Always attach our disclaimer + the vision findings; enforce top-3 cap.
    data["disclaimer"] = DISCLAIMER
    data["likely_diseases"] = data.get("likely_diseases", [])[:3]
    result = DiagnosisResult(**data)
    result.image_findings = image_findings or None
    # 6. Attach the curated Nigeria lab directory (factual; never LLM-generated),
    #    ranked by proximity to the farmer's state when provided.
    result.labs = [Lab(**lab) for lab in reference_ng.lab_directory(farm.state)]
    return result
