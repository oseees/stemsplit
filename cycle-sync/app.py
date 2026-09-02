# Attune — plan life around your cycle. Phase is pure date math from your last period +
# cycle length; recommendations are curated per phase. No ML, no LLM, no wearables.
# Multi-tenant: cookie sessions, pbkdf2 passwords, every row owned by a user.
# One file: FastAPI + SQLite + inline HTML. Run: ../backend/venv/bin/uvicorn app:app --port 8016
import hashlib
import hmac
import os
import secrets
import sqlite3
from contextlib import closing
from datetime import date, datetime, timezone, timedelta
from typing import Optional

from fastapi import Cookie, Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

DB = os.environ.get("ATTUNE_DB") or __file__.rsplit("/", 1)[0] + "/attune.db"
os.makedirs(os.path.dirname(DB), exist_ok=True)

# Luteal phase length is biologically near-constant (~14 days); ovulation is counted back
# from the *next* period, which is what makes it adapt to any cycle length.
LUTEAL_LEN = 14


def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


with closing(db()) as c:
    c.executescript("""
    CREATE TABLE IF NOT EXISTS users(
        id INTEGER PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        pw TEXT NOT NULL,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tokens(
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS profile(
        user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        last_period TEXT NOT NULL,         -- YYYY-MM-DD, start of most recent period
        cycle_len INTEGER NOT NULL DEFAULT 28 CHECK(cycle_len BETWEEN 20 AND 45),
        period_len INTEGER NOT NULL DEFAULT 5 CHECK(period_len BETWEEN 1 AND 10)
    );
    CREATE TABLE IF NOT EXISTS logs(
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        day TEXT NOT NULL,                 -- YYYY-MM-DD
        energy INTEGER,                    -- 1..5
        mood TEXT,                         -- one of MOODS keys
        flow TEXT,                         -- none|spotting|light|medium|heavy
        symptoms TEXT,                     -- comma-joined
        notes TEXT,
        PRIMARY KEY(user_id, day)
    );
    """)
    c.commit()

app = FastAPI(title="Attune")


def now():
    return datetime.now(timezone.utc).isoformat()


# --- auth (same shape as the other one-file apps) ---------------------------

class Cred(BaseModel):
    email: str = Field(min_length=5, max_length=200, pattern=r"^\S+@\S+\.\S+$")
    password: str = Field(min_length=6, max_length=200)


PBKDF2_ITERS = 600_000  # ponytail: pbkdf2 not scrypt — LibreSSL python here lacks scrypt


def hash_pw(pw: str) -> str:
    salt = os.urandom(16)
    h = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, PBKDF2_ITERS)
    return f"{PBKDF2_ITERS}:{salt.hex()}:{h.hex()}"


def check_pw(pw: str, stored: str) -> bool:
    iters, salt, h = stored.split(":")
    got = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), int(iters)).hex()
    return hmac.compare_digest(got, h)


def issue_token(c, request: Request, response: Response, user_id: int):
    t = secrets.token_hex(32)
    c.execute("INSERT INTO tokens(token,user_id,created_at) VALUES(?,?,?)", (t, user_id, now()))
    response.set_cookie("at", t, httponly=True, samesite="lax", max_age=180 * 24 * 3600,
                        secure=request.url.scheme == "https")


def uid(at: Optional[str] = Cookie(default=None)) -> int:
    if at:
        with closing(db()) as c:
            r = c.execute("SELECT user_id FROM tokens WHERE token=?", (at,)).fetchone()
        if r:
            return r["user_id"]
    raise HTTPException(401, "sign in")


@app.post("/api/signup")
def signup(cred: Cred, request: Request, response: Response):
    with closing(db()) as c:
        try:
            cur = c.execute("INSERT INTO users(email,pw,created_at) VALUES(?,?,?)",
                            (cred.email.strip().lower(), hash_pw(cred.password), now()))
        except sqlite3.IntegrityError:
            raise HTTPException(400, "That email already has an account — sign in instead.")
        issue_token(c, request, response, cur.lastrowid)
        c.commit()
    return {"ok": True}


@app.post("/api/login")
def login(cred: Cred, request: Request, response: Response):
    with closing(db()) as c:
        u = c.execute("SELECT * FROM users WHERE email=?", (cred.email.strip(),)).fetchone()
        if not u or not check_pw(cred.password, u["pw"]):
            raise HTTPException(400, "Wrong email or password.")
        issue_token(c, request, response, u["id"])
        c.commit()
    return {"ok": True}


@app.post("/api/logout")
def logout(response: Response, at: Optional[str] = Cookie(default=None)):
    if at:
        with closing(db()) as c:
            c.execute("DELETE FROM tokens WHERE token=?", (at,))
            c.commit()
    response.delete_cookie("at")
    return {"ok": True}


# --- cycle math -------------------------------------------------------------

MOODS = {"great": "Great", "good": "Good", "meh": "Okay", "low": "Low", "rough": "Rough"}
FLOWS = ["none", "spotting", "light", "medium", "heavy"]
SYMPTOMS = ["cramps", "headache", "bloating", "tender breasts", "fatigue",
            "acne", "cravings", "anxious", "low mood", "insomnia", "nausea"]

# Curated per phase. Grounded in the hormone profile of each phase; not medical advice.
REC = {
    "Menstrual": {
        "color": "men", "season": "inner winter",
        "feel": "Hormones and energy bottom out. Rest here is maintenance, not laziness.",
        "cards": [
            {"icon": "move", "label": "Move", "tip": "Go gentle — walking, restorative yoga, stretching, mobility. Save intensity for next week."},
            {"icon": "eat", "label": "Eat", "tip": "Replenish iron (leafy greens, red meat, lentils) and magnesium. Warm cooked food over raw; hydrate."},
            {"icon": "work", "label": "Work", "tip": "Reflect, review, plan. Good for analysis and wrapping up — a poor week to launch something big."},
            {"icon": "people", "label": "People", "tip": "Protect quiet. Decline what you can, keep close company only, journal. Boundaries are allowed."},
        ],
    },
    "Follicular": {
        "color": "fol", "season": "inner spring",
        "feel": "Estrogen rises and energy climbs — motivation, creativity and openness build daily.",
        "cards": [
            {"icon": "move", "label": "Move", "tip": "Build intensity: cardio, strength, try a new class. Your body recovers well and takes on challenge now."},
            {"icon": "eat", "label": "Eat", "tip": "Light and fresh — lean protein, leafy greens, fermented foods. Metabolism is ramping; feed it."},
            {"icon": "work", "label": "Work", "tip": "Start things. Brainstorm, learn, take on new projects and hard problems — your brain is primed to begin."},
            {"icon": "people", "label": "People", "tip": "Reach out and network. A strong week to make new connections and pitch ideas."},
        ],
    },
    "Ovulatory": {
        "color": "ovu", "season": "inner summer",
        "feel": "Estrogen and testosterone peak — your most verbal, magnetic and energetic days.",
        "cards": [
            {"icon": "move", "label": "Move", "tip": "Peak-performance window: go hard — HIIT, heavy lifts, competition, group classes."},
            {"icon": "eat", "label": "Eat", "tip": "Load fibre and antioxidants (colourful veg, berries) to support hormone clearance; anti-inflammatory foods."},
            {"icon": "work", "label": "Work", "tip": "Lead the room: presentations, negotiations, interviews, hard conversations, collaboration all land best now."},
            {"icon": "people", "label": "People", "tip": "Your peak social window — events, dates, big meetings, public speaking. Say yes."},
        ],
    },
    "Luteal": {
        "color": "lut", "season": "inner autumn",
        "feel": "Progesterone rises then falls; energy tapers and PMS may surface late. Turn inward and finish.",
        "cards": [
            {"icon": "move", "label": "Move", "tip": "Strength and pilates early, then ease into walks and yoga. Don't force intensity that isn't there."},
            {"icon": "eat", "label": "Eat", "tip": "Steady blood sugar: complex carbs, magnesium, B vitamins. Ease off sugar, salt and caffeine to soften PMS."},
            {"icon": "work", "label": "Work", "tip": "Detail and finishing mode — edit, organise, tie off loose ends. You catch errors well; avoid starting new."},
            {"icon": "people", "label": "People", "tip": "Wind down. Smaller gatherings, home comforts, firm boundaries. It's fine to cancel."},
        ],
    },
}


def cycle_info(last_period: str, cycle_len: int, period_len: int, target: str) -> dict:
    """Everything the UI needs about `target` date given the cycle. Pure arithmetic."""
    d0 = date.fromisoformat(last_period)
    t = date.fromisoformat(target)
    delta = (t - d0).days
    cyc = max(0, delta // cycle_len)            # whole cycles since the recorded start
    cycle_start = d0 + timedelta(days=cyc * cycle_len)
    next_period = cycle_start + timedelta(days=cycle_len)
    day = delta % cycle_len + 1                 # 1-based day within current cycle

    ovu = max(period_len + 1, cycle_len - LUTEAL_LEN)   # ovulation ~14 days before next period
    if day <= period_len:
        phase = "Menstrual"
    elif day < ovu - 1:
        phase = "Follicular"
    elif day <= ovu + 1:
        phase = "Ovulatory"
    else:
        phase = "Luteal"

    def dt(cycle_day):  # date of a given cycle day, ISO
        return (cycle_start + timedelta(days=cycle_day - 1)).isoformat()

    # timeline segments (clamped so short cycles don't invert follicular)
    fol_end = max(period_len, ovu - 2)
    segs = [
        {"phase": "Menstrual", "a": 1, "b": period_len},
        {"phase": "Follicular", "a": period_len + 1, "b": fol_end},
        {"phase": "Ovulatory", "a": ovu - 1, "b": ovu + 1},
        {"phase": "Luteal", "a": ovu + 2, "b": cycle_len},
    ]
    segs = [s for s in segs if s["b"] >= s["a"]]

    return {
        "day": day, "phase": phase, "season": REC[phase]["season"],
        "cycle_len": cycle_len, "period_len": period_len,
        "cycle_start": cycle_start.isoformat(),
        "next_period": next_period.isoformat(),
        "days_to_next": (next_period - t).days,
        "ovulation_date": dt(ovu),
        "fertile_start": dt(max(1, ovu - 5)), "fertile_end": dt(ovu + 1),
        "segments": [{"phase": s["phase"], "frac": (s["b"] - s["a"] + 1) / cycle_len} for s in segs],
        "marker": (day - 0.5) / cycle_len,
        "upcoming": [(next_period + timedelta(days=i * cycle_len)).isoformat() for i in range(3)],
        "rec": REC[phase],
    }


# --- state / logs -----------------------------------------------------------

class Profile(BaseModel):
    last_period: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    cycle_len: int = Field(default=28, ge=20, le=45)
    period_len: int = Field(default=5, ge=1, le=10)


class Log(BaseModel):
    day: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    energy: Optional[int] = Field(default=None, ge=1, le=5)
    mood: Optional[str] = None
    flow: Optional[str] = None
    symptoms: list[str] = Field(default_factory=list)
    notes: Optional[str] = Field(default=None, max_length=500)


def get_profile(c, user):
    return c.execute("SELECT * FROM profile WHERE user_id=?", (user,)).fetchone()


@app.get("/api/state")
def state(date: str, user: int = Depends(uid)):
    with closing(db()) as c:
        p = get_profile(c, user)
        if not p:
            return {"profile": None}
        info = cycle_info(p["last_period"], p["cycle_len"], p["period_len"], date)
        lg = c.execute("SELECT * FROM logs WHERE user_id=? AND day=?", (user, date)).fetchone()
        log = None
        if lg:
            log = dict(lg)
            log["symptoms"] = lg["symptoms"].split(",") if lg["symptoms"] else []
        return {
            "profile": {"last_period": p["last_period"], "cycle_len": p["cycle_len"],
                        "period_len": p["period_len"]},
            "date": date, "info": info, "log": log,
            "moods": MOODS, "flows": FLOWS, "symptoms": SYMPTOMS,
        }


@app.put("/api/profile")
def put_profile(p: Profile, user: int = Depends(uid)):
    if date.fromisoformat(p.last_period) > date.today() + timedelta(days=1):
        raise HTTPException(400, "Last period can't be in the future.")
    with closing(db()) as c:
        c.execute("""INSERT INTO profile(user_id,last_period,cycle_len,period_len) VALUES(?,?,?,?)
                     ON CONFLICT(user_id) DO UPDATE SET
                       last_period=excluded.last_period, cycle_len=excluded.cycle_len,
                       period_len=excluded.period_len""",
                  (user, p.last_period, p.cycle_len, p.period_len))
        c.commit()
    return {"ok": True}


@app.post("/api/period")
def period_started(day: str, user: int = Depends(uid)):
    """The calibration knob: real cycles drift, so anchoring to an actual period start
    keeps every prediction honest."""
    if not day or len(day) != 10:
        raise HTTPException(400, "bad date")
    with closing(db()) as c:
        if not get_profile(c, user):
            raise HTTPException(400, "set up your cycle first")
        c.execute("UPDATE profile SET last_period=? WHERE user_id=?", (day, user))
        c.execute("""INSERT INTO logs(user_id,day,flow) VALUES(?,?,'medium')
                     ON CONFLICT(user_id,day) DO UPDATE SET flow='medium'""", (user, day))
        c.commit()
    return {"ok": True}


@app.put("/api/log")
def put_log(l: Log, user: int = Depends(uid)):
    if l.mood and l.mood not in MOODS:
        raise HTTPException(400, "bad mood")
    if l.flow and l.flow not in FLOWS:
        raise HTTPException(400, "bad flow")
    syms = ",".join(s for s in l.symptoms if s in SYMPTOMS)
    with closing(db()) as c:
        c.execute("""INSERT INTO logs(user_id,day,energy,mood,flow,symptoms,notes)
                     VALUES(?,?,?,?,?,?,?)
                     ON CONFLICT(user_id,day) DO UPDATE SET
                       energy=excluded.energy, mood=excluded.mood, flow=excluded.flow,
                       symptoms=excluded.symptoms, notes=excluded.notes""",
                  (user, l.day, l.energy, l.mood, l.flow, syms, (l.notes or "").strip() or None))
        c.commit()
    return {"ok": True}


@app.get("/api/logs")
def list_logs(user: int = Depends(uid)):
    with closing(db()) as c:
        p = get_profile(c, user)
        rows = c.execute("SELECT * FROM logs WHERE user_id=? ORDER BY day DESC LIMIT 60",
                         (user,)).fetchall()
        out = []
        for r in rows:
            d = dict(r)
            d["symptoms"] = r["symptoms"].split(",") if r["symptoms"] else []
            if p:
                d["phase"] = cycle_info(p["last_period"], p["cycle_len"], p["period_len"], r["day"])["phase"]
            out.append(d)
        return {"logs": out}


MIN_INSIGHT_DAYS = 5  # below this, patterns are noise, not signal


def compute_insights(last_period, cycle_len, period_len, logs):
    """Correlate a user's own logs with their cycle phase. Pure aggregation, no ML.
    logs: list of {"day","energy","symptoms":[...]}."""
    days = len(logs)
    if days < MIN_INSIGHT_DAYS:
        return {"insights": [], "days": days, "need": MIN_INSIGHT_DAYS}
    by_phase = {}
    for r in logs:
        ph = cycle_info(last_period, cycle_len, period_len, r["day"])["phase"]
        by_phase.setdefault(ph, []).append(r)
    out = []
    # energy: highest vs lowest phase (need >=2 readings in a phase to trust the average)
    avg = {ph: sum(e) / len(e) for ph, rs in by_phase.items()
           if (e := [r["energy"] for r in rs if r.get("energy")]) and len(e) >= 2}
    if len(avg) >= 2:
        hi, lo = max(avg, key=avg.get), min(avg, key=avg.get)
        if avg[hi] - avg[lo] >= 0.5:
            out.append(f"Your energy runs highest in your {hi} phase and lowest in your {lo} phase.")
    # symptoms: which phase each one concentrates in
    phase_days = {ph: len(rs) for ph, rs in by_phase.items()}
    sym = {}
    for ph, rs in by_phase.items():
        for r in rs:
            for s in r.get("symptoms") or []:
                sym[(s, ph)] = sym.get((s, ph), 0) + 1
    for (s, ph), n in sorted(sym.items(), key=lambda kv: -kv[1])[:3]:
        if n >= 2:
            out.append(f"{s.capitalize()} shows up most in your {ph.lower()} phase — "
                       f"{n} of {phase_days[ph]} logged {ph.lower()} days.")
    if not out:
        out.append("Keep logging — a few more days and clearer patterns will surface.")
    return {"insights": out[:4], "days": days}


@app.get("/api/insights")
def insights(user: int = Depends(uid)):
    with closing(db()) as c:
        p = get_profile(c, user)
        rows = c.execute("SELECT * FROM logs WHERE user_id=? ORDER BY day DESC LIMIT 180",
                         (user,)).fetchall()
    if not p:
        return {"insights": [], "days": 0, "need": MIN_INSIGHT_DAYS}
    logs = [{"day": r["day"], "energy": r["energy"],
             "symptoms": r["symptoms"].split(",") if r["symptoms"] else []} for r in rows]
    return compute_insights(p["last_period"], p["cycle_len"], p["period_len"], logs)


@app.api_route("/health", methods=["GET", "HEAD"])
def health():  # GET+HEAD so any uptime-monitor check type gets 200, not a 405
    return {"ok": True}


@app.get("/api/export")
def export_data(user: int = Depends(uid)):
    """Everything Attune holds about this account, as JSON (GDPR data portability)."""
    with closing(db()) as c:
        u = c.execute("SELECT email, created_at FROM users WHERE id=?", (user,)).fetchone()
        p = get_profile(c, user)
        rows = c.execute("SELECT day, energy, mood, flow, symptoms, notes FROM logs "
                         "WHERE user_id=? ORDER BY day", (user,)).fetchall()
    return {
        "account": {"email": u["email"], "created_at": u["created_at"]},
        "cycle": ({"last_period": p["last_period"], "cycle_len": p["cycle_len"],
                   "period_len": p["period_len"]} if p else None),
        "logs": [{"day": r["day"], "energy": r["energy"], "mood": r["mood"], "flow": r["flow"],
                  "symptoms": r["symptoms"].split(",") if r["symptoms"] else [],
                  "notes": r["notes"]} for r in rows],
        "exported_at": now(),
    }


@app.delete("/api/account")
def delete_account(response: Response, user: int = Depends(uid)):
    """Erase the account and everything tied to it. FK ON DELETE CASCADE + foreign_keys=ON
    means deleting the user row also removes their profile, logs, and sessions."""
    with closing(db()) as c:
        c.execute("DELETE FROM users WHERE id=?", (user,))
        c.commit()
    response.delete_cookie("at")
    return {"ok": True}


PAGE = r"""
<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name=theme-color content="#f5f2ef" media="(prefers-color-scheme: light)">
<meta name=theme-color content="#14100f" media="(prefers-color-scheme: dark)">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='11' fill='none' stroke='%239c3b60' stroke-width='4'/%3E%3Ccircle cx='16' cy='5' r='3.4' fill='%239c3b60'/%3E%3C/svg%3E">
<title>Attune</title><style>
:root{
  color-scheme:light;  /* themes native date/number controls */
  --bg:#f5f2ef;--card:#ffffff;--fg:#211d1b;--fg2:#4a4441;--dim:#918a85;--line:#eae4de;
  --accent:#9c3b60;--accent2:#7c2f4c;--soft:#f7edf0;--shadow:0 1px 2px rgba(40,30,25,.04),0 8px 24px rgba(40,30,25,.05);
  --men:#c34a63;--fol:#3f927a;--ovu:#c98a35;--lut:#6f5fa6;
  --serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif}
@media(prefers-color-scheme:dark){:root{
  color-scheme:dark;
  --bg:#14100f;--card:#1c1715;--fg:#efe9e5;--fg2:#c9c1bc;--dim:#a0958f;--line:#2b2420;
  --accent:#e07fa2;--accent2:#e79bb6;--soft:#2a1c22;--shadow:0 1px 2px rgba(0,0,0,.3),0 8px 26px rgba(0,0,0,.35);
  --men:#d76a80;--fol:#57ad94;--ovu:#dca253;--lut:#9284c7}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);-webkit-text-size-adjust:100%;
  font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  padding-bottom:calc(74px + env(safe-area-inset-bottom))}
.wrap{max-width:560px;margin:0 auto;padding:0 18px 24px}
h1{font-size:26px;line-height:1.15;letter-spacing:-.025em;margin:22px 0 3px;font-weight:600}
.sub{color:var(--dim);font-size:14px;margin-bottom:8px}
.dim{color:var(--dim);font-size:13px}
.eyebrow{font-size:11px;font-weight:600;color:var(--dim);text-transform:uppercase;letter-spacing:.1em}
.card{background:var(--card);border:1px solid var(--line);border-radius:20px;padding:20px;margin:14px 0;box-shadow:var(--shadow)}
.card>h2{font-size:11px;font-weight:600;color:var(--dim);text-transform:uppercase;letter-spacing:.1em;margin:0 0 15px}
label{font-size:13px;color:var(--fg2);font-weight:500}
button{font:inherit;border:0;border-radius:13px;padding:13px 16px;background:var(--accent);color:#fff;
  cursor:pointer;font-weight:600;letter-spacing:.01em;transition:transform .08s,filter .15s}
button:hover{filter:brightness(1.05)}button:active{transform:scale(.98)}
button.ghost{background:transparent;color:var(--fg2);border:1px solid var(--line);font-weight:500}
button.ghost:hover{border-color:var(--dim);filter:none}
button.danger{background:transparent;color:var(--men);border:1px solid color-mix(in srgb,var(--men) 45%,var(--line));font-weight:500}
button.danger:hover{border-color:var(--men);filter:none}
input,select,textarea{font:16px inherit;font-family:inherit;padding:13px;border:1px solid var(--line);
  border-radius:13px;background:var(--bg);color:var(--fg);width:100%;min-width:0}
/* iOS date/time inputs have an intrinsic min-width that ignores width:100% and overflows the
   card — dropping the native appearance makes them respect their box (tap still opens the picker). */
input[type=date]{-webkit-appearance:none;appearance:none;max-width:100%}
input[type=date]::-webkit-date-and-time-value{text-align:left}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--soft)}
.row{display:flex;gap:10px;align-items:center}.row>*{min-width:0}
.grow{flex:1;min-width:0}.hide{display:none!important}  /* !important so it beats ID selectors that set display */

/* ---- cycle ring ---- */
.ringwrap{display:flex;justify-content:center;margin:6px 0}
.ring{position:relative}
.ring svg{display:block;width:100%;height:100%}
.ringc{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.ringc .ph{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.14em}
.ringc .num{font-family:var(--serif);font-size:clamp(40px,15vw,56px);line-height:1;font-weight:500;margin:4px 0 2px;letter-spacing:-.01em}
.ringc .cap{font-size:12px;color:var(--dim);text-transform:uppercase;letter-spacing:.06em}
.ringc .to{font-size:13px;color:var(--fg2);margin-top:7px;font-weight:500}
.feel{font-size:15px;line-height:1.55;color:var(--fg2);text-align:center;margin:2px 4px 0}
.season{font-family:var(--serif);font-size:19px;text-align:center;margin:16px 0 2px;font-style:italic}

/* phase legend */
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px;color:var(--fg2);margin-top:16px;justify-content:center}
.legend span{display:inline-flex;align-items:center}
.legend span::before{content:"";width:8px;height:8px;border-radius:99px;margin-right:6px}
.legend .men::before{background:var(--men)}.legend .fol::before{background:var(--fol)}
.legend .ovu::before{background:var(--ovu)}.legend .lut::before{background:var(--lut)}

/* recommendations */
.rec{display:flex;gap:14px;padding:16px 0;border-bottom:1px solid var(--line);align-items:flex-start}
.rec:first-child{padding-top:0}.rec:last-child{border:0;padding-bottom:0}
.rec .ic{flex:none;width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;
  background:color-mix(in srgb,var(--pc) 13%,transparent);color:var(--pc)}
.rec .ic svg{width:20px;height:20px}
.rec .lb{font-weight:600;font-size:15px;letter-spacing:-.01em}
.rec .tp{font-size:14px;color:var(--fg2);margin-top:3px;line-height:1.5}

/* selectors */
.chips{display:flex;flex-wrap:wrap;gap:8px}
.chip{padding:9px 15px;border:1px solid var(--line);border-radius:99px;background:var(--card);
  font-size:13.5px;color:var(--fg2);cursor:pointer;user-select:none;transition:all .12s}
.chip:hover{border-color:var(--dim)}
.chip.on{background:var(--accent);border-color:var(--accent);color:#fff}
.field-label{font-size:12px;color:var(--dim);font-weight:600;letter-spacing:.02em;margin:18px 0 9px}
.field-label:first-child{margin-top:0}
.seg{display:flex;gap:6px}
.segb{flex:1;height:38px;border:1px solid var(--line);border-radius:10px;background:var(--card);padding:0;cursor:pointer}
.segb.on{background:var(--accent);border-color:var(--accent)}
.scale{display:flex;justify-content:space-between;font-size:11px;color:var(--dim);margin-top:6px}

/* lists */
.li{display:flex;gap:12px;align-items:center;padding:14px 0;border-bottom:1px solid var(--line)}
.li:first-child{padding-top:0}.li:last-child{border:0;padding-bottom:0}
.li .lead{font-weight:500}.li .val{color:var(--fg2);font-size:14px}
.li .val.big{font-family:var(--serif);font-size:17px;color:var(--fg)}
.pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:10.5px;font-weight:700;color:#fff;
  text-transform:uppercase;letter-spacing:.05em;vertical-align:middle}
.pill.men{background:var(--men)}.pill.fol{background:var(--fol)}
.pill.ovu{background:var(--ovu)}.pill.lut{background:var(--lut)}
.empty{text-align:center;color:var(--dim);font-size:14px;padding:26px 10px}
.note{font-size:12px;color:var(--dim);line-height:1.55;margin-top:14px}
.divider{height:1px;background:var(--line);margin:16px 0}

nav{position:fixed;bottom:0;left:0;right:0;z-index:6;display:flex;justify-content:center;
  background:color-mix(in srgb,var(--card) 88%,transparent);backdrop-filter:saturate(180%) blur(14px);
  -webkit-backdrop-filter:saturate(180%) blur(14px);border-top:1px solid var(--line);
  padding-bottom:env(safe-area-inset-bottom)}
nav button{flex:1;max-width:180px;background:none;color:var(--dim);border-radius:0;padding:13px 0 12px;font-size:12px;
  font-weight:600;letter-spacing:.02em;display:flex;flex-direction:column;align-items:center;gap:4px}
nav button svg{width:22px;height:22px;stroke-width:1.7}
nav button.on{color:var(--accent)}
#auth{position:fixed;inset:0;z-index:20;background:var(--bg);padding:24px 18px;overflow-y:auto;
  display:flex;flex-direction:column;justify-content:center;
  background-image:radial-gradient(130% 55% at 50% -5%,var(--soft),transparent 68%)}
/* onboarding: short form, so center it vertically like the sign-in screen */
#v-setup{min-height:calc(100vh - 96px);display:flex;flex-direction:column;justify-content:center}
.setup-hero{text-align:center;margin-bottom:20px}
.setup-hero .brandmark{width:56px;height:56px;margin:0 auto 12px}
#auth .inner{width:100%;max-width:400px;margin:auto}
.authhero{text-align:center;margin-bottom:24px}
.brandmark{width:74px;height:74px;display:block;margin:0 auto 14px}
.brand{font-family:var(--serif);font-size:34px;font-weight:500;letter-spacing:-.01em}
.authtag{color:var(--dim);font-size:14.5px;margin-top:5px}
.btn-col{display:flex;flex-direction:column;gap:10px;margin-top:16px}
</style></head><body>

<div id=auth class=hide>
  <div class=inner>
    <div class=authhero>
      <svg class=brandmark viewBox="0 0 76 76" fill="none">
        <g transform="rotate(-90 38 38)" stroke-width="7" stroke-linecap="round">
          <circle cx="38" cy="38" r="30" style="stroke:var(--men)" stroke-dasharray="43 146" stroke-dashoffset="0"></circle>
          <circle cx="38" cy="38" r="30" style="stroke:var(--fol)" stroke-dasharray="43 146" stroke-dashoffset="-47"></circle>
          <circle cx="38" cy="38" r="30" style="stroke:var(--ovu)" stroke-dasharray="43 146" stroke-dashoffset="-94"></circle>
          <circle cx="38" cy="38" r="30" style="stroke:var(--lut)" stroke-dasharray="43 146" stroke-dashoffset="-141"></circle>
        </g>
      </svg>
      <div class=brand>Attune</div>
      <div class=authtag>Live in rhythm with your cycle.</div>
    </div>
    <div class=card>
      <input id=aemail type=email placeholder=Email autocomplete=email>
      <input id=apw type=password placeholder="Password" autocomplete=current-password
        style="margin-top:10px" onkeydown="if(event.key=='Enter')doAuth('login')">
      <div class=dim id=aerr style="margin-top:10px;color:var(--men)"></div>
      <div class=btn-col>
        <button onclick="doAuth('signup')">Create account</button>
        <button class=ghost onclick="doAuth('login')">Sign in</button>
      </div>
      <div style="text-align:center;margin-top:14px;font-size:13px;color:var(--dim)">
        New here? Tap <b style="color:var(--fg2)">Create account</b>. &middot;
        <a href="/privacy" target="_blank" style="color:var(--dim)">Privacy</a>
      </div>
    </div>
  </div>
</div>

<div class=wrap>

<!-- onboarding -->
<div id=v-setup class=hide>
  <div class=setup-hero>
    <svg class=brandmark viewBox="0 0 76 76" fill="none">
      <g transform="rotate(-90 38 38)" stroke-width="7" stroke-linecap="round">
        <circle cx="38" cy="38" r="30" style="stroke:var(--men)" stroke-dasharray="43 146" stroke-dashoffset="0"></circle>
        <circle cx="38" cy="38" r="30" style="stroke:var(--fol)" stroke-dasharray="43 146" stroke-dashoffset="-47"></circle>
        <circle cx="38" cy="38" r="30" style="stroke:var(--ovu)" stroke-dasharray="43 146" stroke-dashoffset="-94"></circle>
        <circle cx="38" cy="38" r="30" style="stroke:var(--lut)" stroke-dasharray="43 146" stroke-dashoffset="-141"></circle>
      </g>
    </svg>
    <h1 style="margin:0">Set up your cycle</h1>
    <div class=sub style="margin-top:5px">Three numbers to begin — change them anytime.</div>
  </div>
  <div class=card>
    <label>First day of your last period</label>
    <input id=slp type=date style="margin:8px 0 16px">
    <div class=row>
      <div class=grow><label>Cycle length</label>
        <input id=scl type=number min=20 max=45 value=28 style="margin-top:8px"></div>
      <div class=grow><label>Period length</label>
        <input id=spl type=number min=1 max=10 value=5 style="margin-top:8px"></div>
    </div>
    <button style="margin-top:18px;width:100%" onclick=saveSetup()>Start tracking</button>
    <div class=note>Averages are fine to start. Logging real period start dates sharpens your predictions over time.</div>
  </div>
</div>

<!-- today -->
<div id=v-today class=hide>
  <h1 id=hd></h1>
  <div class=sub id=hs></div>
  <div class=card>
    <div class=ringwrap id=hero></div>
    <div class=season id=season></div>
    <div class=feel id=feel></div>
  </div>
  <div class=card>
    <h2>Tuned to your phase</h2>
    <div id=recs></div>
  </div>
  <div class=card>
    <h2>How are you today?</h2>
    <div class=field-label>Energy</div>
    <div id=energy></div>
    <div class=field-label>Mood</div>
    <div class=chips id=mood></div>
    <div class=field-label>Flow</div>
    <div class=chips id=flow></div>
    <div class=field-label>Symptoms</div>
    <div class=chips id=symp></div>
    <textarea id=notes rows=2 placeholder="Notes (optional)" style="margin-top:16px"></textarea>
    <button style="margin-top:12px;width:100%" onclick=saveLog()>Save today</button>
  </div>
  <button class=ghost style="width:100%" onclick=periodToday()>My period started today</button>
  <div class=note>Attune estimates phases from your dates. It is not medical advice and not a reliable form of
    contraception. Speak to a clinician about any health concern.</div>
</div>

<!-- cycle -->
<div id=v-cycle class=hide>
  <h1>Your cycle</h1>
  <div class=sub id=csub></div>
  <div class=card>
    <div class=ringwrap id=cring></div>
    <div class=legend>
      <span class=men>Menstrual</span><span class=fol>Follicular</span>
      <span class=ovu>Ovulatory</span><span class=lut>Luteal</span>
    </div>
  </div>
  <div class=card>
    <h2>Coming up</h2>
    <div id=predict></div>
    <div class=divider></div>
    <div class=note id=fertile></div>
  </div>
</div>

<!-- me -->
<div id=v-me class=hide>
  <h1>You</h1>
  <div class=sub id=msub></div>
  <div class=card>
    <h2>Your patterns</h2>
    <div id=insights></div>
  </div>
  <div class=card>
    <h2>Recent logs</h2>
    <div id=history></div>
  </div>
  <div class=card>
    <h2>Cycle settings</h2>
    <label>Last period start</label>
    <input id=elp type=date style="margin:8px 0 14px">
    <div class=row>
      <div class=grow><label>Cycle length</label>
        <input id=ecl type=number min=20 max=45 style="margin-top:8px"></div>
      <div class=grow><label>Period length</label>
        <input id=epl type=number min=1 max=10 style="margin-top:8px"></div>
    </div>
    <div class=row style="margin-top:16px">
      <button class=grow onclick=saveSettings()>Save changes</button>
      <button class="grow ghost" onclick=logout()>Sign out</button>
    </div>
    <div class=divider></div>
    <button class=ghost id=remindbtn style="width:100%" onclick=enableReminders()>Enable phase reminders</button>
    <div class=note>A nudge when your phase changes or your period is due. Fires while Attune is open in your browser.</div>
  </div>
  <div class=card>
    <h2>Privacy &amp; your data</h2>
    <div class=dim style="line-height:1.55">Attune never sells or shares your data, and uses no trackers or ads.
      <a href="/privacy" target="_blank" style="color:var(--accent)">Read the privacy policy</a>.</div>
    <div class=btn-col style="margin-top:14px">
      <button class=ghost onclick=exportData()>Download my data</button>
      <button class=danger onclick=deleteAccount()>Delete account &amp; all data</button>
    </div>
  </div>
</div>

</div>
<nav>
  <button id=n-today class=on onclick="show('today')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"></circle><path d="M12 12l4-2"></path><path d="M12 12V7"></path></svg>Today</button>
  <button id=n-cycle onclick="show('cycle')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12a8 8 0 1 1-3.2-6.4"></path><path d="M20 4v4h-4"></path></svg>Cycle</button>
  <button id=n-me onclick="show('me')">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"></circle><path d="M4 20a8 8 0 0 1 16 0"></path></svg>You</button>
</nav>
<script>
const $=s=>document.querySelector(s);
const api=async(u,o)=>{const r=await fetch(u,o);
  if(r.status==401){$('#auth').classList.remove('hide');throw new Error('auth')}
  if(!r.ok)throw new Error((await r.json().catch(()=>({}))).detail||'error');
  return r.json()};
const today=()=>new Date().toLocaleDateString('en-CA');
const esc=s=>(s||'').replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const CC={Menstrual:'men',Follicular:'fol',Ovulatory:'ovu',Luteal:'lut'};
const fmtd=d=>new Date(d+'T00:00').toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric'});
let S={}, sel={energy:null,mood:null,flow:null,symptoms:new Set()}, view='today';

const ICONS={
  move:'<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline>',
  eat:'<path d="M4 11a8 8 0 0 0 16 0z"></path><line x1="2" y1="11" x2="22" y2="11"></line><line x1="12" y1="3" x2="12" y2="7"></line>',
  work:'<circle cx="12" cy="12" r="9"></circle><circle cx="12" cy="12" r="4"></circle><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"></circle>',
  people:'<circle cx="9" cy="8" r="3.2"></circle><path d="M3.5 20a5.5 5.5 0 0 1 11 0"></path><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6"></path><path d="M17.5 14.4a5.5 5.5 0 0 1 3 5"></path>'
};
const icon=k=>`<svg viewBox="0 0 24 24" fill=none stroke=currentColor stroke-width=1.7 stroke-linecap=round stroke-linejoin=round>${ICONS[k]||''}</svg>`;

// SVG cycle ring: colored arcs proportional to each phase + a marker at today.
function ring(info,size){
  const sw=13, cx=size/2, r=cx-sw/2-2, C=2*Math.PI*r;
  let off=0;
  const arcs=info.segments.map(s=>{
    const len=s.frac*C, seg=Math.max(0.001,len-3);
    const c=`<circle cx=${cx} cy=${cx} r=${r} fill=none stroke-width=${sw} stroke-linecap=round
      style="stroke:var(--${CC[s.phase]})" stroke-dasharray="${seg} ${C-seg}" stroke-dashoffset="${-off}"/>`;
    off+=len; return c;
  }).join('');
  const ang=(info.marker*360-90)*Math.PI/180, mx=cx+r*Math.cos(ang), my=cx+r*Math.sin(ang);
  const marker=`<circle cx=${mx} cy=${my} r=6.5 fill=var(--card) stroke-width=3 style="stroke:var(--${CC[info.phase]})"/>`;
  const n=info.days_to_next;
  const to=n<=0?'Period due today':(n==1?'1 day to period':n+' days to period');
  return `<div class=ring style="width:${size}px;height:${size}px">
    <svg viewBox="0 0 ${size} ${size}"><g transform="rotate(-90 ${cx} ${cx})">${arcs}</g>${marker}</svg>
    <div class=ringc>
      <div class=ph style="color:var(--${CC[info.phase]})">${info.phase}</div>
      <div class=num>${info.day}</div><div class=cap>Day of ${info.cycle_len}</div>
      <div class=to>${to}</div>
    </div></div>`;
}

async function doAuth(path){
  const err=m=>{$('#aerr').textContent=m;};
  err('');
  const email=$('#aemail').value.trim(), password=$('#apw').value;
  // Validate here so a short password shows a friendly line, not a 422 whose detail is an object.
  if(!email) return err('Enter your email.');
  if(password.length<6) return err('Password must be at least 6 characters.');
  const r=await fetch('/api/'+path,{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({email,password})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){
    const d=j.detail, msg=typeof d=='string'?d:(Array.isArray(d)&&d[0]&&d[0].msg)||'';
    // Don't dead-end a new user who tapped Sign in — point them at Create account (without
    // revealing whether the email exists, which for a health app would be a privacy leak).
    if(path=='login') return err('Couldn’t sign in. Double-check your password — or if you’re new here, tap Create account below.');
    return err(msg&&msg.length<160?msg:'That didn’t work — please try again.');
  }
  $('#auth').classList.add('hide');$('#apw').value='';load();
}
const logout=()=>{if(!confirm('Sign out of Attune?'))return;
  fetch('/api/logout',{method:'POST'}).finally(()=>location.reload());};

function show(v){view=v;['setup','today','cycle','me'].forEach(x=>$('#v-'+x).classList.add('hide'));
  ['today','cycle','me'].forEach(x=>$('#n-'+x)&&$('#n-'+x).classList.toggle('on',x==v));
  if(v=='cycle')renderCycle(); else if(v=='me')renderMe(); else $('#v-'+v).classList.remove('hide');}

async function load(){
  S=await api('/api/state?date='+today());
  if(!S.profile){document.querySelector('nav').classList.add('hide');
    ['today','cycle','me'].forEach(x=>$('#v-'+x).classList.add('hide'));
    $('#v-setup').classList.remove('hide');return;}
  document.querySelector('nav').classList.remove('hide');$('#v-setup').classList.add('hide');
  renderToday(); show(view=='setup'?'today':view); notifyPhase();
}

// Reminders: fire once per phase-change / period-due, while the app is open. localStorage
// dedupes so you don't get pinged on every reload. Background push (service worker) is a
// separate, heavier feature — not built.
function ping(title,body){ try{new Notification(title,{body})}catch(e){} }
function notifyPhase(){
  if(!('Notification'in window)||Notification.permission!='granted'||!S.info)return;
  const i=S.info, k=today();
  let seen; try{seen=JSON.parse(localStorage.attune_notif||'{}')}catch(e){seen={}}
  if(seen.phase!==i.phase){seen.phase=i.phase; ping('You’re in your '+i.phase+' phase',i.rec.feel);}
  if(i.days_to_next<=0 && seen.due!==k){seen.due=k;
    ping('Your period may start today','Open Attune and tap “My period started today” to recalibrate.');}
  else if(i.days_to_next===2 && seen.soon!==k){seen.soon=k;
    ping('Period expected in about 2 days','A good time to start winding down.');}
  try{localStorage.attune_notif=JSON.stringify(seen)}catch(e){}
}
function updateRemindBtn(){
  const b=$('#remindbtn'); if(!b)return;
  if(!('Notification'in window)){b.textContent='Reminders not supported here';b.disabled=true;return;}
  const p=Notification.permission;
  b.textContent=p=='granted'?'Reminders are on':p=='denied'?'Reminders blocked in browser settings':'Enable phase reminders';
  b.disabled=p!='default';
}
async function enableReminders(){
  if(!('Notification'in window))return toast('Notifications aren’t supported here');
  const p=await Notification.requestPermission(); updateRemindBtn();
  if(p=='granted'){toast('Reminders on'); notifyPhase();}
  else if(p=='denied')toast('Blocked — enable notifications in your browser settings');
}
async function exportData(){
  const d=await api('/api/export');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([JSON.stringify(d,null,2)],{type:'application/json'}));
  a.download='attune-data.json'; a.click(); URL.revokeObjectURL(a.href); toast('Downloaded');
}
async function deleteAccount(){
  if(!confirm('Delete your account and ALL your data? This cannot be undone.'))return;
  if(!confirm('Really delete everything? There is no way to recover it.'))return;
  await api('/api/account',{method:'DELETE'}); location.reload();
}

function renderToday(){
  const i=S.info, pc=CC[i.phase];
  $('#hd').textContent=new Date().toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
  $('#hs').textContent='Cycle day '+i.day;
  $('#hero').innerHTML=ring(i,208);
  $('#season').textContent='your '+i.season;
  $('#feel').textContent=i.rec.feel;
  $('#recs').setAttribute('style','--pc:var(--'+pc+')');
  $('#recs').innerHTML=i.rec.cards.map(x=>`<div class=rec><div class=ic>${icon(x.icon)}</div>
    <div><div class=lb>${x.label}</div><div class=tp>${x.tip}</div></div></div>`).join('');
  const L=S.log||{};
  sel={energy:L.energy||null,mood:L.mood||null,flow:L.flow||null,symptoms:new Set(L.symptoms||[])};
  renderEnergy();
  $('#mood').innerHTML=Object.entries(S.moods).map(([k,lab])=>`<div class="chip${L.mood==k?' on':''}"
    onclick="pick('mood','${k}',this)">${lab}</div>`).join('');
  $('#flow').innerHTML=S.flows.map(f=>`<div class="chip${L.flow==f?' on':''}"
    onclick="pick('flow','${f}',this)">${cap(f)}</div>`).join('');
  $('#symp').innerHTML=S.symptoms.map(s=>`<div class="chip${(L.symptoms||[]).includes(s)?' on':''}"
    onclick="toggleSymp('${s}',this)">${cap(s)}</div>`).join('');
  $('#notes').value=L.notes||'';
}
function renderEnergy(){
  $('#energy').innerHTML='<div class=seg>'+[1,2,3,4,5].map(n=>
    `<button class="segb${sel.energy>=n?' on':''}" onclick="pickEnergy(${n})" aria-label="energy ${n}"></button>`).join('')+
    '</div><div class=scale><span>Low</span><span>High</span></div>';
}
function pickEnergy(n){sel.energy=sel.energy==n?null:n;renderEnergy();}
function pick(k,v,el){const grp=el.parentElement, was=sel[k]==v;
  grp.querySelectorAll('.chip').forEach(c=>c.classList.remove('on'));
  sel[k]=was?null:v; if(!was)el.classList.add('on');}
function toggleSymp(s,el){el.classList.toggle('on');
  sel.symptoms.has(s)?sel.symptoms.delete(s):sel.symptoms.add(s);}

async function saveLog(){
  await api('/api/log',{method:'PUT',headers:{'content-type':'application/json'},
    body:JSON.stringify({day:today(),energy:sel.energy,mood:sel.mood,flow:sel.flow,
      symptoms:[...sel.symptoms],notes:$('#notes').value})});
  await load(); toast('Saved');
}
async function periodToday(){
  if(!confirm('Log that your period started today? This recalibrates your cycle.'))return;
  await api('/api/period?day='+today(),{method:'POST'}); await load(); toast('Cycle updated');
}

function renderCycle(){
  ['today','me'].forEach(x=>$('#v-'+x).classList.add('hide'));$('#v-setup').classList.add('hide');
  $('#v-cycle').classList.remove('hide');
  const i=S.info;
  $('#csub').textContent='Day '+i.day+' of '+i.cycle_len+' · '+i.phase+' phase';
  $('#cring').innerHTML=ring(i,224);
  $('#predict').innerHTML=i.upcoming.map((d,k)=>`<div class=li>
    <span class="lead grow">${k==0?'Next period':'Period after'}</span>
    <span class="val big">${fmtd(d)}</span></div>`).join('');
  $('#fertile').innerHTML=`Estimated fertile window <b style="color:var(--fg)">${fmtd(i.fertile_start)} – ${fmtd(i.fertile_end)}</b>,
    with ovulation around ${fmtd(i.ovulation_date)}. An estimate only — not reliable for contraception.`;
}

async function renderMe(){
  ['today','cycle'].forEach(x=>$('#v-'+x).classList.add('hide'));$('#v-setup').classList.add('hide');
  $('#v-me').classList.remove('hide');
  $('#elp').value=S.profile.last_period;$('#ecl').value=S.profile.cycle_len;$('#epl').value=S.profile.period_len;
  updateRemindBtn();
  const ins=await api('/api/insights');
  $('#insights').innerHTML=ins.insights.length
    ? ins.insights.map(t=>`<div class=li><span class="grow" style="font-size:14px;line-height:1.5;color:var(--fg2)">${esc(t)}</span></div>`).join('')
    : `<div class=empty>Log ${Math.max(1,(ins.need||5)-ins.days)} more day${(ins.need||5)-ins.days==1?'':'s'} to unlock your patterns.</div>`;
  const {logs}=await api('/api/logs');
  $('#msub').textContent=logs.length+' day'+(logs.length==1?'':'s')+' logged';
  $('#history').innerHTML=logs.length?logs.map(l=>{
    const bits=[l.mood?S.moods[l.mood]:'', l.energy?'Energy '+l.energy:'',
      l.flow&&l.flow!='none'?cap(l.flow)+' flow':'', (l.symptoms||[]).map(cap).join(', ')].filter(Boolean).join(' · ');
    return `<div class=li><div class=grow><div class=lead>${fmtd(l.day)}
      ${l.phase?`<span class="pill ${CC[l.phase]}">${l.phase}</span>`:''}</div>
      <div class="val" style="margin-top:3px">${esc(bits)||'—'}${l.notes?'<br>'+esc(l.notes):''}</div></div></div>`;
  }).join(''):'<div class=empty>No logs yet. Track how you feel from the Today tab.</div>';
}

// Validate before sending so a blank/out-of-range field shows a message instead of a silent 422.
function badProfile(lp,cl,pl){
  if(!lp)return 'Add your last period date';
  if(!(cl>=20&&cl<=45))return 'Cycle length must be 20–45 days';
  if(!(pl>=1&&pl<=10))return 'Period length must be 1–10 days';
  return '';
}
async function saveProfile(lp,cl,pl,done){
  const err=badProfile(lp,cl,pl); if(err)return toast(err);
  try{
    await api('/api/profile',{method:'PUT',headers:{'content-type':'application/json'},
      body:JSON.stringify({last_period:lp,cycle_len:cl,period_len:pl})});
    await load(); if(done)done();
  }catch(e){toast(e&&e.message&&e.message.length<90?e.message:'Could not save — please try again');}
}
const saveSetup=()=>saveProfile($('#slp').value,+$('#scl').value,+$('#spl').value);
const saveSettings=()=>saveProfile($('#elp').value,+$('#ecl').value,+$('#epl').value,()=>toast('Saved'));

function toast(m){const t=document.createElement('div');t.textContent=m;
  t.style.cssText='position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:var(--fg);'+
    'color:var(--bg);padding:10px 18px;border-radius:99px;font-size:13.5px;font-weight:500;z-index:30;'+
    'box-shadow:0 6px 20px rgba(0,0,0,.2)';
  document.body.appendChild(t);setTimeout(()=>t.remove(),1500);}

Object.assign(window,{show,doAuth,logout,pick,pickEnergy,toggleSymp,saveLog,periodToday,saveSetup,saveSettings,enableReminders,exportData,deleteAccount});
$('#slp').value=today();
window.addEventListener('unhandledrejection',e=>{if(e.reason&&e.reason.message=='auth')e.preventDefault()});
load().catch(()=>{});
</script></body></html>
"""


@app.get("/", response_class=HTMLResponse)
def home():
    # ponytail: the page IS the app — a cached copy means an old app after every edit
    return HTMLResponse(PAGE, headers={"cache-control": "no-store"})


PRIVACY = """
<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='11' fill='none' stroke='%239c3b60' stroke-width='4'/%3E%3Ccircle cx='16' cy='5' r='3.4' fill='%239c3b60'/%3E%3C/svg%3E">
<title>Privacy — Attune</title><style>
:root{--bg:#f5f2ef;--card:#fff;--fg:#211d1b;--fg2:#4a4441;--dim:#918a85;--line:#eae4de;--accent:#9c3b60;
  --serif:"Iowan Old Style",Palatino,Georgia,serif}
@media(prefers-color-scheme:dark){:root{--bg:#14100f;--card:#1c1715;--fg:#efe9e5;--fg2:#c9c1bc;--dim:#a0958f;
  --line:#2b2420;--accent:#e07fa2}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 -apple-system,system-ui,sans-serif}
.wrap{max-width:640px;margin:0 auto;padding:32px 20px 64px}
a{color:var(--accent)}
h1{font-family:var(--serif);font-size:30px;font-weight:500;letter-spacing:-.01em;margin:8px 0 4px}
.upd{color:var(--dim);font-size:13px;margin-bottom:24px}
h2{font-size:15px;letter-spacing:-.01em;margin:26px 0 6px}
p,li{color:var(--fg2);font-size:15px}
ul{padding-left:20px;margin:6px 0}
li{margin:4px 0}
.lead{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px 18px;margin:18px 0}
.lead b{color:var(--fg)}
.back{display:inline-block;margin-bottom:18px;font-size:14px}
</style></head><body><div class=wrap>
<a class=back href="/">&larr; Back to Attune</a>
<h1>Privacy Policy</h1>
<div class=upd>Last updated 2 September 2026</div>

<div class=lead><b>The short version:</b> Attune stores only what you enter, uses it only to run the
app for you, and shares it with no one. There are no trackers, no ads, and your data is never sold.
Your cycle information never leaves our server. You can export or permanently delete everything at
any time from the <b>You</b> tab.</div>

<h2>What we collect</h2>
<ul>
  <li><b>Your email</b> — so you can sign in.</li>
  <li><b>Cycle details</b> — your last period date, cycle length, and period length.</li>
  <li><b>Daily logs you choose to add</b> — energy, mood, flow, symptoms, and any notes.</li>
</ul>
<p>That's all. We don't ask for your name, we don't access your device's contacts, location, or health
records, and we don't collect anything in the background.</p>

<h2>How we use it</h2>
<p>Only to provide the app to you: to work out your current cycle phase, show recommendations and
predictions, and surface patterns in your own logs. We do not profile you, advertise to you, or use
your data to train any model.</p>

<h2>Who we share it with</h2>
<p>No one. We do not sell, rent, or share your personal data with advertisers, data brokers, or any
third party. Attune runs no analytics or tracking, and the app makes no outside requests carrying your
data. Our only processor is our hosting provider (Railway), which stores the database that runs the
service on our behalf.</p>

<h2>Your rights &amp; choices</h2>
<ul>
  <li><b>Export</b> — download everything we hold about you as a JSON file (You &rarr; Download my data).</li>
  <li><b>Delete</b> — permanently erase your account and all associated data at any time
    (You &rarr; Delete account). This is immediate and cannot be undone.</li>
</ul>

<h2>Security</h2>
<p>Passwords are stored only as salted hashes, never in plain text. Every account's data is isolated,
the service is served over HTTPS, and your session is kept by a single essential cookie — there are no
tracking cookies.</p>

<h2>Not medical advice</h2>
<p>Attune's predictions are estimates from the dates you provide. It is not a medical device, not a
diagnosis, and not a reliable form of contraception. Talk to a clinician about any health concern.</p>

<h2>Contact</h2>
<p>Questions or requests about your data: <a href="mailto:oseabhi@gmail.com">oseabhi@gmail.com</a>.</p>
</div></body></html>
"""


@app.get("/privacy", response_class=HTMLResponse)
def privacy():
    return HTMLResponse(PRIVACY, headers={"cache-control": "no-store"})


def demo():
    # Self-check: phase boundaries and predictions for a clean 28-day cycle from 2026-01-01.
    lp, cl, pl = "2026-01-01", 28, 5
    f = lambda d: cycle_info(lp, cl, pl, d)
    assert f("2026-01-01")["day"] == 1 and f("2026-01-01")["phase"] == "Menstrual"
    assert f("2026-01-05")["phase"] == "Menstrual"          # day 5, last period day
    assert f("2026-01-06")["phase"] == "Follicular"         # day 6
    assert f("2026-01-14")["phase"] == "Ovulatory"          # day 14 == ovulation (28-14)
    assert f("2026-01-20")["phase"] == "Luteal"             # day 20
    assert f("2026-01-29")["day"] == 1                      # next cycle wraps
    assert f("2026-01-10")["next_period"] == "2026-01-29"
    assert f("2026-01-10")["days_to_next"] == 19
    # short cycle shouldn't produce inverted/negative segments
    for s in cycle_info("2026-01-01", 21, 6, "2026-01-10")["segments"]:
        assert 0 < s["frac"] <= 1
    # fertile window brackets ovulation
    i = f("2026-01-10")
    assert i["fertile_start"] <= i["ovulation_date"] <= i["fertile_end"]

    # insights: under threshold returns nothing; with a clear pattern it surfaces it.
    assert compute_insights(lp, cl, pl, [{"day": "2026-01-01", "energy": 1, "symptoms": []}])["insights"] == []
    logs = ([{"day": f"2026-01-0{d}", "energy": 1, "symptoms": ["cramps"]} for d in range(1, 6)]  # menstrual
            + [{"day": "2026-01-14", "energy": 5, "symptoms": []},                                # ovulatory
               {"day": "2026-01-15", "energy": 5, "symptoms": []}])
    r = compute_insights(lp, cl, pl, logs)
    assert any("Menstrual" in t and "energy" in t.lower() for t in r["insights"])  # low energy in menstrual
    assert any("Cramps" in t and "menstrual" in t for t in r["insights"])          # cramps ↔ menstrual
    print("ok")


if __name__ == "__main__":
    demo()
