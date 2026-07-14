"""Production optimizer: grounded advice to raise broiler weight gain or layer egg output.

Same shape as the diagnosis pipeline — retrieve grounding passages from the knowledge
base, then ask Claude for a structured plan whose NUMBERS (weights, % production, CP/energy/
calcium, feed intake) come from the sources rather than being invented. Safety stance matches
the rest of the app: never recommend hormones, illegal "boosters", growth-promoter antibiotics,
or any NAFDAC-banned drug — performance comes from feed quality, management and health.
"""
from __future__ import annotations

import json

from . import config
from .knowledge import get_store
from .knowledge.store import Chunk
from .llm import get_client
from .schemas import PERFORMANCE_JSON_SCHEMA, PerformancePlan, PerformanceRequest

DISCLAIMER = (
    "This is AI-assisted production guidance, not a veterinary or nutrition prescription. "
    "Targets are typical ranges that vary with strain, feed and weather. Confirm feed "
    "formulation and any medicine with a NAFDAC-registered label, a licensed vet, or a poultry "
    "nutritionist. There is no legal hormone or injectable booster for poultry — be wary of any "
    "product that promises one."
)

_SYSTEM = """You are PoultryPal AI, a poultry PRODUCTION adviser for farmers in NIGERIA.
The farmer wants to improve performance: for BROILERS, weight gain to reach a good market
weight by about 6 weeks; for LAYERS, egg production. Give practical, Nigeria-appropriate advice.

Hard rules — follow exactly:
1. Ground all numeric targets (live weights, % hen-day production, CP/energy/calcium, feed
   intake, ages) in the SOURCES below. If the sources give no number for something, speak
   qualitatively rather than inventing a figure.
2. Performance comes from FEED quality, MANAGEMENT (brooding, heat, light, water, stocking
   density, stress) and HEALTH. NEVER recommend hormones, illegal "egg/weight boosters",
   antibiotic growth promoters, or any NAFDAC-banned drug — there is no legal hormone for
   poultry. If you mention any medicine, say to use a NAFDAC-registered product and observe the
   egg/meat withdrawal period.
3. current_assessment: judge where this flock is now versus the typical Nigerian benchmark in the
   sources, using the farmer's stated age, weight/production, feed and management.
4. gaps: the most likely reasons performance is below target, tied to what the farmer described.
5. targets: the benchmark figures for this bird type and age (label + value), from the sources.
6. feeding_plan: phase-by-phase feeding for this bird type (protein/energy/calcium and intake as
   the sources allow). management_actions: the husbandry levers, most impactful first.
   health_checks: parasites/diseases that quietly suppress performance, plus a reminder to run a
   health diagnosis in the app if any bird looks sick.
7. weekly_plan: a short, realistic timeline of what to do (broilers: this week through week 6;
   layers: the next few weeks).
8. expected_outcome: be honest — gains take time and depend on feed and health. Do not promise
   specific numbers you cannot ground in the sources.
9. cautions: MUST include the no-hormone / no-illegal-booster point and a warning about mouldy,
   aflatoxin-contaminated or adulterated feed.

Return ONLY the structured JSON the response format requires. Keep sources_used to sources you
actually relied on."""


def _build_query(req: PerformanceRequest) -> str:
    if req.bird_type == "broiler":
        base = "broiler weight gain growth rate 6 weeks market weight feed conversion FCR"
    else:
        base = "layer egg production hen-day percent peak lay layer mash calcium light hours"
    parts = [base, "Nigeria feed nutrition management"]
    for v in (req.feed, req.feeding_practice, req.challenges, req.age, req.notes):
        if v:
            parts.append(v)
    return " ".join(parts)


def _format_sources(passages: list[tuple[Chunk, float]]) -> str:
    if not passages:
        return "(no matching knowledge sources were found)"
    blocks = []
    for chunk, score in passages:
        blocks.append(f"[Source: {chunk.title} | ref: {chunk.ref} | relevance: {score:.2f}]\n{chunk.text}")
    return "\n\n".join(blocks)


def _format_request(req: PerformanceRequest) -> str:
    goal = "weight gain (reach a good market weight by ~6 weeks)" if req.bird_type == "broiler" else "egg production"
    lines = [
        f"Bird type: {req.bird_type} — goal: improve {goal}",
        f"Location: {req.state + ' State, Nigeria' if req.state else 'Nigeria (state unspecified)'}",
        f"Breed/strain: {req.breed or 'unspecified'}",
        f"Age: {req.age or 'unspecified'}",
        f"Flock size: {req.flock_size if req.flock_size is not None else 'unspecified'}",
        f"Current performance: {req.current_metric or 'unspecified'}",
        f"Farmer's target/goal: {req.target or 'unspecified'}",
        f"Feed currently used: {req.feed or 'unspecified'}",
        f"Feeding practice: {req.feeding_practice or 'unspecified'}",
    ]
    if req.bird_type == "layer":
        lines.append(f"Light hours/day: {req.lighting or 'unspecified'}")
    lines.append(f"Challenges reported: {req.challenges or 'none reported'}")
    if req.notes:
        lines.append(f"Other notes: {req.notes}")
    return "\n".join(lines)


def optimize(req: PerformanceRequest) -> PerformancePlan:
    # 1. Retrieve grounding passages (performance + management docs).
    store = get_store()
    passages = store.query(_build_query(req), config.TOP_K)

    # 2. Grounded reasoning -> structured plan.
    user_msg = (
        f"FLOCK & GOAL\n{_format_request(req)}\n\n"
        f"SOURCES (ground every number in these)\n{_format_sources(passages)}\n\n"
        "Produce the structured production plan now."
    )
    client = get_client()
    # Stream so adaptive thinking + structured output can't hit the request timeout.
    with client.messages.stream(
        model=config.MODEL,
        max_tokens=8000,
        thinking={"type": "adaptive"},
        system=_SYSTEM,
        messages=[{"role": "user", "content": user_msg}],
        output_config={"format": {"type": "json_schema", "schema": PERFORMANCE_JSON_SCHEMA}},
    ) as stream:
        resp = stream.get_final_message()
    raw = next((b.text for b in resp.content if b.type == "text"), "{}")
    data = json.loads(raw)

    data["disclaimer"] = DISCLAIMER
    return PerformancePlan(**data)
