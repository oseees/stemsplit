"""Lightweight case + outcome store (stdlib sqlite3 — no new deps, 3.14-safe).

Every diagnosis is saved with a `case_id`. Farmers (or their vet) can later report
what was actually confirmed and whether the birds recovered. This does three things:
  1. Lets us MEASURE accuracy (predicted top disease vs. vet-confirmed).
  2. Builds an outcome dataset — the data moat that improves the product over time.
  3. Enables follow-up ("did it recover?").

Stored locally in data/cases.db (gitignored). Keep PII out — only the flock/clinical
fields the farmer entered are saved.
"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone

from . import config

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cases (
    case_id        TEXT PRIMARY KEY,
    created_at     TEXT NOT NULL,
    species        TEXT,
    state          TEXT,
    top_disease    TEXT,
    top_confidence INTEGER,
    payload        TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id           TEXT NOT NULL,
    created_at        TEXT NOT NULL,
    confirmed_disease TEXT,
    treatment_used    TEXT,
    outcome           TEXT,
    helpful           INTEGER,
    notes             TEXT
);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _conn() -> sqlite3.Connection:
    config.CASES_DB.parent.mkdir(parents=True, exist_ok=True)
    c = sqlite3.connect(config.CASES_DB)
    c.row_factory = sqlite3.Row
    return c


def init_db() -> None:
    with _conn() as c:
        c.executescript(_SCHEMA)


def save_case(case_id: str, farm: dict, result: dict) -> None:
    diseases = result.get("likely_diseases") or []
    top = diseases[0] if diseases else {}
    with _conn() as c:
        c.execute(
            "INSERT OR REPLACE INTO cases "
            "(case_id, created_at, species, state, top_disease, top_confidence, payload) "
            "VALUES (?,?,?,?,?,?,?)",
            (
                case_id,
                _now(),
                farm.get("species"),
                farm.get("state"),
                top.get("name"),
                top.get("confidence_percent"),
                json.dumps({"farm": farm, "result": result}),
            ),
        )


def save_feedback(
    case_id: str,
    confirmed_disease: str = "",
    treatment_used: str = "",
    outcome: str = "",
    helpful: bool | None = None,
    notes: str = "",
) -> None:
    with _conn() as c:
        c.execute(
            "INSERT INTO feedback "
            "(case_id, created_at, confirmed_disease, treatment_used, outcome, helpful, notes) "
            "VALUES (?,?,?,?,?,?,?)",
            (
                case_id,
                _now(),
                confirmed_disease.strip(),
                treatment_used.strip(),
                outcome.strip(),
                None if helpful is None else int(helpful),
                notes.strip(),
            ),
        )


def stats() -> dict:
    with _conn() as c:
        cases = c.execute("SELECT COUNT(*) n FROM cases").fetchone()["n"]
        fb = c.execute("SELECT COUNT(*) n FROM feedback").fetchone()["n"]
        outcomes = {
            r["outcome"]: r["n"]
            for r in c.execute(
                "SELECT outcome, COUNT(*) n FROM feedback WHERE outcome<>'' GROUP BY outcome"
            ).fetchall()
        }
        helpful_yes = c.execute("SELECT COUNT(*) n FROM feedback WHERE helpful=1").fetchone()["n"]
        helpful_total = c.execute("SELECT COUNT(*) n FROM feedback WHERE helpful IS NOT NULL").fetchone()["n"]
        # Top-1 accuracy: feedback rows where the vet-confirmed disease matches our top suspect.
        rows = c.execute(
            "SELECT f.confirmed_disease cd, c.top_disease td FROM feedback f "
            "JOIN cases c ON c.case_id=f.case_id WHERE f.confirmed_disease<>''"
        ).fetchall()
        matched = sum(1 for r in rows if _name_match(r["cd"], r["td"]))
        confirmed_n = len(rows)
    return {
        "cases": cases,
        "feedback": fb,
        "outcomes": outcomes,
        "helpful_rate": round(helpful_yes / helpful_total, 2) if helpful_total else None,
        "top1_accuracy": round(matched / confirmed_n, 2) if confirmed_n else None,
        "confirmed_samples": confirmed_n,
    }


def _name_match(a: str, b: str) -> bool:
    """Loose match between a confirmed name and our predicted name."""
    if not a or not b:
        return False
    a, b = a.lower(), b.lower()
    if a in b or b in a:
        return True
    common = set(a.replace("(", " ").replace(")", " ").split()) & set(b.replace("(", " ").replace(")", " ").split())
    return any(len(w) > 3 for w in common)
