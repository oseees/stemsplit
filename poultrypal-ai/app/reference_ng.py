"""Nigeria-specific reference data: a banned-drug safety guard and a curated
veterinary-laboratory directory.

Two design choices keep this safe and honest:

1. BANNED-DRUG GUARD — even though drugs are surfaced only from the knowledge
   sources, we add a hard, code-level filter so a drug NAFDAC has banned for
   food-producing animals can never reach the farmer, regardless of what a
   source or the model says. This is defence-in-depth on top of the prompt rule.

2. LAB DIRECTORY IS CODE, NOT LLM — lab names, addresses and phone numbers are
   real-world facts that the model must never invent. They are stored here as a
   curated, source-checked list and attached to the result deterministically.
   Every contact is flagged "verify current contact" because such details change.

Sources used to compile this (June 2026):
  * NVRI Vom official contact page — https://nvri.gov.ng/contact
  * NVRI FAQs (how to submit poultry) — https://nvri.gov.ng/index.php/faqs
  * NAFDAC banned veterinary drugs — https://nafdac.gov.ng/veterinary/list-of-banned-veterinary-drugs/
"""
from __future__ import annotations

# --- NAFDAC: veterinary drugs banned in food-producing animals in Nigeria ---
# Lower-cased name fragments. A drug is blocked if any fragment is a substring
# of the drug name (so "furazolidone", "nitrofuran", "metronidazole" etc. match
# brand/spelling variants). Source: NAFDAC list (June 2026).
NAFDAC_BANNED: tuple[str, ...] = (
    "chloramphenicol",
    "malachite green",
    "carbadox",
    "furazolidone",
    "nitrofural",
    "nitrofuran",  # covers nitrofurantoin, furaltadone, nitrofuran compounds
    "furaltadone",
    "nitrofurantoin",
    "chlorpromazine",
    "stilbene",  # covers stilbenes / diethylstilbestrol
    "diethylstilbestrol",
    "olaquindox",
    "dimetridazole",
    "ipronidazole",
    "metronidazole",
    "ronidazole",
)


def is_banned(drug_name: str) -> bool:
    """True if the drug is on the NAFDAC banned list for food animals."""
    n = (drug_name or "").lower()
    return any(b in n for b in NAFDAC_BANNED)


# --- Nigerian states -> geopolitical zone (for nearest-lab ranking) ---
STATE_TO_ZONE: dict[str, str] = {
    # North-Central
    "Benue": "North-Central", "Kogi": "North-Central", "Kwara": "North-Central",
    "Nasarawa": "North-Central", "Niger": "North-Central", "Plateau": "North-Central",
    "FCT - Abuja": "North-Central", "FCT": "North-Central", "Abuja": "North-Central",
    # North-East
    "Adamawa": "North-East", "Bauchi": "North-East", "Borno": "North-East",
    "Gombe": "North-East", "Taraba": "North-East", "Yobe": "North-East",
    # North-West
    "Jigawa": "North-West", "Kaduna": "North-West", "Kano": "North-West",
    "Katsina": "North-West", "Kebbi": "North-West", "Sokoto": "North-West",
    "Zamfara": "North-West",
    # South-East
    "Abia": "South-East", "Anambra": "South-East", "Ebonyi": "South-East",
    "Enugu": "South-East", "Imo": "South-East",
    # South-South
    "Akwa Ibom": "South-South", "Bayelsa": "South-South", "Cross River": "South-South",
    "Delta": "South-South", "Edo": "South-South", "Rivers": "South-South",
    # South-West
    "Ekiti": "South-West", "Lagos": "South-West", "Ogun": "South-West",
    "Ondo": "South-West", "Osun": "South-West", "Oyo": "South-West",
}


# Canonical state names, matching the form dropdown exactly (for voice intake).
NIGERIA_STATES: list[str] = [
    "Abia", "Adamawa", "Akwa Ibom", "Anambra", "Bauchi", "Bayelsa", "Benue", "Borno",
    "Cross River", "Delta", "Ebonyi", "Edo", "Ekiti", "Enugu", "FCT - Abuja", "Gombe",
    "Imo", "Jigawa", "Kaduna", "Kano", "Katsina", "Kebbi", "Kogi", "Kwara", "Lagos",
    "Nasarawa", "Niger", "Ogun", "Ondo", "Osun", "Oyo", "Plateau", "Rivers", "Sokoto",
    "Taraba", "Yobe", "Zamfara",
]


def zone_for_state(state: str | None) -> str | None:
    """Map a Nigerian state name to its geopolitical zone (case-insensitive)."""
    if not state:
        return None
    s = state.strip()
    if s in STATE_TO_ZONE:
        return STATE_TO_ZONE[s]
    low = {k.lower(): v for k, v in STATE_TO_ZONE.items()}
    return low.get(s.lower())


# --- Curated Nigerian veterinary diagnostic laboratory directory ---
# Each entry: where to go and what they confirm. Contacts are included ONLY where
# taken from an official source, and are always to be re-verified before relying.

# The single always-valid route: every Nigerian state runs government veterinary
# services. This needs no phone number to be useful and is shown for every case.
GOVERNMENT_VET_ROUTE: dict = {
    "name": "Your State Veterinary Services / nearest Government Veterinary Clinic",
    "location": "Every state (via the State Ministry of Agriculture, Dept. of Veterinary Services)",
    "services": "Clinical exam, post-mortem, sample collection, onward referral, and outbreak reporting. First port of call and the official channel for notifiable diseases.",
    "contact": "Ask at your Local Government agriculture office or State Ministry of Agriculture for the nearest government veterinary clinic and the state veterinary officer's line.",
    "note": "Always available nationwide. Notifiable diseases (avian influenza, Newcastle) MUST be reported here promptly.",
}

# National reference lab + verified contact (NVRI Vom official site, June 2026).
NVRI_VOM: dict = {
    "name": "National Veterinary Research Institute (NVRI), Vom — Central Diagnostic Laboratory",
    "location": "PMB 01, Vom, Plateau State (plus a network of 23 outstation laboratories nationwide)",
    "services": "Post-mortem, bacteriology/culture & sensitivity, parasitology, serology and PCR (incl. avian influenza & Newcastle confirmation). National reference lab.",
    "contact": "Tel 09058777764, 08111118533 · enquiries@nvri.gov.ng · nvri.gov.ng (use the Contact page to find your nearest outstation)",
    "note": "Bring fresh carcasses AND at least two live, sick (untreated) birds; transport in cold storage if travelling far. Verify current contact before going.",
}

# Selected university veterinary teaching hospitals with avian/poultry clinics.
# Listed by institution + location; contact via the university — re-verify locally.
UNIVERSITY_VTHS: list[dict] = [
    {
        "name": "Ahmadu Bello University (ABU) Veterinary Teaching Hospital — Avian Clinic",
        "zone": "North-West",
        "location": "Zaria, Kaduna State (North-West)",
        "services": "Poultry clinical diagnosis, post-mortem, and laboratory investigation (incl. Newcastle / Gumboro).",
        "contact": "Via ABU Faculty of Veterinary Medicine, Zaria — confirm the avian clinic line locally.",
        "note": "Verify current contact before going.",
    },
    {
        "name": "University of Ibadan Veterinary Teaching Hospital",
        "zone": "South-West",
        "location": "Ibadan, Oyo State (South-West)  ·  NVRI also runs a Diagnostic & Epidemiology Lab at the Mokola Vet Hospital Complex, Ibadan",
        "services": "Poultry diagnosis, post-mortem and laboratory testing.",
        "contact": "Via University of Ibadan Faculty of Veterinary Medicine — confirm locally.",
        "note": "Verify current contact before going.",
    },
    {
        "name": "University of Maiduguri Veterinary Teaching Hospital (UMVTH)",
        "zone": "North-East",
        "location": "Maiduguri, Borno State (North-East)",
        "services": "Poultry clinical and laboratory diagnosis, post-mortem.",
        "contact": "Via University of Maiduguri Faculty of Veterinary Medicine — confirm locally.",
        "note": "Verify current contact before going.",
    },
    {
        "name": "University of Nigeria, Nsukka (UNN) Veterinary Teaching Hospital",
        "zone": "South-East",
        "location": "Nsukka, Enugu State (South-East)",
        "services": "Poultry diagnosis, post-mortem and laboratory investigation.",
        "contact": "Via UNN Faculty of Veterinary Medicine, Nsukka — confirm locally.",
        "note": "Verify current contact before going.",
    },
    {
        "name": "Usmanu Danfodiyo University Veterinary Teaching Hospital",
        "zone": "North-West",
        "location": "Sokoto, Sokoto State (North-West)",
        "services": "Poultry diagnosis, post-mortem and laboratory testing.",
        "contact": "Via UDU Faculty of Veterinary Medicine, Sokoto — confirm locally.",
        "note": "Verify current contact before going.",
    },
    {
        "name": "Federal University of Agriculture Abeokuta (FUNAAB) — Veterinary Teaching Hospital",
        "zone": "South-West",
        "location": "Abeokuta, Ogun State (South-West)",
        "services": "Poultry clinical and laboratory diagnosis.",
        "contact": "Via FUNAAB College of Veterinary Medicine, Abeokuta — confirm locally.",
        "note": "Verify current contact before going.",
    },
]


def lab_directory(state: str | None = None) -> list[dict]:
    """Labs to contact. Returned for every diagnosis so the farmer always has
    somewhere to get a confirmatory test.

    Without a state: government route, national reference lab, then the teaching
    hospitals. With a state: ranked by proximity — the farmer's own-state
    government route first, then veterinary teaching hospitals in the SAME
    geopolitical zone (nearest specialists), then NVRI Vom (national reference,
    reachable via its 23 outstations), then the remaining teaching hospitals.
    The internal `zone` key is stripped from the returned entries."""
    zone = zone_for_state(state)

    # Government route — always first; personalise to the farmer's state if known.
    govt = dict(GOVERNMENT_VET_ROUTE)
    if state:
        govt["location"] = (
            f"{state} State (via the State Ministry of Agriculture, Dept. of Veterinary Services)"
        )

    # NVRI national reference — add a nearest-outstation hint for the zone if known.
    nvri = dict(NVRI_VOM)
    if zone:
        nvri["note"] = (
            "Bring fresh carcasses AND at least two live, sick (untreated) birds; transport in "
            f"cold storage if travelling far. Ask for the NVRI outstation serving the {zone} zone. "
            "Verify current contact before going."
        )

    if zone:
        same_zone = [v for v in UNIVERSITY_VTHS if v.get("zone") == zone]
        other_vths = [v for v in UNIVERSITY_VTHS if v.get("zone") != zone]
        ordered = [govt, *same_zone, nvri, *other_vths]
    else:
        ordered = [govt, nvri, *UNIVERSITY_VTHS]

    return [{k: val for k, val in lab.items() if k != "zone"} for lab in ordered]
