"""Claude-powered business advice + weekly analysis.

Works without an API key — endpoints fall back to a clear message so the rest of
the app is fully usable offline. Set ANTHROPIC_API_KEY to enable AI insights.
"""
import os
import json

MODEL = os.environ.get("SALESPAL_MODEL", "claude-opus-4-8")


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


SYSTEM = (
    "You are a sharp, practical small-business advisor for a solo entrepreneur who "
    "sells physical products. You speak plainly and give specific, actionable advice "
    "tied to the numbers you are given — no generic filler, no fluff. Use the "
    "business's own currency symbol. Be encouraging but honest about problems."
)


def _summary_text(data: dict) -> str:
    return json.dumps(data, indent=2, default=str)


def advice(data: dict) -> dict:
    """General 'how do I increase sales/profit' advice from current metrics."""
    client = _client()
    if client is None:
        return {"ok": False, "text": _no_key_message()}

    prompt = (
        "Here is a snapshot of my business performance:\n\n"
        f"{_summary_text(data)}\n\n"
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


def _call(client, prompt: str) -> dict:
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
