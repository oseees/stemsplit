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
