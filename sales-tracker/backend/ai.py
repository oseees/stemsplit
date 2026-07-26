"""Claude-powered business advice + weekly analysis.

Works without an API key — endpoints fall back to a clear message so the rest of
the app is fully usable offline. Set ANTHROPIC_API_KEY to enable AI insights.
"""
import os
import json

MODEL = os.environ.get("SALESPAL_MODEL", "claude-opus-4-8")
# Small fast model for high-frequency parses (voice sale entry) — a fraction of
# the cost of the advice model, and structured outputs guarantee valid JSON.
FAST_MODEL = os.environ.get("SALESPAL_FAST_MODEL", "claude-haiku-4-5")


def _client():
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        from anthropic import Anthropic
        return Anthropic(api_key=key)
    except Exception:
        return None


def available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


# Hard global ceiling on paid AI calls per day — the backstop against a runaway
# API bill no matter which endpoint or account drives the spend. Set
# SALESPAL_AI_DAILY_CAP=0 to disable.
DAILY_CAP = int(os.environ.get("SALESPAL_AI_DAILY_CAP", "1500"))


def _over_cap() -> bool:
    """True once today's AI-call count hits DAILY_CAP. Counter is an approximate
    read-then-write in the settings KV — a few races at the boundary don't matter
    for a cost cap, and counting before the call (even one that then fails) only
    makes the ceiling conservative, which is the safe direction for a bill.
    ponytail: global daily counter; per-account quotas only if a tenant needs
    isolating."""
    if DAILY_CAP <= 0:
        return False
    import db
    from datetime import date
    key = f"ai_calls:{date.today().isoformat()}"
    with db.get_conn() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        n = int(row["value"]) if row and str(row["value"]).isdigit() else 0
        if n >= DAILY_CAP:
            return True
        conn.execute("INSERT OR REPLACE INTO settings(key,value) VALUES(?,?)", (key, str(n + 1)))
    return False


_CAP_MSG = "Daily AI limit reached — please try again tomorrow."


# Groq Whisper speech-to-text for voice sale entry. The browser Web Speech API is
# blocked inside the Android TWA wrapper and unsupported on iOS, so the app
# records audio and we transcribe it here. Free tier, OpenAI-compatible endpoint.
STT_MODEL = os.environ.get("SALESPAL_STT_MODEL", "whisper-large-v3-turbo")


def transcribe_available() -> bool:
    return bool(os.environ.get("GROQ_API_KEY"))


def transcribe_audio(audio_bytes: bytes, filename: str = "sale.webm", content_type: str = None) -> dict:
    """Spoken audio → text via Groq Whisper. The prompt biases recognition toward
    short sales entries (product names, quantities, customer, payment method)."""
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        return {"ok": False, "error": "Voice isn't set up on the server yet"}
    if _over_cap():
        return {"ok": False, "error": _CAP_MSG}
    try:
        import httpx  # ships with the anthropic SDK
        resp = httpx.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {key}"},
            files={"file": (filename or "sale.webm", audio_bytes, content_type or "audio/webm")},
            data={"model": STT_MODEL, "language": "en", "response_format": "json",
                  "prompt": "A short spoken sales entry: product names, quantities, "
                            "a customer name, and how they paid (cash, transfer or owing)."},
            timeout=60.0,
        )
        resp.raise_for_status()
        return {"ok": True, "text": (resp.json().get("text") or "").strip()}
    except Exception:
        return {"ok": False, "error": "Couldn't hear that clearly — try again"}


SYSTEM = (
    "You are a sharp, practical small-business advisor for a solo entrepreneur who "
    "sells physical products. You speak plainly and give specific, actionable advice "
    "tied to the numbers you are given — no generic filler, no fluff. Use the "
    "business's own currency symbol. Be encouraging but honest about problems."
)


def _summary_text(data: dict) -> str:
    return json.dumps(data, indent=2, default=str)


def advice(data: dict, question: str = "") -> dict:
    """General 'how do I increase sales/profit' advice from current metrics, or an
    answer to the owner's own question grounded in those same numbers."""
    client = _client()
    if client is None:
        return {"ok": False, "text": _no_key_message()}

    snapshot = f"Here is a snapshot of my business performance:\n\n{_summary_text(data)}\n\n"
    if question:
        prompt = (
            snapshot +
            "Answer this question of mine using those numbers:\n\n"
            # Delimited so a rambling question can't read as instructions to us.
            f"<question>\n{question}\n</question>\n\n"
            "Answer it directly in the first sentence, then back it up with my "
            "actual figures. If the numbers can't answer it, say so plainly and "
            "tell me what I'd need to record to find out. If it isn't about my "
            "business, say that's outside what you can help with here. Use "
            "markdown headers only if the answer needs them. Under 300 words."
        )
    else:
        prompt = (
            snapshot +
            "Give me advice in this structure (use markdown headers):\n"
            "## What's going well\n"
            "## What's hurting my profit\n"
            "## 3 things to do this week to increase sales\n"
            "## 2 things to do to increase profit margin\n"
            "Be specific and reference my actual numbers. Keep it under 350 words."
        )
    return _call(client, prompt)


def goal_tips(data: dict) -> dict:
    """Coaching focused on closing the gap to this month's profit goal."""
    client = _client()
    if client is None:
        return {"ok": False, "text": _no_key_message()}

    prompt = (
        "I set myself a monthly profit goal. Here is the goal and this month's "
        f"numbers so far:\n\n{_summary_text(data)}\n\n"
        "Coach me toward the goal (use markdown headers):\n"
        "## Where you stand\n"
        "1-2 sentences: profit so far vs the goal, the gap, and whether the pace "
        "(given the days left) is on track.\n"
        "## Fastest ways to close the gap\n"
        "3-4 concrete actions for THIS WEEK, each tied to my actual numbers — "
        "e.g. which product to push, a price/margin tweak, collecting what I'm owed.\n"
        "## One thing to stop doing\n"
        "The single biggest profit leak in these numbers.\n"
        "If the goal is already reached, congratulate me briefly and focus on "
        "finishing the month even stronger. Keep it under 300 words, be specific, "
        "and use my currency symbol."
    )
    return _call(client, prompt)


def price_advice(data: dict) -> dict:
    """Advice on a proposed price change: likely customer reaction + how to do it
    well, grounded in the break-even math and sales history we computed."""
    client = _client()
    if client is None:
        return {"ok": False, "text": _no_key_message()}

    prompt = (
        "I'm considering changing the price of one of my products. Here are the "
        "exact numbers (margins, break-even math, and the last 90 days of real "
        f"sales for this product):\n\n{_summary_text(data)}\n\n"
        "Advise me using this structure (markdown headers):\n"
        "## Verdict\n"
        "One clear sentence: do it, adjust it, or don't — and the single biggest reason.\n"
        "## How customers will likely react\n"
        "2-3 sentences grounded in proven pricing psychology — e.g. Weber's law "
        "(changes under ~10% are rarely noticed), loss aversion, reference prices. "
        "Consider the size of this change (change_pct) and what the product's sales "
        "volume says about demand.\n"
        "## The math you must beat\n"
        "Restate the break-even numbers in plain English (can_lose_sales_pct / "
        "need_more_sales_pct / breakeven_units_90d if present) and say whether "
        "that's realistic for this product. If below_cost is true, lead with that "
        "red flag.\n"
        "## How to do it right\n"
        "3 specific tactics from proven pricing technique, each named and applied "
        "to MY numbers — pick the most relevant of: charm pricing (ending in 90/99), "
        "price anchoring, staged increases, grandfathering regular customers, "
        "bundling, framing the change in value terms, decoy/tiering. Give the "
        "exact new price you'd charge (in my currency).\n"
        "Only use the numbers provided — never invent sales figures. Keep it under "
        "300 words."
    )
    return _call(client, prompt)


def weekly_report(data: dict) -> dict:
    """End-of-week analysis with commentary."""
    client = _client()
    if client is None:
        return {"ok": False, "text": _no_key_message()}

    prompt = (
        "Here is my business data for the past week (and the prior week for "
        f"comparison):\n\n{_summary_text(data)}\n\n"
        "Write my weekly report (use markdown headers):\n"
        "## This week at a glance\n"
        "A 2-3 sentence plain-English summary of sales, profit and expenses, and "
        "whether they went up or down vs last week.\n"
        "## Numbers that stand out\n"
        "## Watch outs\n"
        "## Focus for next week\n"
        "3 concrete priorities. Keep it under 350 words and reference the numbers."
    )
    return _call(client, prompt)


# What a spoken sale parses into. Sentinels instead of nullables keep the schema
# strict-friendly: product_id 0 = no catalog match, customer_name "" = none.
_SALE_SCHEMA = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "product_id": {"type": "integer", "description": "Matching catalog product id, or 0 if nothing in the catalog matches"},
                    "description": {"type": "string", "description": "Item name — the catalog name when matched, else as spoken"},
                    "qty": {"type": "number"},
                    "unit_price": {"type": "number", "description": "Price per unit in the business currency"},
                },
                "required": ["product_id", "description", "qty", "unit_price"],
                "additionalProperties": False,
            },
        },
        "customer_name": {"type": "string", "description": "Customer's name, or empty string if none was mentioned"},
        "payment": {"type": "string", "enum": ["cash", "transfer", "owing", "unknown"]},
    },
    "required": ["items", "customer_name", "payment"],
    "additionalProperties": False,
}


def parse_sale(transcript: str, products: list, customers: list, currency: str) -> dict:
    """Turn a spoken sale ('sold 3 crates of eggs to Mrs Okoro, she paid cash')
    into structured items grounded in THIS user's product catalog."""
    client = _client()
    if client is None:
        return {"ok": False, "text": "AI is not set up on this server."}
    if _over_cap():
        return {"ok": False, "text": _CAP_MSG}

    catalog = "\n".join(f"- id {p['id']}: {p['name']} @ {p['unit_price']}" for p in products) or "(no products yet)"
    names = ", ".join(customers) or "(none yet)"
    prompt = (
        "A Nigerian shop owner spoke a sale out loud. Turn it into structured data.\n\n"
        f"Their product catalog (id: name @ usual price, in {currency}):\n{catalog}\n\n"
        f"Their existing customers: {names}\n\n"
        f'They said: "{transcript}"\n\n'
        "Rules:\n"
        "- Match items to the catalog loosely (plurals, partial names, mishearings). "
        "Use the catalog id and its usual price UNLESS they said a different price for it.\n"
        "- If nothing in the catalog matches, use product_id 0, the item as spoken, and the price they said (0 if none).\n"
        "- Quantity defaults to 1. Interpret amounts naturally ('5k' = 5000, 'two fifty naira' = 250).\n"
        "- Match the customer to an existing name when it's clearly the same person; otherwise use it as spoken; empty string if no customer mentioned.\n"
        "- payment: 'cash' or 'transfer' if they said the customer paid that way, 'owing' if the customer owes / will pay later, else 'unknown'.\n"
        "- Only include items they actually mentioned — never invent."
    )
    # Structured output via a forced tool — the model must call record_sale with
    # args matching _SALE_SCHEMA, so we get guaranteed-shape JSON back. (Tool use is
    # supported by the pinned SDK; the newer output_config/json_schema param is not.)
    try:
        resp = client.messages.create(
            model=FAST_MODEL,
            max_tokens=1000,
            tools=[{
                "name": "record_sale",
                "description": "Record the structured sale extracted from what the shop owner said.",
                "input_schema": _SALE_SCHEMA,
            }],
            tool_choice={"type": "tool", "name": "record_sale"},
            messages=[{"role": "user", "content": prompt}],
        )
        for b in resp.content:
            if getattr(b, "type", "") == "tool_use":
                return {"ok": True, "sale": b.input}
        return {"ok": False, "text": "Couldn't understand that — no structured result."}
    except Exception as e:
        return {"ok": False, "text": f"Couldn't understand that: {e}"}


def _call(client, prompt: str) -> dict:
    if _over_cap():
        return {"ok": False, "text": _CAP_MSG}
    try:
        resp = client.messages.create(
            model=MODEL,
            max_tokens=1200,
            system=SYSTEM,
            messages=[{"role": "user", "content": prompt}],
        )
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        return {"ok": True, "text": text.strip()}
    except Exception as e:
        return {"ok": False, "text": f"AI request failed: {e}"}


def _no_key_message() -> str:
    return (
        "**AI insights are turned off.**\n\n"
        "To enable personalised advice and weekly analysis from Claude, add your "
        "Anthropic API key to `backend/.env`:\n\n"
        "```\nANTHROPIC_API_KEY=sk-ant-...\n```\n\n"
        "Then restart the app. Everything else (sales, invoices, expenses, profit "
        "tracking) works without it."
    )
