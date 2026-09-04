// SalesPal frontend — vanilla JS SPA
const state = { period: "month", view: "home", settings: { currency: "₦" } };
const app = document.getElementById("app");

// ---------- helpers ----------
function _handle401(p, status) {
  // Expired/absent session: drop to the auth screen — except for the auth
  // endpoints themselves, whose 401s are real errors to show inline.
  if (status === 401 && !p.startsWith("/api/auth/")) { requireAuthUI(); return true; }
  return false;
}
async function _detail(r) { try { return (JSON.parse(await r.text())).detail || ""; } catch (e) { return ""; } }
// Surface a clean, human message from an error response (FastAPI's `detail`),
// never the raw JSON envelope.
async function _err(r) { return new Error((await _detail(r)) || "Something went wrong"); }
// Lightweight GET cache so re-tapping tabs, switching periods, or filtering
// feels instant: serve the last response immediately (within TTL) and refresh
// in the background; any write (api.send) clears the cache so changes show at
// once. No polling in the app, so caching reads is safe.
const _getCache = new Map(); // path -> { at, data }
const _inflight = new Set();
const GET_TTL = 15000;
function apiCacheClear() { _getCache.clear(); }

async function _rawGet(p, quiet) {
 const r = await fetch(p);
 if (quiet) { // background refresh: update cache, no UI side effects
 if (!r.ok) return undefined;
 } else {
 if (_handle401(p, r.status)) throw new Error("__auth__");
 if (r.status === 402) { showUpgrade(await _detail(r)); throw new Error("__upgrade__"); }
 if (!r.ok) throw await _err(r);
 }
 const data = await r.json();
 _getCache.set(p, { at: Date.now(), data });
 return data;
}
function _bgRefresh(p) {
 if (_inflight.has(p)) return;
 _inflight.add(p);
 _rawGet(p, true).catch(() => {}).finally(() => _inflight.delete(p));
}

const api = {
 async get(p, opts) {
 const hit = _getCache.get(p);
 if (!(opts && opts.fresh) && hit && (Date.now() - hit.at) < GET_TTL) {
 _bgRefresh(p); // serve instantly, keep the cache warm for next time
 return _applyOverlay(p, hit.data);
 }
 try {
 return _applyOverlay(p, await _rawGet(p, false));
 } catch (e) {
 if (e.message === "__auth__" || e.message === "__upgrade__") throw e;
 // Offline/network fail: serve the last value we have (even if stale) so the
 // app stays usable; for the offline-editable lists, fall back to empty so
 // queued-but-unsynced items still show through the overlay.
 if (hit) return _applyOverlay(p, hit.data);
 if (_isOverlayList(p)) return _applyOverlay(p, []);
 throw e;
 }
 },
 async send(p, method, body) {
 const writable = _offlineWritable(p, method);
 if (writable && !navigator.onLine) return _enqueue(p, method, body);
 try {
 return await _rawSend(p, method, body);
 } catch (e) {
 if (e.message === "__net__") {
 if (writable) return _enqueue(p, method, body);
 throw new Error("You're offline — reconnect to do that");
      }
      throw e;
    }
  },
  // Multipart upload (voice audio). No Content-Type header — the browser sets the
  // multipart boundary itself. Same 401/402/error handling as _rawSend.
  async sendForm(p, formData) {
    let r;
    try { r = await fetch(p, { method: "POST", body: formData }); }
    catch (e) { throw new Error("You're offline — reconnect to do that"); }
 if (_handle401(p, r.status)) throw new Error("__auth__");
 if (r.status === 402) { showUpgrade(await _detail(r)); throw new Error("__upgrade__"); }
 if (!r.ok) throw await _err(r);
 apiCacheClear();
 return r.json();
 },
};

async function _rawSend(p, method, body) {
 let r;
 try {
 r = await fetch(p, { method, headers: { "Content-Type": "application/json" },
 body: body ? JSON.stringify(body) : undefined });
 } catch (e) { throw new Error("__net__"); } // no connection (or SW unreachable)
 if (_handle401(p, r.status)) throw new Error("__auth__");
 if (r.status === 402) { showUpgrade(await _detail(r)); throw new Error("__upgrade__"); }
 if (!r.ok) throw await _err(r);
 const data = await r.json();
 apiCacheClear(); // a write may change dashboards/lists → drop caches
 return data;
}
// ---------- offline write queue (sales, products, customers) ----------
// Offline, the whitelisted writes below are stored locally and replayed in order
// when the connection returns; GET lists are overlaid with these pending changes
// so the app looks up to date. Sales carry a client_uid so a replay after a lost
// response can't create the sale twice. Scope is deliberate — settings, AI, pay
// links, online orders and staff stay online-only.
const OUTBOX_KEY = "salespal_outbox_v1";
const FAILED_KEY = "salespal_sync_failed_v1";
const TEMPSEQ_KEY = "salespal_tempseq_v1";
let _flushing = false;

function _outbox() { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]"); } catch (e) { return []; } }
function _setOutbox(o) { try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(o)); } catch (e) {} updateSyncBar(); }
function _shiftOutbox() { const o = _outbox(); o.shift(); _setOutbox(o); }
function _nextTempId() {
  let n = parseInt(localStorage.getItem(TEMPSEQ_KEY) || "0", 10); n = (isNaN(n) ? 0 : n) - 1;
  try { localStorage.setItem(TEMPSEQ_KEY, String(n)); } catch (e) {}
  return n;   // negative — never collides with a real server id
}
function _clientUid() { return "c_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

// Exactly the writes we support offline (everything else needs a connection).
function _offlineWritable(path, method) {
  if (method === "POST" && path === "/api/invoices") return true;
  if (method === "POST" && /^\/api\/invoices\/-?\d+\/payments$/.test(path)) return true;
  if (method === "POST" && (path === "/api/products" || path === "/api/customers")) return true;
  if ((method === "PUT" || method === "DELETE") && /^\/api\/(products|customers)\/-?\d+$/.test(path)) return true;
  return false;
}
const _OVERLAY_LISTS = ["/api/invoices", "/api/products", "/api/customers"];
function _isOverlayList(p) { return _OVERLAY_LISTS.indexOf(p) !== -1; }

// Queue a write and return the optimistic result its caller expects.
function _enqueue(path, method, body) {
  const e = { uid: _clientUid(), path, method, body: body || null };
  let optimistic = { ok: true };
  if (method === "POST" && path === "/api/invoices") {
    e.tempId = _nextTempId();
    body = body || {}; body.client_uid = body.client_uid || e.uid; e.body = body;
    const total = (body.items || []).reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0), 0);
    optimistic = { id: e.tempId, invoice_no: "Pending", total };
  } else if (method === "POST" && (path === "/api/products" || path === "/api/customers")) {
    e.tempId = _nextTempId();
    optimistic = { id: e.tempId };
  }
  const o = _outbox(); o.push(e); _setOutbox(o);
  return optimistic;
}

// Overlay pending writes onto a fetched list so offline edits are visible.
function _applyOverlay(p, data) {
  const ob = _outbox();
  if (!ob.length || !_isOverlayList(p)) return data;
  const list = Array.isArray(data) ? data.map(x => ({ ...x })) : [];
  if (p === "/api/invoices") return _overlayInvoices(list, ob);
  return _overlayEntity(p, list, ob);
}
function _overlayEntity(base, list, ob) {
  const byId = new Map(list.map(x => [x.id, x]));
  for (const e of ob) {
    if (e.method === "POST" && e.path === base) {
      byId.set(e.tempId, { ...(e.body || {}), id: e.tempId, _pending: true });
    } else if (e.path.indexOf(base + "/") === 0) {
      const id = parseInt(e.path.slice(base.length + 1), 10);
      if (e.method === "PUT") byId.set(id, { ...(byId.get(id) || { id }), ...(e.body || {}), _pending: true });
      else if (e.method === "DELETE") byId.delete(id);
    }
  }
  return [...byId.values()];
}
function _overlayInvoices(list, ob) {
  const pending = [];
  for (const e of ob) {
    if (e.method === "POST" && e.path === "/api/invoices") {
      const b = e.body || {};
      const total = (b.items || []).reduce((s, i) => s + (i.qty || 0) * (i.unit_price || 0), 0);
      const paid = b.payment ? (b.payment.amount || 0) : 0;
      pending.push({ id: e.tempId, invoice_no: "Pending", customer_name: b.customer_name || "",
        date: b.date || new Date().toISOString().slice(0, 10), total, paid,
        balance: total - paid,
        status: paid >= total - 0.001 ? "paid" : (paid > 0 ? "partial" : "unpaid"),
        _pending: true });
    }
  }
  return pending.concat(list);
}

// Replay the queue in order, mapping each created row's temp id to its real id
// so later ops (a payment, or a product used in a sale) target the right row.
async function flushOutbox() {
 if (_flushing || !navigator.onLine || !_outbox().length) return;
 _flushing = true;
 const idMap = {};
 try {
 while (navigator.onLine) {
 const q = _outbox();
 if (!q.length) break;
 const e = q[0];
 const res = await _flushSend(_remapPath(e.path, idMap), e.method, _remapBody(e.body, idMap));
 if (res.net || res.status === 401 || res.status >= 500) break; // transient — retry later
 if (!res.ok) { _recordFailed(e, (res.data && res.data.detail) || ("Error " + res.status)); _shiftOutbox(); continue; }
 if (e.tempId != null && res.data && res.data.id != null) idMap[e.tempId] = res.data.id;
 _shiftOutbox();
 }
 } finally {
 _flushing = false;
 apiCacheClear();
 updateSyncBar();
 if (!document.body.classList.contains("signed-out")) render();
 }
}
// Like _rawSend but with no UI side effects (no upgrade modal / cache churn mid-sync).
async function _flushSend(path, method, body) {
 let r;
 try {
 r = await fetch(path, { method, headers: { "Content-Type": "application/json" },
 body: body ? JSON.stringify(body) : undefined });
 } catch (e) { return { net: true }; }
 let data = null; try { data = await r.json(); } catch (e) {}
 return { ok: r.ok, status: r.status, data };
}
function _remapId(id, idMap) { return (id != null && idMap[id] != null) ? idMap[id] : id; }
function _remapPath(path, idMap) {
 return path.replace(/\/(-\d+)(\/|$)/, (m, id, tail) => "/" + _remapId(parseInt(id, 10), idMap) + tail);
}
function _remapBody(body, idMap) {
 if (!body) return body;
 const b = { ...body };
 if (Array.isArray(b.items)) b.items = b.items.map(it => ({ ...it, product_id: _remapId(it.product_id, idMap) }));
 if (b.customer_id != null) b.customer_id = _remapId(b.customer_id, idMap);
 return b;
}
// A queued write the server rejected (e.g. product deleted before sync). Never
// dropped silently — kept for the record and surfaced so nothing money-related
// vanishes without the merchant knowing.
function _recordFailed(e, msg) {
 try {
 const f = JSON.parse(localStorage.getItem(FAILED_KEY) || "[]");
 f.push({ ...e, error: msg, at: Date.now() });
 localStorage.setItem(FAILED_KEY, JSON.stringify(f));
 } catch (err) {}
 toast("A queued change couldn't sync: " + msg);
}

// Small status pill: offline notice + how many changes are waiting to sync.
function updateSyncBar() {
  let bar = document.getElementById("syncBar");
  if (!bar) { bar = document.createElement("div"); bar.id = "syncBar"; bar.className = "sync-bar"; document.body.appendChild(bar); }
  const n = _outbox().length;
  const off = !navigator.onLine;
  if (!n && !off) { bar.classList.remove("show"); return; }
  bar.textContent = off
    ? (n ? `<svg class="ic"><use href="#i-offline"/></svg> Offline · ${n} change${n > 1 ? "s" : ""} waiting to sync` : "Offline — changes will sync when you reconnect")
    : `⧗ Syncing ${n} change${n > 1 ? "s" : ""}…`;
  bar.classList.add("show");
}
window.addEventListener("online", () => { updateSyncBar(); flushOutbox(); });
window.addEventListener("offline", updateSyncBar);

const cur = () => state.settings.currency || "₦";
const money = (v) => cur() + (Number(v) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Whole-naira (no kobo) — for big headline figures like the profit hero.
const money0 = (v) => cur() + Math.round(Number(v) || 0).toLocaleString();
// Compact currency for tight stat cells (₦1.24M, ₦980k) so long figures never
// overflow their column. Full precision stays on the detail screens.
function moneyShort(v) {
  const n = Number(v) || 0, a = Math.abs(n), s = cur();
  if (a >= 1e6) return s + (n / 1e6).toFixed(2).replace(/\.?0+$/, "") + "M";
  if (a >= 1e3) return s + Math.round(n / 1e3).toLocaleString() + "k";
  return s + Math.round(n).toLocaleString();
}
const esc = (s) => (s == null ? "" : String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
const fmtDate = (d) => { try { return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return d; } };

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

function openModal(html, cls) {
  const host = document.getElementById("modalHost");
  // A bare sheet (cls, e.g. "paywall") skips the padding + drag-handle so its
  // content can bleed edge-to-edge (full-screen paywall hero).
  const inner = cls ? html : `<div class="modal-handle"></div>${html}`;
  host.innerHTML = `<div class="modal-backdrop"></div><div class="modal ${cls || ""}">${inner}</div>`;
  host.classList.add("open");
  host.querySelector(".modal-backdrop").onclick = closeModal;
}
function closeModal() {
  const host = document.getElementById("modalHost");
  host.classList.remove("open"); host.innerHTML = "";
}
// Swap the contents of an already-open sheet without replaying the slide-up
// (used to fill a skeleton once its data arrives); opens fresh if none is up.
function updateModal(html) {
  const host = document.getElementById("modalHost");
  const modal = host.querySelector(".modal");
  if (host.classList.contains("open") && modal) {
    modal.innerHTML = `<div class="modal-handle"></div>${html}`;
  } else {
    openModal(html);
  }
}

// Minimal markdown -> HTML for AI output
function md(src) {
  const lines = src.split("\n"); let html = "", inList = false;
  const inline = (t) => esc(t)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
  for (let raw of lines) {
    const l = raw.trim();
    if (l.startsWith("## ")) { if (inList) { html += "</ul>"; inList = false; } html += `<h2>${inline(l.slice(3))}</h2>`; }
    else if (l.startsWith("- ") || /^\d+\.\s/.test(l)) {
      if (!inList) { html += "<ul>"; inList = true; }
      html += `<li>${inline(l.replace(/^(-|\d+\.)\s/, ""))}</li>`;
    } else if (l === "") { if (inList) { html += "</ul>"; inList = false; } }
    else { if (inList) { html += "</ul>"; inList = false; } html += `<p>${inline(l)}</p>`; }
  }
  if (inList) html += "</ul>";
  return html;
}

// ---------- auth ----------
let _authMode = "signup"; // "signup" | "login"

let _pricing = null; // cached public pricing for the landing page
let _buyPlan = null; // plan a logged-out visitor chose to buy from the landing

// Visitor picked a paid plan on the landing → quick signup, then straight to pay.
function startBuy(plan) { _buyPlan = plan; setAuthMode("signup"); }
// Free "Get started" path → make sure no pending paid plan lingers.
function startFree() { _buyPlan = null; setAuthMode("signup"); }

function requireAuthUI() {
  document.body.classList.add("signed-out");
  document.getElementById("menuSheet").classList.remove("open");
  if (location.hash === "#login") { // deep link from the marketing page
    history.replaceState({}, "", location.pathname);
    setAuthMode("login");
    return;
  }
  renderLanding();
}

// ---------- landing / pricing (pre-login) ----------
async function renderLanding() {
  _buyPlan = null; // returning to the landing cancels any in-progress purchase
  if (!_pricing) {
    try { _pricing = await api.get("/api/pricing"); } catch (e) { _pricing = null; }
  }
  const features = [
    ["", "Invoices in seconds", "Create &amp; share professional invoices on WhatsApp."],
    ["", "Know your profit", "Track sales, expenses &amp; profit at a glance."],
    ["", "Payment reminders", "Nudge customers on WhatsApp with one tap."],
    ["", "Stock &amp; customers", "Manage products and customers in one place."],
    ["", "AI business advice", "Get weekly insights tailored to your numbers."],
    ["", "Private &amp; yours", "Your own account &amp; data — nobody else sees it."],
  ];
  app.innerHTML = `
    <div class="landing">
      <header class="land-hero compact">
        <div class="land-top">
          <div class="land-logo">SalesPal</div>
          <div class="land-top-right">
            <a class="land-view" onclick="salespalToggleTheme()">${document.documentElement.classList.contains("dark") ? icon("sun") + " Light" : icon("moon") + " Dark"}</a>
            <a class="land-view" onclick="salespalToggleView()">${document.body.classList.contains("desktop") ? icon("mobile") + " Mobile" : icon("desktop") + " Desktop"}</a>
            <a class="land-login" onclick="setAuthMode('login')">Log in</a>
          </div>
        </div>
        <h1>Grow your business from your phone.</h1>
        <p class="land-sub">Invoices, sales, profit &amp; AI advice — go Pro and unlock everything.</p>
      </header>

      <section class="land-section pricing-first">
        <h2>Choose your plan</h2>
        <p class="land-sub2">Unlimited invoices &amp; products, AI advice and weekly reports.</p>
        ${pricingCardsHtml(_pricing, { buy: true })}
        <div class="land-free">
          <button class="btn ghost" onclick="startFree()">Prefer to try first? Start free →</button>
          <div class="land-fine">Free includes core invoicing, sales &amp; expenses. Upgrade anytime — Pro simply lapses if you don't renew.</div>
 </div>
 </section>

 <section class="land-section">
 <h2>Everything you get</h2>
 <div class="feat-grid">
 ${features.map(([i, t, d]) => `
 <div class="feat">
 <div class="feat-i">${i}</div>
 <div class="feat-t">${t}</div>
 <div class="feat-d">${d}</div>
 </div>`).join("")}
 </div>
 </section>

 <footer class="land-foot">
 <button class="btn" onclick="document.querySelector('.pricing-first').scrollIntoView({behavior:'smooth'})">See plans ↑</button>
 <div class="land-foot-link">Already have an account? <a onclick="setAuthMode('login')">Log in</a></div>
 </footer>
 </div>`;
}

// Reusable pricing cards. opts: { ctaLabel, onClick(key) , payable }
function pricingCardsHtml(pricing, opts) {
 opts = opts || {};
 const plans = (pricing && pricing.plans) || [
 { key: "monthly", naira: "₦3,000", per: "/month", label: "Monthly" },
 { key: "yearly", naira: "₦30,000", per: "/year", label: "Yearly", save: "2 months free" },
 { key: "earlybird", naira: "₦20,000", per: "/year", label: "Early Bird", save: "Founding rate" },
 ];
 // Early Bird is the cheapest yearly rate, so it's the best value while slots
  // remain; once it sells out, Yearly takes over the "Best value" highlight.
  const eb = plans.find(p => p.key === "earlybird");
  const ebAvailable = eb && eb.available !== false;
  const bestKey = ebAvailable ? "earlybird" : "yearly";
  return `<div class="price-grid">${plans.map(p => {
    const soldOut = p.key === "earlybird" && p.available === false;
    const isBest = p.key === bestKey && !soldOut;
    const badge = soldOut ? `<span class="price-badge out">Sold out</span>`
      : isBest ? `<span class="price-badge best">Best value</span>`
      : (p.key === "earlybird" && typeof p.remaining === "number"
          ? `<span class="price-badge">${p.remaining} left</span>` : "");
    let save = p.save;
    if (p.key === "earlybird" && !soldOut && typeof p.remaining === "number") {
      save = `Founding rate · only ${p.remaining} left`;
    }
    const solid = isBest ? "" : "ghost";
    const cta = soldOut
      ? `<button class="btn ghost" disabled>Sold out</button>`
      : opts.payable
        ? `<button class="btn ${solid}" onclick="startCheckout('${p.key}')">Pay ${p.naira}</button>`
        : opts.buy
          ? `<button class="btn ${solid}" onclick="startBuy('${p.key}')">Get ${p.label}</button>`
          : `<button class="btn ${solid}" onclick="${opts.onClick || ""}">${opts.ctaLabel || "Choose"}</button>`;
    return `
      <div class="price-card ${isBest ? "featured" : ""} ${soldOut ? "sold" : ""}">
        ${badge}
        <div class="price-name">${p.label}</div>
        <div class="price-amt">${p.naira}<span>${p.per || ""}</span></div>
        ${save ? `<div class="price-save">${save}</div>` : ""}
        <ul class="price-feats">
          <li><svg class="ic"><use href="#i-ai"/></svg> AI advice &amp; reports</li>
          <li><svg class="ic"><use href="#i-sales"/></svg> Unlimited invoices</li>
          <li><svg class="ic"><use href="#i-products"/></svg> Unlimited products</li>
        </ul>
        ${cta}
      </div>`;
  }).join("")}</div>`;
}

function setAuthMode(m) { _authMode = m; renderAuth(); }
function toggleAuthMode() { setAuthMode(_authMode === "signup" ? "login" : "signup"); }

function _buyPlanInfo() {
  if (!_buyPlan) return null;
  const plans = (_pricing && _pricing.plans) || [];
  return plans.find(p => p.key === _buyPlan) || { label: "Pro", naira: "" };
}

// A password input with an eye button inside it. Typing a password blind on a
// phone keyboard is where most failed logins come from, so every password field
// gets the same toggle — including the current-password one, which had none.
function pwFieldHtml(id, placeholder, autocomplete, required) {
  return `<div class="pw-wrap">
    <input id="${id}" type="password" placeholder="${placeholder}"
      autocomplete="${autocomplete}"${required ? " required" : ""}>
    <button type="button" class="pw-eye" onclick="togglePw('${id}', this)"
      aria-label="Show password" aria-pressed="false" tabindex="-1"><svg class="ic"><use href="#i-eye"/></svg></button>
  </div>`;
}

// type="button" above keeps this from submitting the auth form when tapped.
function togglePw(id, btn) {
  const el = document.getElementById(id);
  if (!el) return;
  const show = el.type === "password";
  el.type = show ? "text" : "password";
  btn.setAttribute("aria-pressed", show ? "true" : "false");
  btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
  btn.innerHTML = `<svg class="ic"><use href="#i-${show ? "eye-off" : "eye"}"/></svg>`;
}

function renderAuth() {
  const mode = _authMode;                 // "signup" | "login" | "reset"
  const signup = mode === "signup";
  const reset = mode === "reset";
  const buy = _buyPlanInfo();             // set when a paid plan was picked on the landing
  const tagline = buy ? `You're getting <strong>${buy.label}</strong>`
 : signup ? "Create your free account"
 : reset ? "Reset your password" : "Welcome back";
 const btnLabel = buy ? `Continue to payment →`
 : signup ? "Create account" : reset ? "Set new password" : "Log in";
 const passLabel = reset ? "New password" : "Password";
 const passPh = signup || reset ? "At least 8 characters" : "Your password";
 app.innerHTML = `
 <div class="auth-wrap">
 <div class="auth-card">
 <div class="auth-logo">SalesPal</div>
 <div class="auth-tagline">${tagline}</div>
 ${buy ? `<div class="auth-buy">${buy.naira}${buy.per || ""} · secure payment by Paystack next</div>` : ""}
 <form onsubmit="doAuth(event)">
 ${signup ? `<div class="field"><label>Business name</label>
 <input id="auBiz" placeholder="e.g. Ada's Store" autocomplete="organization"></div>` : ""}
          <div class="field"><label>${signup || reset ? "Email" : "Email or username"}</label>
            <input id="auEmail" type="${signup || reset ? "email" : "text"}" placeholder="${signup || reset ? "you@email.com" : "email, or attendant username"}" autocomplete="username" required></div>
          ${reset ? `<div class="field"><label>Reset code</label>
            <input id="auCode" placeholder="Paste the code you were given" required></div>` : ""}
          <div class="field"><label>${passLabel}</label>
            ${pwFieldHtml("auPass", passPh, signup || reset ? "new-password" : "current-password", true)}
          </div>
          <div class="auth-err" id="auErr"></div>
          <button class="btn" type="submit" id="auBtn">${btnLabel}</button>
        </form>
        <div class="auth-switch">
          ${signup ? `Already have an account? <a onclick="setAuthMode('login')">Log in</a>`
            : reset ? `<a onclick="setAuthMode('login')">Back to log in</a>`
            : `New here? <a onclick="setAuthMode('signup')">Create one</a>
               <span class="auth-sep">·</span> <a onclick="setAuthMode('reset')">Forgot password?</a>`}
        </div>
        <div class="auth-switch"><a onclick="renderLanding()">← Back to home</a></div>
      </div>
    </div>`;
}

async function doAuth(ev) {
  ev.preventDefault();
  const errEl = document.getElementById("auErr");
  const btn = document.getElementById("auBtn");
  errEl.textContent = "";
  const mode = _authMode;
  const email = document.getElementById("auEmail").value.trim();
  const password = document.getElementById("auPass").value;
  btn.disabled = true;
  btn.textContent = mode === "signup" ? "Creating…" : mode === "reset" ? "Saving…" : "Logging in…";
  try {
    let path, body;
    if (mode === "signup") {
      path = "/api/auth/register";
      const attr = (window.salespalAttr && window.salespalAttr()) || {};
      body = { email, password, business_name: document.getElementById("auBiz").value.trim(),
               referrer: attr.referrer || "", utm_source: attr.utm_source || "",
               ref: attr.ref || "" };
    } else if (mode === "reset") {
      path = "/api/auth/reset";
      body = { email, token: document.getElementById("auCode").value.trim(), new_password: password };
    } else {
      path = "/api/auth/login";
      body = { email, password };
    }
    const user = await api.send(path, "POST", body);
    document.body.classList.remove("signed-out");
    // Buying from the landing: account is created/logged in → go straight to pay.
    if (_buyPlan && mode !== "reset") {
      const plan = _buyPlan; _buyPlan = null;
      await bootstrap(user);                 // load state (incl. plan) behind the scenes
      btn.textContent = "Opening payment…";
      await startCheckout(plan);             // redirects to Paystack; if it fails, falls through
      return;                                // we're either redirecting or already in the app
 }
 await bootstrap(user);
 if (user.referral_bonus) toast("\ud83c\udf81 1 month of Pro free \u2014 welcome!");
 setTimeout(maybePromptInstall, 800); // one-tap Add-to-Home-Screen offer
 } catch (e) {
 errEl.textContent = e.message || "Something went wrong";
 btn.disabled = false;
 btn.textContent = mode === "signup" ? "Create account" : mode === "reset" ? "Set new password" : "Log in";
 }
}

// ---------- one-tap "Add to Home Screen" (shown once, right after login) ----------
function maybePromptInstall() {
 if (document.body.classList.contains("signed-out")) return;
 let done = null;
 try { done = localStorage.getItem("salespal_install_prompt_done"); } catch (e) {}
 if (done) return;
 const st = window.salespalInstallState ? window.salespalInstallState() : "none";
 if (st === "installed") return;
 if (st === "none") {
 // Chrome may not have offered the install prompt yet — show when it does.
 window.salespalOnInstallReady = maybePromptInstall;
 return;
 }
 try { localStorage.setItem("salespal_install_prompt_done", "1"); } catch (e) {}
 const ios = st === "ios";
 openModal(`
 <div style="text-align:center">
 <img src="/icons/icon-192.png" alt="" width="64" height="64" style="border-radius:16px" />
 <h2 style="margin:12px 0 6px">Put SalesPal on your home screen</h2>
 <p style="color:var(--muted);font-size:14px;margin:0 0 16px">
 Opens in one tap like a normal app — full screen, works offline.</p>
 ${ios
 ? `<div class="card" style="text-align:left;font-size:14px;margin-bottom:12px">
 1. Tap the <b>Share</b> button <span style="opacity:.7">(square with ↑)</span><br/>
 2. Choose <b>&ldquo;Add to Home Screen&rdquo;</b></div>
 <button class="btn" id="instOk">Got it</button>`
 : `<button class="btn" id="instGo">Add to Home Screen</button>`}
 <button class="btn ghost" id="instLater" style="margin-top:10px">Maybe later</button>
 </div>`);
 const go = document.getElementById("instGo");
 if (go) go.onclick = async () => {
 closeModal();
 const ok = await (window.salespalInstall ? window.salespalInstall() : false);
 if (ok) toast("SalesPal added to your home screen");
 };
 const okBtn = document.getElementById("instOk");
 if (okBtn) okBtn.onclick = closeModal;
 const later = document.getElementById("instLater");
 if (later) later.onclick = closeModal;
}

function isPro() { return !!(state.plan && state.plan.is_pro); }

let _paywallPlan = null; // plan key selected inside the paywall sheet

// Context-aware hero: lead with the strongest true fact we have about THIS
// account, so the pitch is personal (their money / their usage), not generic.
function _paywallHero(reason) {
 const pl = state.plan || {}, u = pl.usage || {}, lim = pl.limits || {};
 const owed = Number(u.outstanding_total || 0);
 if (owed >= 1000) return {
 kicker: "You're currently owed",
    big: money0(owed),
    sub: "Pro gets you one-tap WhatsApp reminders so your customers pay you faster.",
  };
  if (lim.invoices_per_month && u.invoices_this_month >= lim.invoices_per_month) return {
    kicker: "This month",
    big: `${u.invoices_this_month} of ${lim.invoices_per_month} invoices`,
    sub: "You've reached the free limit. Go Pro for unlimited invoices and receipts.",
 };
 if (lim.products && u.products >= lim.products) return {
 kicker: "Your products",
 big: `${u.products} of ${lim.products}`,
 sub: "You've reached the free limit. Go Pro for unlimited products.",
  };
  return {
    kicker: "SalesPal Pro",
    big: "Do more, earn more",
    sub: reason && reason !== "__upgrade__" ? reason
      : "Unlock everything you need to grow your business from your phone.",
  };
}

// The best-value plan (early bird while slots last, else yearly) is the one we
// pre-select and lead the CTA with.
function _bestPlan() {
  const plans = (state.plan && state.plan.pricing && state.plan.pricing.plans) || [];
  const eb = plans.find(p => p.key === "earlybird");
  if (eb && eb.available !== false) return eb;
  return plans.find(p => p.key === "yearly") || plans.find(p => p.key === "monthly") || null;
}

function _planRow(p, selected) {
  if (!p) return "";
  const perMonth = /year/i.test(p.per || "") ? ` · about ${money0(_yearlyPerMonth(p))}/month` : "";
  const save = p.key === "earlybird" && typeof p.remaining === "number"
    ? `Founding rate · only ${p.remaining} left` : (p.save || "");
  return `<button class="pw-plan ${selected ? "sel" : ""}" onclick="paywallSelect('${p.key}')">
    <span class="pw-radio"></span>
    <span class="pw-plan-main">
      <span class="pw-plan-name">${esc(p.label)}</span>
      <span class="pw-plan-sub">${esc(p.naira)}${esc(p.per || "")}${perMonth}</span>
      ${save ? `<span class="pw-plan-save">${esc(save)}</span>` : ""}
    </span>
  </button>`;
}

// Rough monthly-equivalent from a yearly price string like "₦20,000" → 20000/12.
function _yearlyPerMonth(p) {
  const n = Number(String(p.naira).replace(/[^\d.]/g, "")) || 0;
  return Math.round(n / 12);
}

function showUpgrade(reason) {
  closeModal();
  const canPay = !!(state.plan && state.plan.billing_enabled);
  if (!canPay) {
    const msg = reason && reason !== "__upgrade__" ? reason : "";
    openModal(`
      <h2><svg class="ic"><use href="#i-star"/></svg> SalesPal Pro</h2>
      ${msg ? `<p style="color:var(--muted);font-size:14px;margin:0 0 14px">${esc(msg)}</p>` : ""}
      <div class="card"><ul class="pro-list">
        <li><svg class="ic"><use href="#i-ai"/></svg> AI advice &amp; weekly reports</li>
        <li><svg class="ic"><use href="#i-sales"/></svg> Unlimited invoices</li>
        <li><svg class="ic"><use href="#i-products"/></svg> Unlimited products</li>
      </ul></div>
      <p style="font-size:13px;color:var(--muted);text-align:center;margin:0 0 12px"><svg class="ic"><use href="#i-card"/></svg> In-app payment is coming soon — you'll be able to upgrade right here.</p>
 <button class="btn" onclick="closeModal()">Got it</button>`);
 return;
 }
 const best = _bestPlan();
 const plans = (state.plan.pricing && state.plan.pricing.plans) || [];
 const monthly = plans.find(p => p.key === "monthly");
 _paywallPlan = best ? best.key : "monthly";
 const h = _paywallHero(reason);
 // Show the best plan first, then monthly as the alternate (skip plain yearly
 // when early bird is the cheaper yearly rate — it's redundant).
  const altRows = (best && monthly && best.key !== "monthly") ? _planRow(monthly, false) : "";
  openModal(`
    <div class="pw-hero">
      <button class="pw-close" onclick="closeModal()" aria-label="Close"><svg class="ic"><use href="#i-close"/></svg></button>
      <div class="pw-badge">SALESPAL PRO</div>
      <div class="pw-kicker">${esc(h.kicker)}</div>
      <div class="pw-big">${h.big}</div>
      <div class="pw-sub">${esc(h.sub)}</div>
    </div>
    <div class="pw-body">
      <ul class="pw-benefits">
        <li><span class="pw-check">✓</span>Unlimited invoices and receipts</li>
        <li><span class="pw-check">✓</span>WhatsApp payment reminders</li>
        <li><span class="pw-check">✓</span>Profit and expense insights</li>
        <li><span class="pw-check">✓</span>Voice sale entry — speak, don't type</li>
 <li><span class="pw-check">✓</span>Multiple shops and staff logins</li>
 </ul>
 <div class="pw-plans">
 ${_planRow(best, true)}
 ${altRows}
 </div>
 <button class="btn pw-cta" id="pwCta" onclick="paywallCheckout()"></button>
 <p class="pw-reassure">Card, bank transfer or USSD · cancel anytime</p>
 <button class="pw-later" onclick="closeModal()">Maybe later</button>
 </div>`, "paywall");
 _paywallUpdateCta();
}

function paywallCheckout() { startCheckout(_paywallPlan || "monthly"); }

function paywallSelect(key) {
 _paywallPlan = key;
 document.querySelectorAll(".pw-plan").forEach(el => {
 el.classList.toggle("sel", el.getAttribute("onclick").includes(`'${key}'`));
 });
 _paywallUpdateCta();
}

function _paywallUpdateCta() {
 const plans = (state.plan && state.plan.pricing && state.plan.pricing.plans) || [];
 const p = plans.find(x => x.key === _paywallPlan);
 const cta = document.getElementById("pwCta");
 if (cta && p) cta.textContent = `Start Pro — ${p.naira}${p.per || ""}`;
}

// After a free user records a sale (highest-intent moment), show the paywall
// once — never again on this device once seen or once they're Pro.
function maybePaywallAfterSale() {
  if (isPro() || !(state.plan && state.plan.billing_enabled)) return;
  try {
    if (localStorage.getItem("salespal_seen_paywall")) return;
    localStorage.setItem("salespal_seen_paywall", "1");
  } catch (e) { return; }
  setTimeout(() => { if (!isPro()) showUpgrade(); }, 800);
}

async function startCheckout(plan) {
  plan = plan || "monthly";
  const btns = document.querySelectorAll(".price-card .btn");
  btns.forEach(b => { b.disabled = true; });
  try {
    const r = await api.send("/api/billing/checkout", "POST", { plan });
    window.location.href = r.authorization_url;
  } catch (e) {
    if (e.message === "__upgrade__" || e.message === "__auth__") return;
    toast(e.message || "Couldn't start payment");
 btns.forEach(b => { b.disabled = false; });
 }
}

async function handlePaymentReturn() {
 const params = new URLSearchParams(location.search);
 if (!params.get("paid")) return;
 const ref = params.get("reference") || params.get("trxref");
 history.replaceState({}, "", location.pathname); // clean the URL
 if (!ref) return;
 try {
 const info = await api.get("/api/billing/verify?reference=" + encodeURIComponent(ref));
 state.plan = info;
 if (info.paid) {
 // Pro was just applied by the verify call above — but bootstrap already
 // loaded the Pro-gated state (e.g. /api/shops can_add=false) a moment
 // earlier, before payment landed. Drop the cache and reload it so
 // multi-shop and other Pro features unlock now, without a manual refresh.
 apiCacheClear();
 await loadShops();
 const until = info.plan_expires_at ? fmtDate(info.plan_expires_at) : "";
 openModal(`<h2>You're on Pro!</h2>
        <p style="font-size:15px;margin:0 0 14px">Thanks for upgrading. AI insights and unlimited invoices are unlocked${until ? ` until <strong>${until}</strong>` : ""}.</p>
        <button class="btn" onclick="closeModal()">Start using Pro</button>`);
      render();
    } else {
      toast("Payment wasn't completed");
 }
 } catch (e) { /* ignore */ }
}

async function bootstrap(user, prefetch) {
 // The page loads with body.signed-out (dashboard chrome hidden) — reveal it
 // only now that the server has confirmed a valid session.
 document.body.classList.remove("signed-out");
 state.me = user;
 if (user.is_attendant) return bootstrapAttendant(user, prefetch);
 document.getElementById("bizName").textContent = user.business_name || "SalesPal";
 // Consume the requests init() already kicked off in parallel (fall back to a
 // fresh fetch if bootstrap was called directly, e.g. right after login).
 prefetch = prefetch || {};
 state.settings = (await prefetch.settings) || await api.get("/api/settings").catch(() => state.settings);
 state.plan = (await prefetch.plan) || await api.get("/api/plan").catch(() => state.plan);
 state.pay = (await prefetch.pay) || await api.get("/api/pay/status").catch(() => state.pay);
 state.orders = (await prefetch.orders) || await api.get("/api/orders/status").catch(() => state.orders);
 const adminNav = document.getElementById("adminNav");
 if (adminNav) adminNav.style.display = (state.plan && state.plan.is_owner) ? "block" : "none";
 // Keep this device's push subscription fresh (silent → never prompts, it only
 // re-registers where permission is already granted). Not gated on orders:
 // overdue nudges go to Pro accounts that never opened a storefront.
  pushSubscribe(true);
  await loadShops(await prefetch.shops);
  state.view = "home";
  document.querySelectorAll(".bottom-nav button").forEach(b =>
    b.classList.toggle("active", b.dataset.nav === "home"));
  render();
  _consumeDeepLink();
}

// A push notification can deep-link into a view (the overdue nudge →
// Sales filtered to Overdue). Consume the hash once, then clear it.
function _consumeDeepLink() {
  if (location.hash === "#sales/overdue") {
    history.replaceState({}, "", location.pathname);
    salesStatus = "overdue";
    setView("sales");
  }
  if (location.hash === "#new") { // hustle nudge → straight into recording a sale
    history.replaceState({}, "", location.pathname);
    newSaleModal();
  }
}

// ================= SHOP ATTENDANT (limited login) =========================
// A stripped-down app for shop staff: record sales (with payment mode) and see
// stock — no profit, insights, settings, or shop switching. The backend also
// hard-enforces this (deny-by-default allowlist), so this is UX, not security.
let _payMode = "cash";

async function bootstrapAttendant(user, prefetch) {
  document.body.classList.add("attendant");
  state.settings = (prefetch && await prefetch.settings) || await api.get("/api/settings").catch(() => ({})) || {};
  document.getElementById("bizName").textContent = user.business_name || "SalesPal";
  const sub = document.getElementById("periodLabel");
  if (sub) sub.textContent = `${user.shop_name || ""} · ${user.staff_name || "Attendant"}`;
  const tabs = document.getElementById("periodTabs"); if (tabs) tabs.style.display = "none";
  const bn = document.getElementById("bizName"); bn.onclick = null; bn.style.cursor = "default";
  const mb = document.getElementById("menuBtn"); if (mb) mb.style.display = "none";
  // Rebuild the bottom nav for the attendant's four actions + a quick logout.
 const nav = document.querySelector(".bottom-nav");
 nav.innerHTML = `
 <button data-nav="home" class="active"><span></span>Home</button>
 <button data-nav="sales"><span></span>Sales</button>
 <button data-nav="new" class="fab"><span>＋</span></button>
 <button data-nav="stock"><span></span>Stock</button>
 <button data-nav="logout"><span></span>Log out</button>`;
 nav.querySelectorAll("button").forEach(b => {
 b.onclick = () => {
 if (b.dataset.nav === "new") return attendantSaleModal();
 if (b.dataset.nav === "logout") return logout();
 attendantSetView(b.dataset.nav);
 };
 });
 state.view = "home";
 renderAttendant();
}

function attendantSetView(v) {
 if (v === "new") return attendantSaleModal();
 if (v === "logout") return logout();
 state.view = v;
 document.querySelectorAll(".bottom-nav button").forEach(b =>
 b.classList.toggle("active", b.dataset.nav === v));
 renderAttendant();
}

async function renderAttendant() {
 app.innerHTML = SKELETON;
 try {
 const r = ({ home: viewAttendantHome, sales: viewSales, stock: viewStock })[state.view] || viewAttendantHome;
 await r();
 } catch (e) {
 if (e.message === "__auth__" || e.message === "__upgrade__") return;
 app.innerHTML = `<div class="card"><div class="empty"><br>${esc(e.message)}</div></div>`;
 }
}

async function viewAttendantHome() {
 const invoices = await api.get("/api/invoices");
 const today = new Date().toISOString().slice(0, 10);
 const todays = invoices.filter(i => (i.date || "").slice(0, 10) === today);
 const collected = todays.reduce((s, i) => s + (i.total - (i.balance || 0)), 0);
 app.innerHTML = `
 <div class="card" style="text-align:center">
 <div style="font-size:13px;color:var(--muted)">${esc(state.me.shop_name || "")} · ${esc(state.me.staff_name || "Attendant")}</div>
 <button class="btn" style="margin:14px 0 2px;font-size:17px;padding:16px" onclick="attendantSaleModal()">＋ Record a sale</button>
 </div>
 <div class="kpi-grid">
 <div class="kpi"><div class="label">Today's sales</div><div class="value">${todays.length}</div></div>
      <div class="kpi"><div class="label">Collected today</div><div class="value">${money(collected)}</div></div>
    </div>
    <div class="card"><div class="section-title">Today's sales</div>
 ${todays.length ? todays.map(i => `
 <div class="list-row" onclick="attendantInvoice(${i.id})">
 <div style="flex:1;min-width:0"><div class="main">${esc(i.customer_name || "Walk-in")}</div>
 <div class="meta">${i.invoice_no} · ${fmtDate(i.date)}</div></div>
 <div style="text-align:right"><div class="amount">${money(i.total)}</div>
 <span class="badge ${i.status}">${i.status}</span></div>
 </div>`).join("") : `<div class="empty">No sales yet today. Tap ＋ to record one.</div>`}
 </div>`;
}

async function viewStock() {
 const products = await api.get("/api/products");
 app.innerHTML = `<div class="card"><div class="section-title">Stock</div>
 ${products.length ? products.map(p => {
 const low = p.low_stock_at > 0 && p.stock_qty <= p.low_stock_at;
 return `<div class="list-row">
 <div style="flex:1;min-width:0"><div class="main">${esc(p.name)} ${low ? '<span class="badge unpaid">low</span>' : ""}</div>
 <div class="meta">Price ${money(p.unit_price)}</div></div>
 <div class="amount ${low ? "neg" : ""}">${(+p.stock_qty).toLocaleString()} left</div></div>`;
 }).join("") : `<div class="empty"><div class="big"></div>No products yet</div>`}
 </div>`;
}

async function attendantSaleModal() {
 saleItems = [];
 const products = await api.get("/api/products");
 window._products = products;
 if (!products.length) { toast("No products yet — ask the owner to add stock"); return; }
 _payMode = "cash";
 openModal(`
 <h2>Record a sale</h2>
 <div class="field"><label>Customer (optional)</label>
 <input id="saleCustomer" placeholder="Name, or leave blank for walk-in"></div>
 <div class="section-title">Items</div>
 <div id="saleItems"></div>
 <button class="btn outline btn-sm" style="margin-bottom:12px" onclick="addProductItem()">＋ Add item</button>
 <div class="card" style="background:var(--tint)"><div class="list-row"><div class="main">Total</div>
 <div class="amount" id="saleTotal">${money(0)}</div></div></div>
 <div class="section-title">Payment</div>
 <div class="seg" id="payMode">
 <button data-mode="cash" class="active" onclick="setPayMode('cash')">Cash</button>
 <button data-mode="transfer" onclick="setPayMode('transfer')">Transfer</button>
 <button data-mode="owing" onclick="setPayMode('owing')">Owing</button>
 </div>
 <button class="btn" style="margin-top:14px" onclick="attendantSaveSale()">Save sale</button>`);
 addProductItem();
}

function setPayMode(m) {
 _payMode = m;
 document.querySelectorAll("#payMode button").forEach(b => b.classList.toggle("active", b.dataset.mode === m));
}

async function attendantSaveSale() {
 const items = saleItems.filter(it => it.product_id && it.qty > 0);
 if (!items.length) return toast("Add at least one item");
 const customer_name = document.getElementById("saleCustomer").value.trim();
 const owing = _payMode === "owing"; // no payment → no receipt to offer
 const total = items.reduce((s, it) => s + it.qty * it.unit_price, 0);
 let res;
 try {
 // Bundle the payment into the sale (one request) so it also works offline:
 // the queue never holds a payment that points at a not-yet-synced invoice.
 res = await api.send("/api/invoices", "POST", {
 customer_name: customer_name || null,
 // unit_cost is ignored server-side for attendants (refilled from product)
 items: items.map(it => ({ product_id: it.product_id, description: it.description,
 qty: it.qty, unit_price: it.unit_price, unit_cost: 0 })),
 payment: owing ? null : { amount: total, method: _payMode === "cash" ? "Cash" : "Transfer" },
 });
 } catch (e) { if (e.message !== "__auth__" && e.message !== "__upgrade__") toast(e.message || "Couldn't save"); return; }
  closeModal();
  _payMode = "cash";
  const pending = res.invoice_no === "Pending";
  toast(pending ? "Sale saved offline — will sync when you're back online" : `Sale saved · ${res.invoice_no}`);
 if (!owing && !pending) receiptOffer(res.id); // receipt image needs the server
 render();
}

async function attendantInvoice(id) {
 if (id < 0) { toast("This sale opens once it syncs online"); return; }
 openModal(`<div class="loading">Loading…</div>`);
 let inv;
 try { inv = await api.get(`/api/invoices/${id}`); }
 catch (e) { if (e.message === "__auth__" || e.message === "__upgrade__") { closeModal(); return; } closeModal(); toast(e.message || "Couldn't load"); return; }
  const items = (inv.items || []).map(it => `<div class="list-row">
      <div style="flex:1;min-width:0"><div class="main">${esc(it.description)}</div>
        <div class="meta">${it.qty} × ${money(it.unit_price)}</div></div>
      <div class="amount">${money(it.qty * it.unit_price)}</div></div>`).join("");
  const owing = inv.balance > 0.01;
  updateModal(`<h2>${esc(inv.customer_name || "Walk-in")}</h2>
    <p style="font-size:13px;color:var(--muted);margin:-6px 0 12px">${inv.invoice_no} · ${fmtDate(inv.date)}</p>
    ${items}
    <div class="list-row" style="border-top:1px solid var(--line);margin-top:4px">
      <div class="main"><strong>Total</strong></div><div class="amount"><strong>${money(inv.total)}</strong></div></div>
    ${owing ? `<div class="list-row"><div class="main neg">Balance owing</div><div class="amount neg">${money(inv.balance)}</div></div>
      <div class="section-title">Mark paid</div>
      <div class="btn-row">
        <button class="btn" onclick="attendantPay(${id},${inv.balance},'Cash')"><svg class="ic"><use href="#i-cash"/></svg> Cash</button>
        <button class="btn secondary" onclick="attendantPay(${id},${inv.balance},'Transfer')"><svg class="ic"><use href="#i-bank"/></svg> Transfer</button>
      </div>`
      : `<div style="margin:8px 0"><span class="badge paid">Paid</span></div>`}
    <button class="btn outline" style="margin-top:14px" onclick="shareReceipt(${id},'png')"><svg class="ic"><use href="#i-send"/></svg> Send receipt</button>
    <button class="btn ghost" style="margin-top:10px" onclick="closeModal()">Close</button>`);
}

async function attendantPay(id, amount, method) {
  try { await api.send(`/api/invoices/${id}/payments`, "POST", { amount, method }); }
  catch (e) { if (e.message !== "__auth__" && e.message !== "__upgrade__") toast(e.message || "Couldn't record"); return; }
 closeModal();
 if (navigator.onLine && id > 0) { toast(`Marked paid (${method}) ✓`); receiptOffer(id); }
 else toast("Payment saved offline — syncs when you're online");
  render();
}

// ---------- shops (multi-shop switcher) ----------
async function loadShops(prefetched) {
  try {
    const r = prefetched || await api.get("/api/shops");
    if (!r) throw new Error("no shops");
    state.shops = r.shops || [];
    state.activeShop = r.active_shop_id || 0;
    state.canAddShop = !!r.can_add;
  } catch (e) { state.shops = []; state.activeShop = 0; state.canAddShop = false; }
  updateShopBar();
}

function activeShopName() {
  if (!state.activeShop) return "All shops";
  const s = (state.shops || []).find(x => x.id === state.activeShop);
  return s ? s.name : (state.settings.business_name || "My Shop");
}

function updateShopBar() {
  const el = document.getElementById("bizName");
  if (!el) return;
  el.innerHTML = esc(activeShopName()) + ' <span class="shop-caret">▾</span>';
  el.onclick = shopSwitcher;
  el.style.cursor = "pointer";
}

function shopSwitcher() {
  const shops = state.shops || [];
  const rows = shops.map(s => `
    <button class="shop-opt ${s.id === state.activeShop ? "active" : ""}" onclick="switchShop(${s.id})">
      <span><svg class="ic"><use href="#i-store"/></svg> ${esc(s.name)}</span>${s.id === state.activeShop ? '<span class="shop-check">✓</span>' : ""}
    </button>`).join("");
  const allOpt = shops.length > 1 ? `
    <button class="shop-opt ${!state.activeShop ? "active" : ""}" onclick="switchShop(0)">
      <span><svg class="ic"><use href="#i-admin"/></svg> All shops (overview)</span>${!state.activeShop ? '<span class="shop-check">✓</span>' : ""}
    </button>` : "";
  openModal(`
    <h2>Your shops</h2>
    <div class="shop-list">${rows}${allOpt}</div>
    <button class="btn" onclick="addShop()"><svg class="ic"><use href="#i-plus"/></svg> Add a shop${state.canAddShop ? "" : " (Pro)"}</button>`);
}

async function switchShop(id) {
  try { await api.send("/api/shops/active", "POST", { shop_id: id }); }
  catch (e) { if (e.message !== "__upgrade__") toast(e.message); return; }
  state.activeShop = id;
  closeModal(); updateShopBar(); render();
}

async function addShop() {
  if (!state.canAddShop) { closeModal(); showUpgrade("Running multiple shops is a Pro feature — one login, all your businesses."); return; }
  const name = prompt("Name your new shop (e.g. Second Branch):");
  if (name === null) return;
  try {
    const r = await api.send("/api/shops", "POST", { name: (name || "").trim() });
    await loadShops();
    state.activeShop = r.id; updateShopBar();
    closeModal(); render(); toast("Shop added");
  } catch (e) { if (e.message !== "__upgrade__") toast(e.message); }
}

// New data always belongs to a specific shop; block creation in All-shops view.
function requireShop() {
  if (state.activeShop) return true;
  toast("Pick a shop to add to");
  shopSwitcher();
  return false;
}

async function logout() {
  try { await api.send("/api/auth/logout", "POST"); } catch (e) { /* ignore */ }
  location.reload();
}

// ---------- navigation ----------
function setView(v) {
  if (state.me && state.me.is_attendant) return attendantSetView(v);
  state.view = v;
  document.querySelectorAll(".bottom-nav button").forEach(b =>
    b.classList.toggle("active", b.dataset.nav === v));
  document.getElementById("menuSheet").classList.remove("open");
  render();
}

document.querySelectorAll(".bottom-nav button").forEach(b => {
  b.onclick = () => { if (b.dataset.nav === "new") return newSaleModal(); setView(b.dataset.nav); };
});
document.getElementById("menuBtn").onclick = () =>
  document.getElementById("menuSheet").classList.toggle("open");

// The drawer's open state lives in one place: .open on the sheet. Seven call
// sites already toggle it (nav, theme, view switch, logout…), so mirror it onto
// the backdrop and the scroll lock here instead of editing every one of them.
// Observing the node survives the desktop/mobile re-parenting.
(function () {
  const sheet = document.getElementById("menuSheet");
  const back = document.getElementById("menuBackdrop");
  if (!sheet || !back) return;
  const close = () => sheet.classList.remove("open");
  const sync = () => {
    const open = sheet.classList.contains("open");
    back.classList.toggle("open", open);
    document.body.classList.toggle("menu-open", open);
  };
  new MutationObserver(sync).observe(sheet, { attributes: true, attributeFilter: ["class"] });
  back.onclick = close;
  const x = document.getElementById("menuClose");
  if (x) x.onclick = close;
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sheet.classList.contains("open")) close();
  });
  sync();
})();
// Only nav buttons switch views; #viewToggle / #installBtn keep their own handlers.
document.querySelectorAll(".menu-sheet button[data-nav]").forEach(b =>
  b.onclick = () => setView(b.dataset.nav));

document.querySelectorAll("#periodTabs button").forEach(b => {
  b.onclick = () => {
    state.period = b.dataset.period;
    document.querySelectorAll("#periodTabs button").forEach(x => x.classList.toggle("active", x === b));
    document.getElementById("periodLabel").textContent = PERIOD_LABELS[state.period];
    if (state.view === "home" || state.view === "insights") render();
  };
});

// ---------- render router ----------
// Shimmer placeholder shown while a view loads (replaces a bare "Loading…").
const SKELETON = `<div class="skeleton" aria-busy="true"><span class="sr-only">Loading</span>
  <div class="sk-grid"><div class="sk sk-kpi tall"></div><div class="sk sk-kpi"></div>
    <div class="sk sk-kpi"></div><div class="sk sk-kpi"></div></div>
  <div class="sk sk-card"></div><div class="sk sk-card"></div></div>`;

async function render() {
  if (state.me && state.me.is_attendant) return renderAttendant();
  app.innerHTML = SKELETON;
  try {
    const r = ({ home: viewHome, sales: viewSales, money: viewMoney,
      insights: viewInsights, products: viewProducts, customers: viewCustomers,
      orders: viewOrders, suppliers: viewSuppliers, settings: viewSettings, admin: viewAdmin })[state.view] || viewHome;
    await r();
  } catch (e) {
    if (e.message === "__auth__" || e.message === "__upgrade__") return; // overlay already shown
    app.innerHTML = `<div class="card"><div class="empty"><svg class="ic"><use href="#i-warn"/></svg><br>${esc(e.message)}</div></div>`;
  }
}

// ---------- ADMIN (owner-only usage dashboard) ----------
async function viewAdmin() {
  const s = await api.get("/api/admin/stats");
  const stat = (label, val, sub) => `
    <div class="kpi"><div class="label">${label}</div><div class="value">${val}</div>${sub ? `<div class="sub">${sub}</div>` : ""}</div>`;
  const srcLabel = { search: "Search", social: "Social", direct: "↗ Direct",
                     unknown: "• Unknown" };
  const label = (k) => srcLabel[k] || ("" + k);
  const totalSrc = (s.sources || []).reduce((a, x) => a + x.count, 0) || 1;
  const srcRows = (s.sources || []).map(x => {
    const pct = Math.round((x.count / totalSrc) * 100);
    return `<div class="list-row">
      <div><div class="main">${esc(label(x.source))}</div>
        <div class="meta">${pct}% of signups</div></div>
      <div class="amount">${x.count}</div>
    </div>`;
  }).join("") || `<div class="empty">No signups yet</div>`;
  const rows = (s.recent || []).map(u => `
    <div class="list-row">
      <div><div class="main">${esc(u.business_name || "—")}</div>
        <div class="meta">${esc(u.email)} · joined ${fmtDate(u.created_at)}${u.signup_source ? " · " + esc(label(u.signup_source)) : ""}</div></div>
      <div style="text-align:right">
        <span class="badge ${u.plan === "pro" ? "paid" : "unpaid"}">${u.plan}</span>
        <div class="meta">${u.last_login_at ? "seen " + fmtDate(u.last_login_at) : "never"}</div></div>
    </div>`).join("") || `<div class="empty">No accounts yet</div>`;
  app.innerHTML = `
    <div class="section-title">Accounts</div>
    <div class="kpi-grid">
      ${stat("Total accounts", s.total_accounts)}
      ${stat("Have signed in", s.signed_in_accounts)}
      ${stat("Pro (paying)", s.pro_accounts)}
      ${stat("Active this week", s.active_7d, "logged in ≤7 days")}
    </div>
    <div class="kpi-grid">
      ${stat("New signups (7d)", s.signups_7d)}
      ${stat("New signups (30d)", s.signups_30d)}
      ${stat("Total shops", s.total_shops)}
      ${stat("Total invoices", s.total_invoices)}
    </div>
    ${activationFunnelHtml(s.funnel)}
    <div class="card"><div class="section-title">Where signups come from</div>${srcRows}</div>
    <div class="card"><div class="section-title">Recent signups</div>${rows}</div>
    <div class="card"><div class="section-title"><svg class="ic"><use href="#i-save"/></svg> Backup</div>
      ${backupNudge(s.last_backup_at)}
      <p style="font-size:13px;color:var(--muted);margin:0 0 10px">Download a full copy of the database (every account, all data). Do this weekly and keep it somewhere safe — it's the only way to recover if the server's disk is lost.</p>
      <div class="btn-row">
        <a class="btn secondary" href="/api/admin/backup" download><svg class="ic"><use href="#i-download"/></svg> Download backup</a>
        <button class="btn outline" onclick="backupTest(this)"><svg class="ic"><use href="#i-send"/></svg> Send off-box copy</button>
      </div></div>`;
}
// Activation funnel over real customers (owner excluded server-side). The gap
// between "signed up" and "made a first invoice" is the number that matters:
// people who never record a sale never come back.
function activationFunnelHtml(f) {
  if (!f) return "";
  const total = f.accounts || 0;
  const pct = (v) => total ? Math.round((v / total) * 100) : 0;
  const bar = (v) => `<div style="height:8px;background:var(--line);border-radius:6px;margin-top:6px;overflow:hidden">
    <div style="height:100%;width:${pct(v)}%;background:var(--indigo)"></div></div>`;
  const row = (lbl, v, note) => `<div class="list-row" style="align-items:center">
    <div style="flex:1;min-width:0"><div class="main">${lbl}${note ? ` <span class="meta" style="font-weight:400">· ${note}</span>` : ""}</div>${bar(v)}</div>
    <div style="text-align:right;margin-left:14px"><div class="amount">${v}</div><div class="meta">${pct(v)}%</div></div>
  </div>`;
  const recentPct = f.signups_30d ? Math.round((f.activated_30d / f.signups_30d) * 100) : 0;
  return `<div class="card"><div class="section-title"><svg class="ic"><use href="#i-insights"/></svg> Activation funnel</div>
    <p style="font-size:13px;color:var(--muted);margin:0 0 12px">Real customers only (your own account is left out). Every step is a % of everyone who signed up.</p>
    ${row("Signed up", total)}
    ${row("Made a first invoice", f.activated, "recorded any sale")}
    ${row("Sold this week", f.selling_7d, "a sale in the last 7 days")}
    ${row("Paying (Pro)", f.paying)}
    <p style="font-size:13px;margin:12px 0 0"><strong>${f.activated_30d}</strong> of <strong>${f.signups_30d}</strong> who joined in the last 30 days recorded a sale${f.signups_30d ? ` (${recentPct}%)` : ""}. ${f.activated < total / 2 && total >= 4 ? "Most signups never record a first sale — that first-invoice step is where to focus." : ""}</p>
  </div>`;
}

// Ship a backup to the Telegram bot right now — proves the nightly path works
// (or says exactly why it doesn't) without waiting until 02:00.
async function backupTest(btn) {
  btn.disabled = true;
  try {
    await api.send("/api/admin/backup/test", "POST");
    toast("Backup sent — check your Telegram");
    render();
  } catch (e) { toast(e.message || "Backup send failed"); }
  finally { btn.disabled = false; }
}
// Warning when the last backup is stale (>7 days) or was never taken.
function backupNudge(at) {
  const days = at ? Math.floor((Date.now() - new Date(at)) / 86400000) : null;
  if (days !== null && days <= 7)
    return `<p style="font-size:13px;margin:0 0 10px" class="pos"><svg class="ic"><use href="#i-check-circle"/></svg> Last backup: ${days === 0 ? "today" : days + " day" + (days > 1 ? "s" : "") + " ago"}</p>`;
  return `<p style="font-size:13px;margin:0 0 10px" class="neg"><svg class="ic"><use href="#i-warn"/></svg> ${at ? `Last backup was ${days} days ago` : "No backup has ever been taken"} — download one now.</p>`;
}

// ---------- HOME / dashboard ----------
// Initials for the avatar circle on sale rows ("Chidi Okafor" → "CO").
function _initials(name) {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  return (parts[0][0] + (parts[1] ? parts[1][0] : "")).toUpperCase();
}

const PERIOD_LABELS = { week: "Last 7 days", month: "Last 30 days", year: "This year", all: "All time" };

async function viewHome() {
  const [d, products, invoices, claims, orders, customers] = await Promise.all([
    api.get(`/api/dashboard?period=${state.period}`),
    api.get("/api/products"),
    api.get("/api/invoices").catch(() => []),
    (state.pay && state.pay.transfer_enabled) ? api.get("/api/pay/claims/pending").catch(() => []) : Promise.resolve([]),
    (state.orders && state.orders.enabled) ? api.get("/api/orders/pending").catch(() => []) : Promise.resolve([]),
    api.get("/api/customers").catch(() => []),
  ]);
  const todayStr = new Date().toISOString().slice(0, 10);
  const todays = (invoices || []).filter(i => (i.date || "").slice(0, 10) === todayStr).slice(0, 5);
  // The debt book: who owes, combined per customer, biggest first (API-sorted).
  // Capped so the dashboard stays a dashboard; the Owed tab has the full list.
  const debtors = (customers || []).filter(c => Number(c.owed) > 0.01);
  const owedTotal = debtors.reduce((s, c) => s + Number(c.owed), 0);
  app.innerHTML = `
    <div class="hero">
      <div class="hero-label">Net profit · ${PERIOD_LABELS[state.period] || "Last 30 days"}</div>
      <div class="hero-amt">${money0(d.net_profit)}</div>
      <div class="hero-chip ${d.net_profit < 0 ? "neg" : ""}">${d.net_profit < 0 ? "▼" : "▲"} ${d.margin_pct}% margin · ${d.num_sales} sale${d.num_sales === 1 ? "" : "s"}</div>
    </div>
    <div class="overlap-stats">
      <div><div class="os-label">Revenue</div><div class="os-value">${moneyShort(d.revenue)}</div></div>
      <div><div class="os-label">Collected</div><div class="os-value">${moneyShort(d.collected)}</div></div>
      <div onclick="openOwed()" style="cursor:pointer"><div class="os-label">Owed</div><div class="os-value ${d.outstanding > 0 ? "warn" : ""}">${moneyShort(d.outstanding)}</div></div>
    </div>
    <div class="quick-acts">
      <button class="qa" onclick="newSaleModal()"><span class="qa-i">＋</span>New sale</button>
      <button class="qa" onclick="expenseModal()"><span class="qa-i"><svg class="ic"><use href="#i-sales"/></svg></span>Expense</button>
      <button class="qa" onclick="setView('products')"><span class="qa-i"><svg class="ic"><use href="#i-products"/></svg></span>Stock</button>
      <button class="qa" onclick="setView('insights')"><span class="qa-i"><svg class="ic"><use href="#i-insights"/></svg></span>Insights</button>
    </div>
    ${(claims && claims.length) ? `<div class="card alert" style="border:1.5px solid var(--indigo)">
      <div class="section-title"><svg class="ic"><use href="#i-zap"/></svg> ${claims.length} payment${claims.length > 1 ? "s" : ""} to confirm</div>
      ${claims.map(c => `<div class="list-row" onclick="invoiceDetail(${c.invoice_id})">
        <div><div class="main">${esc(c.invoice_no)}</div><div class="meta">Customer says they've transferred</div></div>
 <div class="amount">${money(c.amount)}</div></div>`).join("")}
 </div>` : ""}
 ${(orders && orders.length) ? `<div class="card alert" style="border:1.5px solid var(--indigo)" onclick="setView('orders')">
 <div class="section-title">${orders.length} new order${orders.length > 1 ? "s" : ""} to review</div>
 ${orders.map(o => `<div class="list-row" onclick='event.stopPropagation(); orderDetail(${attrJson(o)})'>
 <div style="flex:1;min-width:0"><div class="main">${esc(o.customer_name || "Customer")}</div>
 <div class="meta">${o.items.length} item${o.items.length > 1 ? "s" : ""} · ${fmtDate(o.created_at)}</div></div>
 <div class="amount">${money(o.total)}</div></div>`).join("")}
 </div>` : ""}
 ${goalCardHtml(d)}
 <div class="card">
 <div class="card-head">
 <div class="section-title" style="margin:0">Today's sales</div>
        <a class="see-all" onclick="setView('sales')">See all ›</a>
      </div>
      ${todays.length ? todays.map(i => `
        <div class="list-row" onclick="invoiceDetail(${i.id})">
          <span class="avatar">${esc(_initials(i.customer_name))}</span>
          <div style="flex:1;min-width:0;margin-left:12px"><div class="main">${esc(i.customer_name || "Walk-in")}</div>
            <div class="meta">${esc(i.invoice_no)}</div></div>
          <div style="text-align:right"><div class="amount">${money(i.total)}</div>
            <span class="badge ${i.status}">${i.status === "partial" ? "part paid" : i.status === "unpaid" ? "owing" : i.status}</span></div>
        </div>`).join("") : `<div class="empty">No sales yet today. Tap ＋ to record one.</div>`}
    </div>
    ${debtors.length ? `<div class="card">
      <div class="card-head">
        <div class="section-title" style="margin:0"><svg class="ic"><use href="#i-customers"/></svg> Owed to you · ${money(owedTotal)}</div>
        ${debtors.length > 5 ? `<a class="see-all" onclick="openOwed()">See all ${debtors.length} ›</a>` : ""}
      </div>
      ${debtors.slice(0, 5).map(owedCustomerRowHtml).join("")}
    </div>` : ""}
    <div class="kpi-grid">
      <div class="kpi"><div class="label">Cost of goods</div><div class="value">${money(d.cogs)}</div></div>
      <div class="kpi"><div class="label">Expenses</div><div class="value">${money(d.expenses)}</div></div>
    </div>
    ${(d.low_stock && d.low_stock.length) ? `<div class="card alert" onclick="setView('products')">
      <div class="section-title"><svg class="ic"><use href="#i-warn"/></svg> Low stock — time to restock</div>
      ${d.low_stock.map(p => `<div class="list-row">
        <div style="flex:1;min-width:0"><div class="main">${esc(p.name)}</div></div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
          <div class="amount neg">${p.stock_qty} left</div>
          ${(p.suppliers && p.suppliers.length) ? `<button class="wa-mini call" onclick='event.stopPropagation(); callSupplier(${attrJson(p)})'><svg class="ic"><use href="#i-phone"/></svg> Supplier</button>` : ""}
        </div></div>`).join("")}
    </div>` : ""}
    <div class="card">
      <div class="card-head">
        <div class="section-title" style="margin:0"><svg class="ic"><use href="#i-products"/></svg> Stock levels</div>
        <button class="add-btn" onclick="productModal()" aria-label="Add product">＋</button>
      </div>
      ${products.length ? products.slice().sort((a, b) => a.stock_qty - b.stock_qty).map(p => {
        const low = p.low_stock_at > 0 && p.stock_qty <= p.low_stock_at;
        return `<div class="list-row" onclick='productModal(${attrJson(p)})'>
          <div style="flex:1;min-width:0"><div class="main">${esc(p.name)} ${low ? '<span class="badge unpaid">low</span>' : ''}</div>
            <div class="meta">${low ? 'Reorder soon' : 'In stock'}</div></div>
          <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
            ${(low && p.suppliers && p.suppliers.length) ? `<button class="wa-mini call" onclick='event.stopPropagation(); callSupplier(${attrJson(p)})'><svg class="ic"><use href="#i-phone"/></svg> Supplier</button>` : ""}
            <div class="amount ${low ? 'neg' : ''}">${p.stock_qty}</div></div></div>`;
      }).join("") : `<div class="empty">No products yet — tap ＋ to add one</div>`}
    </div>
    <div class="card">
      <div class="section-title">Revenue & profit trend</div>
      ${trendChart(d.trend, d.net_profit)}
    </div>
    <div class="card">
      <div class="section-title">Top products</div>
      ${d.top_products.length ? d.top_products.map(p => `
        <div class="list-row">
          <div><div class="main">${esc(p.description)}</div>
            <div class="meta">${p.qty} sold · ${money(p.profit)} profit</div></div>
          <div class="amount">${money(p.revenue)}</div>
        </div>`).join("") : `<div class="empty">No sales yet</div>`}
    </div>`;
}

// ---------- Profit goal (per shop) ----------
// The active shop's monthly goal, stashed at render so the edit modal can
// prefill it (0 on the All-shops overview, where the card is read-only).
let _currentGoal = 0;
// Card on Home: progress toward this calendar month's profit goal. Tapping it
// fetches AI tips on closing the gap; the <svg class="ic"><use href="#i-edit"/></svg> button edits/removes the goal.
// On the All-shops overview the goal is the combined total and read-only.
function goalCardHtml(d) {
  const g = d.goal;
  if (!g || !g.target) {
    _currentGoal = 0;
    return `<div class="card goal-card" onclick="goalModal()">
      <div class="section-title" style="margin:0"><svg class="ic"><use href="#i-target"/></svg> Set a monthly profit goal</div>
      <p style="font-size:13px;color:var(--muted);margin:6px 0 0">See how close you are each day — and get tips to hit it.${state.activeShop ? "" : " Each shop has its own."}</p>
    </div>`;
  }
  const combined = !!g.combined;
  _currentGoal = combined ? 0 : g.target;
  const pct = Math.max(0, Math.min(100, Math.round(g.month_profit / g.target * 100)));
  const hit = g.month_profit >= g.target;
  const left = Math.max(0, g.target - g.month_profit);
  const monthName = new Date().toLocaleString("en", { month: "long" });
  const title = combined ? `<svg class="ic"><use href="#i-admin"/></svg> ${monthName} goal · all shops` : `<svg class="ic"><use href="#i-target"/></svg> ${monthName} profit goal`;
  const editBtn = combined ? "" : `<button class="add-btn" onclick="event.stopPropagation(); goalModal()" aria-label="Edit goal"><svg class="ic"><use href="#i-edit"/></svg></button>`;
  return `<div class="card goal-card" onclick="goalTips()">
    <div class="card-head">
      <div class="section-title" style="margin:0">${title}</div>
      ${editBtn}
    </div>
    <div class="goal-bar"><div class="goal-fill ${hit ? "hit" : ""}" style="width:${pct}%"></div></div>
    <div class="goal-meta">
      <span><strong>${money(g.month_profit)}</strong> of ${money(g.target)}</span>
      <span class="${hit ? "pos" : ""}">${hit ? "Goal reached!" : `${pct}% · ${money(left)} to go`}</span>
    </div>
    <p style="font-size:12px;color:var(--muted);margin:8px 0 0">${combined ? "Combined across your shops · open a shop to change its goal · " : ""}<svg class="ic"><use href="#i-insights"/></svg> Tap for tips to ${hit ? "finish even stronger" : "hit your goal"} ›</p>
  </div>`;
}
function goalModal() {
  // Goals live on a specific shop — from the All-shops overview, ask them to pick one.
  if (!state.activeShop) { toast("Open a specific shop to set its goal"); shopSwitcher(); return; }
  const cur = _currentGoal || 0;
  openModal(`<h2><svg class="ic"><use href="#i-target"/></svg> Monthly profit goal</h2>
    <p style="font-size:13px;color:var(--muted);margin:-6px 0 14px">Net profit you're aiming for at <strong>${esc(activeShopName())}</strong> each month. Progress resets on the 1st.</p>
 <div class="field"><label>Goal amount</label><input id="goalAmt" type="number" inputmode="decimal" value="${cur || ""}" placeholder="e.g. 100000"></div>
 <button class="btn" onclick="saveGoal()">Save goal</button>
 ${cur ? `<button class="btn ghost" style="margin-top:10px" onclick="saveGoal(0)">Remove goal</button>` : ""}`);
}
async function saveGoal(v) {
 const amt = v !== undefined ? v : (parseFloat(document.getElementById("goalAmt").value) || 0);
 if (amt < 0) return toast("Goal must be 0 or more");
 try { await api.send("/api/goal", "PUT", { amount: amt }); }
 catch (e) { if (e.message !== "__upgrade__" && e.message !== "__auth__") toast(e.message || "Couldn't save goal"); return; }
  closeModal(); toast(amt > 0 ? "Goal set — go get it!" : "Goal removed"); render();
}
async function goalTips(refresh) {
  openModal(`<h2><svg class="ic"><use href="#i-insights"/></svg> Hit your goal</h2><div class="loading">${refresh ? "SalesPal is generating your advice…" : "Loading your advice…"}</div>`);
  try {
    // fresh:true → always reflect what's saved (bypass the 15s GET cache); the
 // backend serves the stored advice unless refresh regenerates it.
 const r = await api.get("/api/insights/goal-tips" + (refresh ? "?refresh=1" : ""), { fresh: true });
 const saved = r.saved_at ? `<div class="goal-meta" style="margin-top:12px">Saved ${fmtDate(r.saved_at)}</div>` : "";
 updateModal(`<h2>Hit your goal</h2><div class="md">${md(r.text)}</div>${saved}
 <button class="btn" style="margin-top:14px" onclick="goalTips(true)">Generate new advice</button>
 <button class="btn secondary" style="margin-top:10px" onclick="closeModal()">Close</button>`);
 } catch (e) {
 // 402 → showUpgrade already swapped in the upgrade modal; leave it up.
 if (e.message === "__upgrade__" || e.message === "__auth__") return;
 closeModal(); toast(e.message || "Couldn't load tips");
  }
}

function trendChart(trend, netProfit = 0) {
  if (!trend || !trend.length) return `<div class="empty">No data</div>`;
  const profitColor = netProfit < 0 ? "#dc2626" : "#16a34a"; // red only on a real loss
  const W = 480, H = 130, pad = 6;
  const max = Math.max(1, ...trend.map(t => Math.max(t.revenue, t.profit)));
  const min = Math.min(0, ...trend.map(t => t.profit));
  const range = max - min || 1;
  const x = (i) => pad + i * (W - 2 * pad) / Math.max(1, trend.length - 1);
  const y = (v) => H - pad - (v - min) / range * (H - 2 * pad);
  const line = (key, color) => {
    const pts = trend.map((t, i) => `${x(i).toFixed(1)},${y(t[key]).toFixed(1)}`).join(" ");
    return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round"/>`;
  };
  const zeroY = y(0);
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" preserveAspectRatio="none">
    <line x1="0" y1="${zeroY}" x2="${W}" y2="${zeroY}" stroke="#e5e7eb" stroke-width="1"/>
    ${line("revenue", "#0d9488")}${line("profit", profitColor)}
  </svg>
  <div style="display:flex;gap:16px;font-size:12px;color:var(--muted);margin-top:6px">
    <span style="color:#0d9488">●</span> Revenue
    <span style="color:${profitColor}">●</span> Profit${netProfit < 0 ? " (loss)" : ""}</div>`;
}

// ---------- SALES / invoices ----------
let salesQuery = "", salesStatus = "all", salesSort = "newest";
// ponytail: sorts the in-memory list — fine until a user has thousands of invoices, then sort server-side
const SALES_SORTS = {
  newest: (a, b) => (b.date || "").localeCompare(a.date || "") || b.id - a.id,
  oldest: (a, b) => (a.date || "").localeCompare(b.date || "") || a.id - b.id,
  high: (a, b) => (b.total || 0) - (a.total || 0),
  low: (a, b) => (a.total || 0) - (b.total || 0),
};
async function viewSales() {
  window._invoices = await api.get("/api/invoices");
  const tabs = ["all", "unpaid", "overdue", "cash", "paid"];
  app.innerHTML = `
    <button class="btn" onclick="newSaleModal()" style="margin-bottom:12px">＋ New sale / invoice</button>
    <div class="field" style="margin-bottom:10px">
      <input id="salesSearch" placeholder="Search customer or invoice #" value="${esc(salesQuery)}"
        oninput="salesQuery=this.value;renderSalesList()"></div>
    <div class="seg">
      ${tabs.map(s => `<button data-st="${s}" class="${salesStatus === s ? 'active' : ''}"
        onclick="setSalesStatus('${s}')">${s[0].toUpperCase() + s.slice(1)}</button>`).join("")}
    </div>
    <div class="card"><div class="card-head"><div class="section-title" style="margin:0">Invoices</div>
      <select id="salesSort" onchange="salesSort=this.value;renderSalesList()" aria-label="Sort sales">
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
        <option value="high">Highest amount</option>
        <option value="low">Lowest amount</option>
      </select></div><div id="salesList"></div></div>`;
  document.getElementById("salesSort").value = salesSort;
  renderSalesList();
}
// Switch the status filter without touching the network — just re-filter the
// invoices already in memory and update the active pill.
function setSalesStatus(s) {
  salesStatus = s;
  document.querySelectorAll(".seg button[data-st]").forEach(b =>
    b.classList.toggle("active", b.dataset.st === s));
  renderSalesList();
}
function renderSalesList() {
  const all = window._invoices || [];
  const q = salesQuery.trim().toLowerCase();
  const list = all.filter(i => {
    if (salesStatus === "overdue" && !isOverdue(i)) return false;
    if (salesStatus === "cash" && !(i.cash_paid > 0.01)) return false;
    if (!["all", "overdue", "cash"].includes(salesStatus) && i.status !== salesStatus) return false;
    if (q && !((i.customer_name || "").toLowerCase().includes(q)
      || (i.invoice_no || "").toLowerCase().includes(q))) return false;
    return true;
  }).sort(SALES_SORTS[salesSort] || SALES_SORTS.newest);
  const host = document.getElementById("salesList");
  if (!all.length) {
    host.innerHTML = `<div class="empty"><div class="big"><svg class="ic"><use href="#i-sales"/></svg></div>No sales yet.<br>Tap ＋ to record your first one.</div>`;
    return;
  }
  const cashTotalHtml = salesStatus === "cash" && list.length
    ? `<div class="list-row"><div class="main"><svg class="ic"><use href="#i-cash"/></svg> Total cash</div>
        <div class="amount pos">${money(list.reduce((s, i) => s + (i.cash_paid || 0), 0))}</div></div>`
    : "";
  host.innerHTML = cashTotalHtml + (list.length ? list.map(i => `
    <div class="list-row" onclick="invoiceDetail(${i.id})">
      <div><div class="main">${esc(i.customer_name || "Walk-in")}${!state.activeShop && i.shop_name ? ` <span class="shop-tag">${esc(i.shop_name)}</span>` : ""}</div>
        <div class="meta">${i.invoice_no} · ${fmtDate(i.date)}${isOverdue(i) ? ` · <span class="neg">overdue</span>` : ""}${i.cash_paid > 0.01 ? ` · <svg class="ic"><use href="#i-cash"/></svg> ${money(i.cash_paid)} cash` : ""}</div></div>
      <div style="text-align:right">
        <div class="amount">${money(i.total)}</div>
        <span class="badge ${i.status}">${i.status}</span></div>
    </div>`).join("") : `<div class="empty">No matching invoices</div>`);
}

async function invoiceDetail(id) {
  if (id < 0) { toast("This sale opens once it syncs online"); return; }
  if (state.me && state.me.is_attendant) return attendantInvoice(id);
  // Show the sheet immediately with a skeleton so the tap feels instant, then
  // fill it once the invoice loads (served from cache when seen recently).
  openModal(`<div class="skeleton" aria-busy="true"><span class="sr-only">Loading</span>
    <div class="sk sk-card" style="height:24px;width:55%;margin-bottom:14px"></div>
    <div class="sk sk-card"></div><div class="sk sk-card"></div>
    <div class="sk sk-card" style="height:44px"></div></div>`);
  let inv;
  try { inv = await api.get(`/api/invoices/${id}`); }
  catch (e) {
    if (e.message === "__auth__" || e.message === "__upgrade__") { closeModal(); return; }
    closeModal(); toast(e.message || "Couldn't load invoice"); return;
 }
 const items = inv.items.map(it => `
 <div class="list-row"><div><div class="main">${esc(it.description)}</div>
 <div class="meta">${it.qty} × ${money(it.unit_price)}</div></div>
 <div class="amount">${money(it.qty * it.unit_price)}</div></div>`).join("");
 const pays = inv.payments.map(p => `
 <div class="list-row"><div><div class="main">${money(p.amount)}</div>
 <div class="meta">${fmtDate(p.date)}${p.method ? " · " + esc(p.method) : ""}</div></div></div>`).join("")
 || `<div class="empty">No payments yet</div>`;
 const overdue = isOverdue(inv);
 const due = inv.due_date
 ? ` · <span class="${overdue ? 'neg' : ''}">Due ${fmtDate(inv.due_date)}${overdue ? ' (overdue)' : ''}</span>`
 : "";
 updateModal(`
 <h2>${inv.invoice_no} <span class="badge ${inv.status}">${inv.status}</span></h2>
 <div class="meta" style="color:var(--muted);font-size:13px;margin-bottom:12px">
 ${esc(inv.customer ? inv.customer.name : "Walk-in customer")} · ${fmtDate(inv.date)}${due}</div>
 ${(inv.claims || []).map(cl => `
 <div class="card" style="border:1.5px solid var(--indigo);background:var(--tint)">
 <div style="font-weight:700;margin-bottom:4px">Customer says they've paid</div>
        <div style="font-size:13px;color:var(--muted);margin-bottom:10px">They reported sending <strong>${money(cl.amount)}</strong> by bank transfer. Confirm once it shows in your account.</div>
        <div class="btn-row">
          <button class="btn success" onclick="confirmClaim(${id}, ${cl.id})">✓ Confirm received</button>
          <button class="btn outline" onclick="dismissClaim(${id}, ${cl.id})">Not yet</button>
        </div>
      </div>`).join("")}
    <div class="card">${items}
      <div class="list-row"><div class="main">Total</div><div class="amount">${money(inv.total)}</div></div>
      <div class="list-row"><div>Paid</div><div class="amount pos">${money(inv.paid)}</div></div>
      <div class="list-row"><div>Balance</div><div class="amount ${inv.balance > 0 ? 'neg' : 'pos'}">${money(inv.balance)}</div></div>
    </div>
    <div class="card"><div class="section-title">Payments</div>${pays}</div>
    ${inv.balance > 0.01 ? `<button class="btn success" style="margin-bottom:10px" onclick="markPaid(${id}, ${inv.balance})">✓ Mark as paid</button>` : ""}
    ${inv.balance > 0.01 && state.pay && (state.pay.connected || state.pay.transfer_enabled) ? `<button class="btn" style="margin-bottom:10px" onclick='sharePaymentLink(${attrJson({ id: inv.id, invoice_no: inv.invoice_no, balance: inv.balance, pay_url: inv.pay_url, customer: inv.customer })})'><svg class="ic"><use href="#i-card"/></svg> Send payment link on WhatsApp</button>` : ""}
    <div class="btn-row" style="margin-bottom:10px">
      <button class="btn" onclick="shareInvoice(${id})"><svg class="ic"><use href="#i-send"/></svg> Share</button>
      <a class="btn secondary" href="/api/invoices/${id}/pdf" target="_blank"><svg class="ic"><use href="#i-file"/></svg> PDF</a>
    </div>
    <div class="btn-row" style="margin-bottom:10px">
      <button class="btn outline" onclick="shareInvoiceImage(${id},'png')"><svg class="ic"><use href="#i-image"/></svg> PNG</button>
      <button class="btn outline" onclick="shareInvoiceImage(${id},'jpg')"><svg class="ic"><use href="#i-image"/></svg> JPG</button>
      ${inv.paid > 0.01 ? `<button class="btn outline" onclick="receiptOffer(${id}, 'Send a receipt')"><svg class="ic"><use href="#i-sales"/></svg> Receipt</button>` : ""}
    </div>
    ${inv.balance > 0.01
      ? `<button class="btn whatsapp" style="margin-bottom:10px" onclick='whatsappReminder(${attrJson(inv)})'><svg class="ic"><use href="#i-chat"/></svg> WhatsApp reminder</button>`
      : ""}
    ${inv.balance > 0.01 ? `<button class="btn secondary" style="margin-bottom:10px" onclick="paymentModal(${id}, ${inv.balance})">Record part payment</button>` : ""}
    ${inv.paid > 0.01 ? `<button class="btn outline" style="margin-bottom:10px" onclick="markUnpaid(${id})">↺ Mark as unpaid</button>` : ""}
    ${bankSwitcherHtml(inv)}
    <div class="btn-row">
      <button class="btn outline" onclick="editSaleModal(${id})"><svg class="ic"><use href="#i-edit"/></svg> Edit sale</button>
      <button class="btn danger" onclick="if(confirm('Delete this invoice? This also gives the stock back.')){deleteInvoice(${id})}">Delete</button>
    </div>`);
}

// "Paid to" picker for the New Sale / Edit Sale forms. Same rule as the
// invoice-detail switcher: only render it when there's an actual choice.
// selectedId = the account the sale already uses (edit), else the default.
function bankPickerFieldHtml(selectedId) {
  const accts = (state.pay && state.pay.accounts) || [];
  if (accts.length < 2) return "";
  const sel = selectedId || (accts.find(a => a.is_default) || {}).id;
  const opts = accts.map(a =>
    `<option value="${a.id}"${a.id === sel ? " selected" : ""}>${esc(a.bank)} · ${esc(a.number)}</option>`).join("");
  return `<div class="field"><label>Paid to</label>
    <select id="saleBankAccount">${opts}</select></div>`;
}

// The picker's value, or undefined when it isn't on screen — undefined keeps
// the field out of the payload entirely so the server leaves the account alone.
function saleBankAccountId() {
  const el = document.getElementById("saleBankAccount");
  return el ? Number(el.value) : undefined;
}

// "Paid to" switcher — only worth showing once there's a choice to make.
// Changing it updates the pay link, the PDF/image "Pay to" block and what the
// customer sees, immediately.
function bankSwitcherHtml(inv) {
  const accts = (state.pay && state.pay.accounts) || [];
  if (accts.length < 2 || !inv.bank_account) return "";
  const opts = accts.map(a =>
    `<option value="${a.id}"${a.id === inv.bank_account.id ? " selected" : ""}>${esc(a.bank)} · ${esc(a.number)}</option>`).join("");
  return `<div class="field" style="margin-bottom:10px">
    <label>Paid to</label>
    <select onchange="setInvoiceAccount(${inv.id}, this.value)">${opts}</select></div>`;
}

async function setInvoiceAccount(id, accountId) {
  try {
    await api.send(`/api/invoices/${id}/bank-account`, "POST",
      { bank_account_id: Number(accountId) });
    toast("Account updated for this sale");
  } catch (e) { toast(e.message || "Couldn't switch account"); }
}

// Optimistic mutation: the feedback (closed modal / toast) is already on screen,
// so run the write in the background, then refresh from the server. On failure we
// surface an error AND the refresh re-reads server truth, so the UI self-corrects
// — a delete that didn't go through simply reappears. Fire-and-forget by design.
async function _optimistic(write) {
  try { await write(); }
  catch (e) {
    if (e.message === "__auth__" || e.message === "__upgrade__") return;
    toast(e.message || "Couldn't save — try again");
  }
  render();
}

function deleteInvoice(id) {
  closeModal(); toast("Invoice deleted");
  _optimistic(() => api.send(`/api/invoices/${id}`, "DELETE"));
}

// ---------- EDIT SALE ----------
// Reuses the New Sale item-builder (saleItems array + renderSaleItems/
// addProductItem/pickProduct/updItem — same functions, just seeded from the
// existing invoice instead of starting blank).
async function editSaleModal(id) {
 if (!requireShop()) return;
 let inv;
 try { inv = await api.get(`/api/invoices/${id}`); }
 catch (e) {
 if (e.message === "__auth__" || e.message === "__upgrade__") return;
 toast(e.message || "Couldn't load invoice"); return;
  }
  const [products, customers] = await Promise.all([
    api.get("/api/products"), api.get("/api/customers")]);
  window._products = products;
  window._customers = customers;
  saleItems = inv.items.map(it => ({
    product_id: it.product_id, description: it.description,
    qty: it.qty, unit_price: it.unit_price, unit_cost: it.unit_cost,
    custom: !it.product_id,
  }));
  openModal(`
    <h2 style="margin:0 0 14px">Edit sale</h2>
    <div class="field" style="position:relative">
      <label>Customer name</label>
      <input id="saleCustomer" autocomplete="off" value="${esc(inv.customer ? inv.customer.name : "")}"
        placeholder="Type a name (or leave blank for walk-in)"
        oninput="filterCustomerSuggest()" onfocus="filterCustomerSuggest()"
        onblur="setTimeout(hideCustomerSuggest,150)">
      <div id="custSuggest" class="suggest-list"></div>
    </div>
    <div class="section-title">Items</div>
    <div id="saleItems"></div>
    <div class="btn-row" style="margin-bottom:12px">
      <button class="btn outline btn-sm" onclick="addProductItem()">＋ Add product</button>
      <button class="btn outline btn-sm" onclick="addCustomItem()">＋ Custom item</button>
    </div>
    <div class="field"><label>Due date (optional)</label><input id="saleDue" type="date" value="${inv.due_date || ""}"></div>
    ${bankPickerFieldHtml(inv.bank_account && inv.bank_account.id)}
    <div class="field"><label>Notes (optional)</label><textarea id="saleNotes">${esc(inv.notes || "")}</textarea></div>
    <div class="card" style="background:var(--tint)">
      <div class="list-row"><div class="main">Total</div>
        <div class="amount" id="saleTotal">${money(0)}</div></div></div>
    <button class="btn" onclick="saveEditedSale(${id})">Save changes</button>`);
  renderSaleItems();
}

async function saveEditedSale(id) {
  const items = saleItems.filter(it => it.description && it.qty > 0);
  if (!items.length) return toast("Add at least one item");
  const customer_name = document.getElementById("saleCustomer").value.trim();
  try {
    const acctId = saleBankAccountId();
    await api.send(`/api/invoices/${id}`, "PUT", {
      customer_name: customer_name || null,
      due_date: document.getElementById("saleDue").value || null,
      notes: document.getElementById("saleNotes").value,
      items: items.map(it => ({
        product_id: it.product_id, description: it.description,
        qty: it.qty, unit_price: it.unit_price, unit_cost: it.unit_cost,
      })),
      // omitted entirely when the picker isn't shown, so the server keeps
      // whatever account the sale was already payable to
      ...(acctId ? { bank_account_id: acctId } : {}),
    });
  } catch (e) {
    if (e.message === "__auth__" || e.message === "__upgrade__") return;
    toast(e.message || "Couldn't save changes"); return;
 }
 closeModal(); toast("Sale updated"); render();
}

// Safely embed JSON in a single-quoted HTML attribute (escape apostrophes).
function attrJson(obj) { return JSON.stringify(obj).replace(/'/g, "&#39;"); }

// Normalise a phone for wa.me (digits only; Nigerian local 0XXXXXXXXXX -> 234XXXXXXXXXX).
function waNumber(phone) {
  let d = (phone || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = "234" + d.slice(1);
  return d;
}

// Save a phone onto a customer without clobbering their other fields.
async function _saveCustomerPhone(custId, phone) {
  try {
    const all = await api.get("/api/customers");
    const c = all.find(x => x.id === custId);
    if (!c) return;
    await api.send(`/api/customers/${custId}`, "PUT",
      { name: c.name, email: c.email || null, phone, address: c.address || null });
  } catch (e) { /* non-fatal */ }
}

// Resolve the customer's WhatsApp number: use the saved phone, otherwise ask
// once and remember it on the customer. Returns a wa.me-ready number or null.
function _waResolveNumber(cust) {
 let phone = cust && cust.phone;
 if (!phone) {
 const typed = prompt(
 `Enter ${cust && cust.name ? cust.name + "'s" : "the customer's"} WhatsApp number\n(e.g. 0803… or +234803…):`);
 if (!typed || !typed.trim()) return null;
 phone = typed.trim();
 if (cust && cust.id) _saveCustomerPhone(cust.id, phone); // remember it (background)
 }
 const num = waNumber(phone);
 if (!num) { toast("That doesn't look like a valid number"); return null; }
  return num;
}

// True inside the Android WebView app (its UA carries "; wv)"), where window.open
// is a no-op with pop-up windows disabled.
const _isWebViewApp = / wv\)/.test(navigator.userAgent) || !!window.SalesPalShare;

// Open an external app/link (WhatsApp, mailto, tel). In the WebView app a
// top-level navigation is intercepted natively (shouldOverrideUrlLoading) and
// handed to the right app WITHOUT navigating the WebView away; in a browser we
// open a new tab so the app stays put, falling back to navigation if blocked.
function openExternal(url) {
  if (_isWebViewApp) { location.href = url; return; }
  const w = window.open(url, "_blank");
  if (!w) location.href = url;
}

// Open WhatsApp to a number with a prefilled message. Called SYNCHRONOUSLY from
// the tap (no await before it) so phones deep-link straight into the chat — a
// delayed/scripted navigation to wa.me only loads its web "download" page.
function _openWhatsApp(num, msg) {
  openExternal(`https://wa.me/${num}?text=${encodeURIComponent(msg)}`);
}

function whatsappReminder(inv) {
  const num = _waResolveNumber(inv.customer);
  if (!num) return;
  const biz = (state.settings && state.settings.business_name) || "us";
  const who = inv.customer && inv.customer.name ? inv.customer.name : "there";
  const due = inv.due_date ? ` (due ${fmtDate(inv.due_date)})` : "";
  // Quote the account THIS invoice is payable to (not just any account), so
  // the customer can transfer straight from the chat without asking for details.
  const a = inv.bank_account;
  const bank = a && a.number
    ? `\n\nTransfer to:\n${a.number}\n${a.bank}${a.name ? `\n${a.name}` : ""}`
    : "";
  const msg = `Hi ${who}, a friendly reminder from ${biz}: invoice ${inv.invoice_no} `
    + `has an outstanding balance of ${money(inv.balance)}${due}. `
    + `Kindly arrange payment when you can. Thank you!`
    + bank
    + (inv.pay_url ? `\n\nPay securely here: ${inv.pay_url}` : "");
  _openWhatsApp(num, msg);
}

// Open the customer's WhatsApp chat so the owner can voice/video call them —
// the call icons sit at the top of the chat. WhatsApp gives no web link that
// auto-starts a call, so opening the chat in the tap gesture is the reliable
// path (a delayed/scripted wa.me nav only loads the "download" page).
function whatsappCall(cust) {
 const num = _waResolveNumber(cust);
 if (!num) return;
 openExternal(`https://wa.me/${num}`);
}

// Build a tel: dial string — prefer the international +234… form when we can
// normalise it, else dial the digits as entered (the OS dialer handles locals).
function telNumber(phone) {
 const intl = waNumber(phone);
 if (intl && (intl.startsWith("234") || intl.length >= 12)) return "+" + intl;
 return (phone || "").replace(/[^\d+]/g, "");
}

// Dial the customer directly with the phone's own dialer (a normal cellular
// call, not WhatsApp). tel: doesn't unload the app — the OS intercepts it.
function phoneCall(cust) {
 const num = telNumber(cust && cust.phone);
 if (!num) { toast("No number to call"); return; }
 window.location.href = "tel:" + num;
}

function isOverdue(inv) {
 return !!inv.due_date && inv.balance > 0.01
 && inv.due_date < new Date().toISOString().slice(0, 10);
}

async function markPaid(id, balance) {
  // Optimistic: acknowledge the tap now, record in the background, then refresh.
  const online = navigator.onLine && id > 0;
  toast(online ? "Marked as paid ✓" : "Payment saved offline — syncs when you're online");
  try {
    await api.send(`/api/invoices/${id}/payments`, "POST", { amount: balance, method: "Marked paid" });
  } catch (e) {
    if (e.message === "__auth__" || e.message === "__upgrade__") return;
    toast(e.message || "Couldn't mark paid"); render(); return;
  }
  // Only offer the receipt once the payment actually recorded — never for a
  // write that failed (that would receipt an unpaid invoice).
  if (online) receiptOffer(id);
  render();
}

// Inverse of markPaid: reset an invoice to unpaid (clears its payments). A
// correction, so it confirms first; then re-open the detail to show the new
// status. Online-only — this isn't in the offline write queue.
async function markUnpaid(id) {
  if (!confirm("Set this invoice back to unpaid? This clears the payment(s) recorded on it.")) return;
  toast("Marked as unpaid"); // acknowledge now; reverse in the background
  try {
    await api.send(`/api/invoices/${id}/unpay`, "POST");
  } catch (e) {
    if (e.message === "__auth__" || e.message === "__upgrade__") return;
    toast(e.message || "Couldn't mark unpaid");
  }
  // Reopen with the refreshed status — success shows unpaid, a failure shows it
  // still paid (self-correcting). The successful write cleared the GET cache.
  invoiceDetail(id);
}

async function shareInvoice(id) {
  const pdfUrl = `${location.origin}/api/invoices/${id}/pdf`;
  const inv = await api.get(`/api/invoices/${id}`);
  const biz = state.settings.business_name || "SalesPal";
  const who = inv.customer ? inv.customer.name : "";
  const title = `Invoice ${inv.invoice_no}`;
  const text = `${biz} — Invoice ${inv.invoice_no}${who ? " for " + who : ""}\n`
    + `Total: ${money(inv.total)}`
    + (inv.balance > 0.01 ? `\nBalance due: ${money(inv.balance)}` : " (paid in full)");
  await _shareFile(pdfUrl, `${inv.invoice_no}.pdf`, "application/pdf", title, text);
}

function paymentModal(id, balance) {
  // Amount starts EMPTY (not pre-filled with the full balance) so a part payment
  // isn't accidentally saved as payment-in-full. Full settlement has its own
 // "✓ Mark as paid" button. Placeholder suggests a partial amount.
 openModal(`
 <h2>Record part payment</h2>
 <p style="font-size:13px;color:var(--muted);margin:-6px 0 14px">Outstanding balance: <strong>${money(balance)}</strong></p>
 <div class="field"><label>Amount received now</label>
 <input id="payAmt" type="number" inputmode="decimal" placeholder="e.g. ${Math.max(1, Math.round(balance / 2))}" autofocus /></div>
 <div class="field"><label>Method (optional)</label>
 <input id="payMethod" placeholder="Cash, transfer, card…" /></div>
 <button class="btn" onclick="savePayment(${id}, ${balance})">Save payment</button>`);
}
async function savePayment(id, balance) {
 const amount = parseFloat(document.getElementById("payAmt").value);
 if (!amount || amount <= 0) return toast("Enter a valid amount");
 if (balance != null && amount > balance + 0.01
 && !confirm(`That's more than the ${money(balance)} balance. Record ${money(amount)} anyway?`)) return;
  const r = await api.send(`/api/invoices/${id}/payments`, "POST",
    { amount, method: document.getElementById("payMethod").value });
  if (navigator.onLine && id > 0 && r && typeof r.balance === "number") {
    toast(r.balance > 0.01 ? `Recorded — ${money(r.balance)} still due` : "Paid in full ✓");
    receiptOffer(id);
  } else toast("Payment saved offline — syncs when you're online");
 render();
}

// ---------- shareable files (invoice / receipt, PDF or image) ----------
function _blobToB64(blob) {
 return new Promise((res, rej) => {
 const r = new FileReader();
 r.onloadend = () => res(String(r.result).split(",")[1] || "");
 r.onerror = rej;
 r.readAsDataURL(blob);
 });
}

// Share a generated file. Preference order:
// 1) native app bridge → real Android share sheet WITH the file (installed app),
// 2) browser Web Share with files (Chrome Android / iOS Safari),
// 3) download it — NEVER window.open, which navigates (and strands) the WebView
// onto the raw file since the WebView has no navigator.share.
async function _shareFile(url, filename, mime, title, text) {
 const abs = url.startsWith("http") ? url : location.origin + url;
 try {
 let blob = null;
 // r.ok matters: a 401 or offline-503 body would otherwise be shared as a .pdf
 // full of JSON. Skipping the blob falls through to the plain download link.
 try { const r = await fetch(url); if (r.ok) blob = await r.blob(); } catch (e) {}

 // 1) Native app bridge → real Android share sheet WITH the file.
 // Test only object PRESENCE (reliable); reading a method as a property can
 // read back undefined on some WebViews even though it's callable — so we just
    // CALL it inside try/catch instead of gating on `.shareFile`.
    if (blob && window.SalesPalShare) {
      try {
        window.SalesPalShare.shareFile(await _blobToB64(blob), mime, filename, text || "");
        return;
      } catch (e) { /* bridge missing/failed → fall through */ }
    }
    // 2) Browsers with Web Share (Chrome Android / iOS Safari).
    if (blob) {
      const file = new File([blob], filename, { type: mime });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title, text });
        return;
      }
    }
    // 3) Download fallback (native DownloadListener saves it; browsers download too).
    const dl = abs + (abs.includes("?") ? "&" : "?") + "download=1";
    const a = document.createElement("a");
    a.href = dl; a.download = filename; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
    toast("Saved to your phone — open it to share");
  } catch (e) {
    if (e && e.name === "AbortError") return; // user dismissed the share sheet
    toast("Couldn't share — try again");
 }
}

async function shareImageFile(url, filename, title, text) {
 const mime = filename.endsWith(".jpg") ? "image/jpeg" : "image/png";
 await _shareFile(url, filename, mime, title, text);
}

async function shareInvoiceImage(id, fmt) {
 const inv = await api.get(`/api/invoices/${id}`);
 const biz = state.settings.business_name || "SalesPal";
 await shareImageFile(`/api/invoices/${id}/image?fmt=${fmt}`,
 `${inv.invoice_no}.${fmt}`, `Invoice ${inv.invoice_no}`,
 `${biz} — Invoice ${inv.invoice_no} · Total ${money(inv.total)}`);
}

async function shareReceipt(id, fmt) {
 const inv = await api.get(`/api/invoices/${id}`);
 const biz = state.settings.business_name || "SalesPal";
 // On a part-payment, the caption urges settling the balance; else a thank-you.
 const due = inv.balance > 0.01
 ? `${biz} — payment received for invoice ${inv.invoice_no}. `
 + `Balance outstanding: ${money(inv.balance)}${inv.due_date ? ` (due ${fmtDate(inv.due_date)})` : ""}. `
 + `Kindly settle it when you can — thank you!`
 : `${biz} — payment received in full for invoice ${inv.invoice_no}. Thank you for your business!`;
 await shareImageFile(`/api/invoices/${id}/receipt?fmt=${fmt}`,
 `Receipt-${inv.invoice_no}.${fmt}`, `Receipt — ${inv.invoice_no}`, due);
}

// After a payment is recorded (or from the invoice), show the receipt itself —
// ready to send. On a part payment it displays the balance-due receipt so it's
// one tap into WhatsApp via the share sheet.
async function receiptOffer(id, heading) {
  openModal(`<h2>${heading || "Payment recorded ✓"}</h2>
    <div class="loading">Preparing receipt…</div>`);
  let inv = null;
  try { inv = await api.get(`/api/invoices/${id}`); }
  catch (e) { if (e.message === "__auth__" || e.message === "__upgrade__") return; }
  const part = inv && inv.balance > 0.01;
  const title = heading || (part ? "Part payment recorded ✓" : "Payment recorded ✓");
  const sub = part
    ? `Balance of <strong>${money(inv.balance)}</strong> still due — this receipt shows it and asks the customer to pay.`
    : `Send the customer their receipt with a thank-you message.`;
  updateModal(`<h2>${title}</h2>
    <p style="color:var(--muted);font-size:14px;margin:0 0 12px">${sub}</p>
    <img src="/api/invoices/${id}/receipt?fmt=png&t=${Date.now()}" alt="Receipt"
      style="width:100%;border:1px solid var(--line);border-radius:12px;margin-bottom:12px" />
    <button class="btn" onclick="shareReceipt(${id},'png')"><svg class="ic"><use href="#i-send"/></svg> Send receipt</button>
    <button class="btn secondary" style="margin-top:10px" onclick="shareReceipt(${id},'jpg')">Download JPG</button>
    <button class="btn ghost" style="margin-top:10px" onclick="closeModal()">Done</button>`);
}

// ---------- NEW SALE ----------
let saleItems = [];
async function newSaleModal() {
  if (state.me && state.me.is_attendant) return attendantSaleModal();
  if (!requireShop()) return;
  saleItems = [];
  const [products, customers] = await Promise.all([
    api.get("/api/products"), api.get("/api/customers")]);
  window._products = products;
  window._customers = customers;
  const canVoice = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  openModal(`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
      <h2 style="margin:0">New sale</h2>
      ${canVoice ? `<button type="button" class="mic-btn" id="micBtn" onclick="voiceSale()"><svg class="ic"><use href="#i-mic"/></svg> Speak it</button>` : ""}
    </div>
    <div class="field" style="position:relative">
      <label>Customer name</label>
      <input id="saleCustomer" autocomplete="off"
        placeholder="Type a name (or leave blank for walk-in)"
        oninput="filterCustomerSuggest()" onfocus="filterCustomerSuggest()"
        onblur="setTimeout(hideCustomerSuggest,150)">
      <div id="custSuggest" class="suggest-list"></div>
    </div>
    <div class="section-title">Items</div>
    <div id="saleItems"></div>
    <div class="btn-row" style="margin-bottom:12px">
      <button class="btn outline btn-sm" onclick="addProductItem()">＋ Add product</button>
      <button class="btn outline btn-sm" onclick="addCustomItem()">＋ Custom item</button>
    </div>
    <div class="field"><label>Due date (optional)</label><input id="saleDue" type="date"></div>
    ${bankPickerFieldHtml()}
    <div class="field"><label>Notes (optional)</label><textarea id="saleNotes"></textarea></div>
    <div class="card" style="background:var(--tint)">
      <div class="list-row"><div class="main">Total</div>
        <div class="amount" id="saleTotal">${money(0)}</div></div></div>
    <button class="btn" onclick="saveSale()">Save sale & create invoice</button>`);
  if (products.length) addProductItem(); else addCustomItem();
}

function renderSaleItems() {
  const host = document.getElementById("saleItems");
  host.innerHTML = saleItems.map((it, i) => {
    const prodOpts = (window._products || []).map(p =>
      `<option value="${p.id}" ${p.id === it.product_id ? "selected" : ""}>${esc(p.name)}</option>`).join("");
    return `<div class="line-item">
      <div class="li-head"><strong>Item ${i + 1}</strong>
        <button class="li-remove" onclick="removeItem(${i})">Remove</button></div>
      ${it.custom
        ? `<div class="field"><input placeholder="Description" value="${esc(it.description)}"
             oninput="updItem(${i},'description',this.value)"></div>`
        : `<div class="field"><select onchange="pickProduct(${i},this.value)">${prodOpts}</select></div>`}
      <div class="field-row">
        <div class="field"><label>Qty</label>
          <input type="number" inputmode="decimal" value="${it.qty}" oninput="updItem(${i},'qty',this.value)"></div>
        <div class="field"><label>Price</label>
          <input type="number" inputmode="decimal" value="${it.unit_price}" oninput="updItem(${i},'unit_price',this.value)"></div>
        ${it.custom ? `<div class="field"><label>Cost</label>
          <input type="number" inputmode="decimal" value="${it.unit_cost}" oninput="updItem(${i},'unit_cost',this.value)"></div>` : ""}
      </div></div>`;
  }).join("");
  const total = saleItems.reduce((s, it) => s + it.qty * it.unit_price, 0);
  document.getElementById("saleTotal").textContent = money(total);
}
function addProductItem() {
  const p = (window._products || [])[0];
  if (!p) return addCustomItem();
  saleItems.push({ product_id: p.id, description: p.name, qty: 1, unit_price: p.unit_price, unit_cost: p.unit_cost, custom: false });
  renderSaleItems();
}
function addCustomItem() {
  saleItems.push({ product_id: null, description: "", qty: 1, unit_price: 0, unit_cost: 0, custom: true });
  renderSaleItems();
}
function pickProduct(i, pid) {
  const p = (window._products || []).find(x => x.id == pid);
  if (p) { Object.assign(saleItems[i], { product_id: p.id, description: p.name, unit_price: p.unit_price, unit_cost: p.unit_cost }); }
  renderSaleItems();
}
function updItem(i, k, v) {
  saleItems[i][k] = (k === "qty" || k === "unit_price" || k === "unit_cost") ? (parseFloat(v) || 0) : v;
  if (k === "qty" || k === "unit_price") {
    const total = saleItems.reduce((s, it) => s + it.qty * it.unit_price, 0);
    document.getElementById("saleTotal").textContent = money(total);
  }
}

// Custom JS autocomplete for the customer name field — NOT a native
// <datalist>. Android's WebView renders <input list> as a forced picker that
// can swallow the on-screen keyboard, trapping the user into an existing
// name. This is a plain suggestion dropdown: it never blocks free typing.
function filterCustomerSuggest() {
 const inp = document.getElementById("saleCustomer");
 const box = document.getElementById("custSuggest");
 if (!inp || !box) return;
 const q = inp.value.trim().toLowerCase();
 // by name, not the list's debt order — a picker reads alphabetically
 const matches = (window._customers || [])
 .filter(c => !q || c.name.toLowerCase().includes(q))
 .sort((a, b) => a.name.localeCompare(b.name)).slice(0, 6);
 if (!matches.length) { box.classList.remove("show"); box.innerHTML = ""; return; }
 box.innerHTML = matches.map(c =>
 `<button type="button" onmousedown="event.preventDefault()" onclick='pickCustomerSuggest(${attrJson(c.name)})'>${esc(c.name)}</button>`
 ).join("");
 box.classList.add("show");
}
function pickCustomerSuggest(name) {
 const inp = document.getElementById("saleCustomer");
 if (inp) inp.value = name;
 hideCustomerSuggest();
}
function hideCustomerSuggest() {
 const box = document.getElementById("custSuggest");
 if (box) { box.classList.remove("show"); box.innerHTML = ""; }
}
function removeItem(i) { saleItems.splice(i, 1); renderSaleItems(); }

async function saveSale() {
 const items = saleItems.filter(it => it.description && it.qty > 0);
 if (!items.length) return toast("Add at least one item");
 const customer_name = document.getElementById("saleCustomer").value.trim();
 let res;
 try {
 const acctId = saleBankAccountId();
 res = await api.send("/api/invoices", "POST", {
 customer_name: customer_name || null,
 due_date: document.getElementById("saleDue").value || null,
 notes: document.getElementById("saleNotes").value,
 items: items.map(it => ({ product_id: it.product_id, description: it.description,
 qty: it.qty, unit_price: it.unit_price, unit_cost: it.unit_cost })),
 ...(acctId ? { bank_account_id: acctId } : {}),
 });
 } catch (e) { if (e.message !== "__auth__" && e.message !== "__upgrade__") toast(e.message || "Couldn't save sale"); return; }
  closeModal();
  toast(res.invoice_no === "Pending" ? "Sale saved offline — syncs when you're online" : `Sale saved · ${res.invoice_no}`);
 setView("sales");
 maybePaywallAfterSale();
}

// ---------- VOICE SALE ENTRY ----------
// Record the spoken sale and transcribe it on the server (Groq Whisper), then
// Claude maps the words onto THIS shop's products/customers and prefills the
// form. We record+upload instead of the browser Web Speech API because that API
// is blocked inside the Android TWA wrapper and unsupported on iOS Safari;
// recording (getUserMedia) works everywhere. Never auto-saves — the merchant
// always reviews the numbers and taps Save.
let _rec = null, _recChunks = [], _recTimer = null;
async function voiceSale() {
  const btn = document.getElementById("micBtn");
  if (_rec && _rec.state === "recording") { _rec.stop(); return; }   // tap again = stop early
  if (!navigator.onLine) return toast("Voice needs a connection — type it for now");
  const reset = () => { if (btn.isConnected) { btn.textContent = "Speak it"; btn.classList.remove("live"); } };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    // Mic failed to open. Show a diagnostic card with the exact error, the
    // Permissions-API state, and the real browser engine (a TWA can silently run
    // in Samsung Internet etc. if Chrome isn't the default) so a remote fix is
 // possible instead of guessing. perm "prompt" + instant NotAllowedError =
 // the browser app itself lacks the OS mic permission; "denied" = site-level.
 let perm = "unknown";
 try { perm = (await navigator.permissions.query({ name: "microphone" })).state; } catch (e2) {}
 const mode = document.referrer.startsWith("android-app://") ? "installed app"
 : matchMedia("(display-mode: standalone)").matches ? "home-screen app" : "browser tab";
 openModal(`
 <h2>Mic check</h2>
 <p>${perm === "denied" ? "The browser has the mic <b>blocked for this site</b>."
 : e.name === "NotAllowedError" ? "The browser app itself was <b>refused mic access by the phone</b>."
 : "The mic couldn't start."}</p>
      <div class="card" style="font-family:monospace;font-size:12px;word-break:break-all">
        error: ${esc(e.name || "?")} — ${esc(e.message || "")}<br>
        site permission: ${esc(perm)}<br>
        running as: ${mode}<br>
        ${esc(navigator.userAgent)}
      </div>
      <p style="font-size:14px">Fix: phone Settings → Apps → <b>the browser named above</b> (e.g. Chrome) →
      Permissions → Microphone → <b>Allow</b>. Then close and reopen this app.</p>`);
    return;
  }
  _recChunks = [];
  const rec = new MediaRecorder(stream);
  _rec = rec;
  rec.ondataavailable = (e) => { if (e.data && e.data.size) _recChunks.push(e.data); };
  rec.onstop = async () => {
    clearTimeout(_recTimer);
    stream.getTracks().forEach(t => t.stop());
    _rec = null;
    const type = rec.mimeType || "audio/webm";
    const blob = new Blob(_recChunks, { type });
    if (!blob.size) { reset(); return toast("Didn't catch that — try again"); }
 if (btn.isConnected) btn.textContent = "Working…";
 const fd = new FormData();
 fd.append("audio", blob, "sale." + (type.includes("mp4") || type.includes("m4a") ? "mp4" : "webm"));
 let r;
 try {
 r = await api.sendForm("/api/voice/transcribe-sale", fd);
 } catch (err) {
 reset();
 if (err.message !== "__upgrade__" && err.message !== "__auth__") toast(err.message || "Couldn't understand that");
      return;
    }
    reset();
    applyVoiceSale(r.sale);
    toast(r.free_uses_left != null
      ? `Heard: “${r.transcript}” · ${r.free_uses_left} free voice sale${r.free_uses_left === 1 ? "" : "s"} left`
      : `Heard: “${r.transcript}” — check & save`);
  };
  btn.textContent = "Recording… tap to stop";
  btn.classList.add("live");
  rec.start();
  // Auto-stop after 15s so a forgotten recording doesn't run (and upload) forever.
 _recTimer = setTimeout(() => { if (_rec && _rec.state === "recording") _rec.stop(); }, 15000);
}

function applyVoiceSale(sale) {
 if (!sale || !document.getElementById("saleItems")) return;
 const items = (sale.items || []).filter(it => it.description);
 if (items.length) {
 saleItems = items.map(it => {
 const p = (window._products || []).find(x => x.id === it.product_id);
 return p
 ? { product_id: p.id, description: p.name, qty: it.qty || 1, unit_price: it.unit_price || p.unit_price, unit_cost: p.unit_cost, custom: false }
 : { product_id: null, description: it.description, qty: it.qty || 1, unit_price: it.unit_price || 0, unit_cost: 0, custom: true };
 });
 renderSaleItems();
 }
 if (sale.customer_name) document.getElementById("saleCustomer").value = sale.customer_name;
 // The owner form has no payment control; keep what was said in the notes so
 // it isn't lost — they can mark the invoice paid right after saving.
  if (sale.payment && sale.payment !== "unknown") {
    const n = document.getElementById("saleNotes");
    if (n && !n.value) n.value = sale.payment === "owing" ? "Customer owing" : `Paid by ${sale.payment}`;
  }
}

// ---------- MONEY (expenses + outstanding) ----------
let moneyTab = "expenses";
async function viewMoney() {
  app.innerHTML = `<div class="seg">
    <button class="${moneyTab === 'expenses' ? 'active' : ''}" onclick="moneyTab='expenses';render()">Expenses</button>
    <button class="${moneyTab === 'owed' ? 'active' : ''}" onclick="moneyTab='owed';render()">Owed to me</button>
  </div><div id="moneyBody"></div>`;
  if (moneyTab === "expenses") await renderExpenses();
  else await renderOwed();
}

async function renderExpenses() {
  // /api/expenses isn't an offline-overlay list, so a transient read failure
  // would otherwise bubble up and replace the WHOLE screen with a raw error
  // card (losing the tab bar). Fail soft instead: keep the tabs, offer Retry.
  let exp;
  try {
    exp = await api.get("/api/expenses");
  } catch (e) {
    if (e.message === "__auth__" || e.message === "__upgrade__") throw e;
    document.getElementById("moneyBody").innerHTML = `
      <div class="card"><div class="empty">
        <div class="big"><svg class="ic"><use href="#i-warn"/></svg></div>
        Couldn't load expenses.
        <div style="margin-top:6px;font-size:13px;color:var(--muted)">${esc(e.message)}</div>
        <button class="btn secondary" style="margin-top:14px" onclick="render()">Retry</button>
      </div></div>`;
    return;
  }
  if (!Array.isArray(exp)) exp = [];
  const total = exp.reduce((s, e) => s + e.amount, 0);
  document.getElementById("moneyBody").innerHTML = `
    <button class="btn" onclick="expenseModal()" style="margin-bottom:14px">＋ Add expense</button>
    <div class="card">
      <div class="section-title">Expenses · ${money(total)} total</div>
      ${exp.length ? exp.map(e => `
        <div class="list-row">
          <div><div class="main">${esc(e.description || e.category)}</div>
            <div class="meta">${esc(e.category)} · ${fmtDate(e.date)}</div></div>
          <div style="text-align:right"><div class="amount neg">${money(e.amount)}</div>
            <button class="li-remove" onclick="delExpense(${e.id})">Delete</button></div>
        </div>`).join("") : `<div class="empty"><div class="big"><svg class="ic"><use href="#i-expenses"/></svg></div>No expenses logged yet</div>`}
    </div>`;
}
const STOCK_CAT = "Stock / inventory";

async function expenseModal() {
  if (!requireShop()) return;
  // Whether they record cost prices decides whether a restock logged here would
  // be counted twice. Cached GET, so this costs nothing on repeat opens.
  let tracksCost = false;
  try {
    const products = await api.get("/api/products");
    tracksCost = (products || []).some(p => Number(p.unit_cost) > 0);
  } catch (e) { /* offline: skip the check rather than block the entry */ }
  window._expTracksCost = tracksCost;
  // Stock sits last and is no longer the default: it's the one category that
  // usually ISN'T an expense, so it shouldn't be what you get by just tapping save.
  openModal(`<h2>Add expense</h2>
    <div class="field"><label>Amount</label><input id="expAmt" type="number" inputmode="decimal"></div>
    <div class="field"><label>Category</label>
      <select id="expCat" onchange="expCatChanged()"><option>Transport</option>
        <option>Rent</option><option>Utilities</option><option>Marketing</option>
        <option>Salaries</option><option>${STOCK_CAT}</option><option>Other</option></select></div>
    <div id="expWarn"></div>
    <div class="field"><label>Description (optional)</label><input id="expDesc"></div>
    <button class="btn" onclick="saveExpense()">Save expense</button>`);
  expCatChanged();
}

// Logging a restock as an expense while the product also carries a cost price
// subtracts the same money twice — here, and again as cost of goods when the
// item sells — which can show a profitable month as a loss. Warn at the point
// of entry; don't silently drop it from profit, because for anyone NOT recording
// cost prices this expense is their only record of what the stock cost.
function expCatChanged() {
  const host = document.getElementById("expWarn");
  const sel = document.getElementById("expCat");
  if (!host || !sel) return;
  host.innerHTML = (sel.value === STOCK_CAT && window._expTracksCost)
    ? `<div class="warn-note"><strong>This may count twice.</strong>
        You already record what your stock costs on each product, and SalesPal
        subtracts that from profit when the item sells. Adding the restock here
        as well takes it off your profit a second time.
        <span style="display:block;margin-top:6px">Only log it here if you do
        <em>not</em> keep cost prices on your products.</span></div>`
    : "";
}
async function saveExpense() {
  const amount = parseFloat(document.getElementById("expAmt").value);
  if (!amount || amount <= 0) return toast("Enter a valid amount");
  await api.send("/api/expenses", "POST", { amount,
    category: document.getElementById("expCat").value,
    description: document.getElementById("expDesc").value });
  closeModal(); toast("Expense added"); render();
}
function delExpense(id) { toast("Deleted"); _optimistic(() => api.send(`/api/expenses/${id}`, "DELETE")); }

// One debtor row — a customer and everything they owe across invoices. Shared by
// the Owed tab and the dashboard's Owed card, so the two can't drift apart.
// The buttons cover the whole customer: Paid settles all their invoices at once,
// Statement is the multi-invoice stand-in for a single receipt, Remind chases the
// combined balance in one message. `/api/customers` already sorts biggest-first.
function owedCustomerRowHtml(c) {
  const n = c.unpaid_count || 1;
  return `<div class="list-row actions-below">
    <div style="flex:1;min-width:0"><div class="main">${esc(c.name || "Customer")}</div>
      <div class="meta">${n} unpaid invoice${n > 1 ? "s" : ""}</div></div>
    <div class="amount neg">${money(c.owed)}</div>
    <div class="row-actions">
      <button class="wa-mini paid" onclick='settleCustomer(${attrJson({ id: c.id, name: c.name, owed: c.owed, unpaid_count: c.unpaid_count })})'><svg class="ic"><use href="#i-check-circle"/></svg> Paid</button>
      <button class="wa-mini receipt" onclick='shareStatement(${attrJson(c)}, "png")'><svg class="ic"><use href="#i-image"/></svg> Statement</button>
      <button class="wa-mini" onclick='customerReminder(${attrJson(c)})'><svg class="ic"><use href="#i-chat"/></svg> Remind</button>
    </div>
  </div>`;
}

// Settle a whole customer — every unpaid invoice marked paid in one call. Records
// money across possibly several invoices and can't be bulk-undone, so confirm with
// the name and total first. Online-only, like edit/delete (no offline queue).
async function settleCustomer(c) {
  const n = c.unpaid_count || 1;
  if (!confirm(`Mark all ${n} unpaid invoice${n > 1 ? "s" : ""} for ${c.name || "this customer"} as paid?\n\nTotal ${money(c.owed)}`)) return;
  try {
    const r = await api.send(`/api/customers/${c.id}/settle`, "POST");
    toast(`Marked ${r.count} invoice${r.count === 1 ? "" : "s"} paid ✓`);
    // One receipt covering everything just cleared — beats sending the customer
    // a separate receipt per invoice for the same payment.
    if (navigator.onLine && r.invoice_ids && r.invoice_ids.length)
      settleReceiptOffer(c, r.invoice_ids, r.total);
    render();
  } catch (e) {
    if (e.message !== "__auth__" && e.message !== "__upgrade__") toast(e.message || "Couldn't mark paid");
  }
}

// Show the combined receipt straight after settling, ready to send.
function settleReceiptOffer(c, ids, total) {
  const list = ids.join(",");
  const n = ids.length;
  openModal(`<h2>Payment recorded ✓</h2>
    <p style="color:var(--muted);font-size:14px;margin:0 0 12px">One receipt for
      <strong>${money(total)}</strong> covering ${n} invoice${n === 1 ? "" : "s"} — send it to ${esc(c.name || "your customer")}.</p>
    <img src="/api/customers/${c.id}/settle-receipt?ids=${list}&fmt=png&t=${Date.now()}" alt="Receipt"
      style="width:100%;border:1px solid var(--line);border-radius:12px;margin-bottom:12px" />
    <button class="btn" onclick='shareSettleReceipt(${attrJson({ id: c.id, name: c.name })}, "${list}", ${total}, "png")'><svg class="ic"><use href="#i-send"/></svg> Send receipt</button>
    <button class="btn secondary" style="margin-top:10px" onclick='shareSettleReceipt(${attrJson({ id: c.id, name: c.name })}, "${list}", ${total}, "jpg")'>Download JPG</button>
    <button class="btn ghost" style="margin-top:10px" onclick="closeModal()">Done</button>`);
}

async function shareSettleReceipt(c, ids, total, fmt) {
  const biz = (state.settings && state.settings.business_name) || "SalesPal";
  await shareImageFile(`/api/customers/${c.id}/settle-receipt?ids=${ids}&fmt=${fmt}`,
    `Receipt-${(c.name || "customer").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "customer"}.${fmt}`,
    `Receipt — ${c.name || "customer"}`,
    `${biz} — payment of ${money(total)} received with thanks. Please find your receipt attached.`);
}

// Jump straight to the full debtors list (the Owed tab lives inside Money).
function openOwed() { moneyTab = "owed"; setView("money"); }

async function renderOwed() {
  // The debt book: one row per customer, their whole balance, biggest first.
  const debtors = (await api.get("/api/customers")).filter(c => Number(c.owed) > 0.01);
  const total = debtors.reduce((s, c) => s + Number(c.owed), 0);
  document.getElementById("moneyBody").innerHTML = `
    <div class="card">
      <div class="section-title">Outstanding · ${money(total)} owed to you</div>
      ${debtors.length ? debtors.map(owedCustomerRowHtml).join("")
        : `<div class="empty"><div class="big"><svg class="ic"><use href="#i-check-circle"/></svg></div>Everyone has paid up!</div>`}
    </div>`;
}

// ---------- INSIGHTS ----------
async function viewInsights() {
  const pro = isPro();
  const proTag = pro ? "" : ` <span class="pill pro">PRO</span>`;
  app.innerHTML = `
    <div class="card">
      <div class="section-title"><svg class="ic"><use href="#i-insights"/></svg> Grow my business${proTag}</div>
      <p style="font-size:14px;color:var(--muted);margin:0 0 12px">
        Get specific advice from SalesPal on increasing your sales and profit, based on your real numbers.</p>
      ${pro
        ? `<div class="field"><input id="advQ" placeholder="Ask anything — e.g. which product should I stop selling?"
             onkeydown="if(event.key==='Enter')loadAdvice()"></div>
           <div class="btn-row">
             <button class="btn" onclick="loadAdvice()"><svg class="ic"><use href="#i-ai"/></svg> Ask</button>
             <button class="btn secondary" onclick="loadAdvice('')">Get advice (${state.period})</button>
           </div>`
        : `<button class="btn" onclick="showUpgrade('AI advice is a Pro feature.')"><svg class="ic"><use href="#i-lock"/></svg> Unlock with Pro</button>`}
    </div>
    <div class="card">
      <div class="section-title"><svg class="ic"><use href="#i-calendar"/></svg> Weekly report${proTag}</div>
      <p style="font-size:14px;color:var(--muted);margin:0 0 12px">
        A summary of this week vs last week — sales, profit, expenses and what to focus on.</p>
      ${pro
        ? `<button class="btn secondary" onclick="loadWeekly()">Generate weekly report</button>
           <p style="font-size:12px;color:var(--muted);margin:10px 0 0">Auto-generated every Sunday and saved below.</p>`
        : `<button class="btn secondary" onclick="showUpgrade('Weekly AI reports are a Pro feature.')"><svg class="ic"><use href="#i-lock"/></svg> Unlock with Pro</button>`}
    </div>
    <div id="insightOut"></div>
    <div class="card"><div class="section-title"><svg class="ic"><use href="#i-file"/></svg> Saved weekly reports</div>
      <div id="savedReports"><div class="empty">Loading…</div></div></div>`;
  loadSavedReports();
}
async function loadSavedReports() {
  const host = document.getElementById("savedReports");
  try {
    const reports = await api.get("/api/reports");
    window._reports = reports;
    host.innerHTML = reports.length ? reports.map(r => `
      <div class="list-row" onclick="openReport(${r.id})">
        <div><div class="main">${esc(r.title || "Weekly report")}</div>
          <div class="meta">${fmtDate(r.created_at)}</div></div>
        <div class="meta">View ›</div>
      </div>`).join("") : `<div class="empty">No saved reports yet</div>`;
  } catch (e) { host.innerHTML = `<div class="empty">Couldn't load reports</div>`; }
}
function openReport(id) {
 const r = (window._reports || []).find(x => x.id === id);
 if (!r) return;
 openModal(`<h2>${esc(r.title || "Weekly report")}</h2>
 <div class="meta" style="color:var(--muted);margin-bottom:10px">${fmtDate(r.created_at)}</div>
 <div class="card"><div class="md">${md(r.content || "")}</div></div>`);
}
// q undefined → whatever is typed in the box; q "" → the standard period advice.
async function loadAdvice(q) {
 const box = document.getElementById("advQ");
 if (q === undefined) q = box ? box.value.trim() : "";
 const out = document.getElementById("insightOut");
 out.innerHTML = `<div class="card"><div class="loading">${q ? "SalesPal is checking your numbers…" : "SalesPal is generating your advice…"}</div></div>`;
 try {
   const r = await api.get(`/api/insights/advice?period=${state.period}&q=${encodeURIComponent(q)}`);
   out.innerHTML = `<div class="card">${q ? `<div class="section-title">${esc(q)}</div>` : ""}<div class="md">${md(r.text)}</div></div>`;
 } catch (e) {
   out.innerHTML = "";
   if (e.message !== "__upgrade__" && e.message !== "__auth__") toast(e.message || "Couldn't get an answer");
 }
}
async function loadWeekly() {
 const out = document.getElementById("insightOut");
 out.innerHTML = `<div class="card"><div class="loading">Building your weekly report…</div></div>`;
 const r = await api.get(`/api/insights/weekly`);
 const m = r.metrics ? r.metrics.this_week : null;
 const head = m ? `<div class="kpi-grid">
 <div class="kpi"><div class="label">Sales this week</div><div class="value">${money(m.revenue)}</div></div>
 <div class="kpi"><div class="label">Profit this week</div><div class="value ${m.net_profit>=0?'pos':'neg'}">${money(m.net_profit)}</div></div>
 </div>` : "";
 out.innerHTML = head + `<div class="card"><div class="md">${md(r.text)}</div></div>`;
 loadSavedReports();
}

// ---------- PRODUCTS ----------
async function viewProducts() {
 const products = await api.get("/api/products");
 app.innerHTML = `
 <button class="btn" onclick="productModal()" style="margin-bottom:14px">＋ Add product</button>
 <div class="card"><div class="section-title">Products</div>
 ${products.length ? products.map(p => {
 const margin = p.unit_price ? Math.round((p.unit_price - p.unit_cost) / p.unit_price * 100) : 0;
 const low = p.low_stock_at > 0 && p.stock_qty <= p.low_stock_at;
 return `<div class="list-row" onclick='productModal(${attrJson(p)})'>
 <div style="flex:1;min-width:0"><div class="main">${esc(p.name)} ${low ? '<span class="badge unpaid">low stock</span>' : ''}</div>
 <div class="meta">Cost ${money(p.unit_cost)} · ${margin}% margin · <span class="${low ? 'neg' : ''}">${p.stock_qty} in stock</span></div></div>
 <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
 ${(low && p.suppliers && p.suppliers.length) ? `<button class="wa-mini call" onclick='event.stopPropagation(); callSupplier(${attrJson(p)})'>Supplier</button>` : ""}
 <div class="amount">${money(p.unit_price)}</div></div></div>`;
 }).join("") : `<div class="empty"><div class="big"></div>No products yet</div>`}
 </div>`;
}
function productModal(p) {
 p = p || {};
 if (!p.id && !requireShop()) return; // new products need a specific shop
 openModal(`<h2>${p.id ? "Edit" : "Add"} product</h2>
 <div class="field"><label>Name</label><input id="pName" value="${esc(p.name || "")}"></div>
 <div class="field-row">
 <div class="field"><label>Selling price</label><input id="pPrice" type="number" inputmode="decimal" value="${p.unit_price || 0}"></div>
 <div class="field"><label>Unit cost</label><input id="pCost" type="number" inputmode="decimal" value="${p.unit_cost || 0}"></div>
 </div>
 ${p.id ? `<div class="field"><label>Photo \u2014 shown on your promo flyer</label>
 <div style="display:flex;align-items:center;gap:12px">
 <img id="pPhotoPrev" src="/api/products/${p.id}/photo?t=${Date.now()}"
 onerror="this.style.display='none'"
 style="width:56px;height:56px;object-fit:cover;border-radius:10px;border:1px solid var(--line)">
 <input id="pPhotoFile" type="file" accept="image/*" style="font-size:13px"
 onchange="uploadProductPhoto(${p.id})">
 </div></div>` : ""}
 ${p.id ? `<button type="button" class="btn secondary btn-sm" style="margin:-4px 0 14px" onclick='priceCheckModal(${attrJson(p)})'>Price check — should I charge more or less?</button>` : ""}
 <div class="field-row">
 <div class="field"><label>Current stock</label><input id="pStock" type="number" inputmode="decimal" value="${p.stock_qty || 0}"></div>
 <div class="field"><label>Alert at / below</label><input id="pLow" type="number" inputmode="decimal" value="${p.low_stock_at || 0}"></div>
 </div>
 <p style="font-size:12px;color:var(--muted);margin:-4px 0 14px">Stock drops automatically as you record sales. Set "alert at" above 0 to get a low-stock warning (0 = off).</p>
 <div class="field"><label>Suppliers — who you reorder from</label>
 <div id="supList">${((p.suppliers && p.suppliers.length) ? p.suppliers : []).map(supplierRowHtml).join("")}</div>
 <button class="btn secondary btn-sm" type="button" onclick="addSupplierRow()">＋ Add supplier</button>
 <p style="font-size:12px;color:var(--muted);margin:8px 0 0">Add one or more. When stock runs low you can call them to restock in one tap.</p>
 </div>
 <button class="btn" style="margin-top:14px" onclick="saveProduct(${p.id || 0})">Save</button>
 ${p.id ? `<button class="btn danger" style="margin-top:10px" onclick="delProduct(${p.id})">Delete</button>` : ""}`);
}
// "What if I change the price?" — deterministic break-even math from the server
// plus Claude's advice on customer reaction (Pro; 402 opens the paywall).
async function uploadProductPhoto(id) {
  const inp = document.getElementById("pPhotoFile");
  if (!inp || !inp.files || !inp.files[0]) return;
  const fd = new FormData();
  fd.append("file", inp.files[0]);
  try { await api.sendForm(`/api/products/${id}/photo`, fd); }
  catch (e) { toast(e.message || "Couldn't upload photo"); return; }
 const prev = document.getElementById("pPhotoPrev");
 if (prev) { prev.style.display = ""; prev.src = `/api/products/${id}/photo?t=${Date.now()}`; }
 toast("Photo added \u2014 it'll show on your promo flyer");
}

function priceCheckModal(p) {
  const margin = p.unit_price ? Math.round((p.unit_price - p.unit_cost) / p.unit_price * 100) : 0;
  openModal(`<h2><svg class="ic"><use href="#i-trend-up"/></svg> Price check</h2>
    <p style="font-size:14px;color:var(--muted);margin:0 0 14px">${esc(p.name)} — selling at <b>${money(p.unit_price)}</b>, cost ${money(p.unit_cost)} (${margin}% margin).</p>
    <div class="field"><label>New price to test</label><input id="pcPrice" type="number" inputmode="decimal" value="${p.unit_price || 0}"></div>
    <div style="display:flex;gap:8px;margin:-4px 0 14px">
      <button type="button" class="btn secondary btn-sm" onclick="pcNudge(${p.unit_price || 0}, -10)">−10%</button>
      <button type="button" class="btn secondary btn-sm" onclick="pcNudge(${p.unit_price || 0}, 10)">+10%</button>
    </div>
    <button class="btn" onclick="runPriceCheck(${p.id})">Check this price</button>
    <div id="pcOut"></div>`);
}
function pcNudge(base, pct) {
  const el = document.getElementById("pcPrice");
  if (el) el.value = Math.round(base * (1 + pct / 100));
}
async function runPriceCheck(id) {
  const v = parseFloat(document.getElementById("pcPrice").value) || 0;
  if (v <= 0) return toast("Enter the new price");
  const out = document.getElementById("pcOut");
  out.innerHTML = `<div class="loading">SalesPal is checking your numbers…</div>`;
  let r;
  try {
    r = await api.send(`/api/products/${id}/price-advice`, "POST", { new_price: v });
  } catch (e) {
    out.innerHTML = "";
    if (e.message !== "__upgrade__" && e.message !== "__auth__") toast(e.message || "Couldn't get advice");
 return;
 }
 const m = r.math;
 const be = m.below_cost
 ? ` <b>Below cost</b> — at this price you lose money on every sale.`
 : m.can_lose_sales_pct != null
 ? `You could lose up to <b>${m.can_lose_sales_pct}% of sales</b> and still make the same profit.`
 : m.need_more_sales_pct != null
 ? `You'd need <b>${m.need_more_sales_pct}% more sales</b> just to make the same profit.` : "";
  const hist = m.units_90d
    ? `<div class="meta" style="margin-top:6px">Last 90 days: ${m.units_90d} sold across ${m.sales_90d} sale${m.sales_90d === 1 ? "" : "s"}${m.breakeven_units_90d ? ` · break-even at this price: ${m.breakeven_units_90d}` : ""}</div>`
    : `<div class="meta" style="margin-top:6px">No sales recorded for this product in the last 90 days.</div>`;
  out.innerHTML = `
    <div class="kpi-grid" style="margin-top:16px">
      <div class="kpi"><div class="label">Margin now</div><div class="value">${money0(m.current_margin)} · ${m.current_margin_pct}%</div></div>
      <div class="kpi"><div class="label">Margin after</div><div class="value ${m.new_margin < m.current_margin ? "neg" : "pos"}">${money0(m.new_margin)} · ${m.new_margin_pct}%</div></div>
    </div>
    ${be ? `<div class="card" style="margin-top:12px"><div style="font-size:14px">${be}</div>${hist}</div>` : ""}
    <div class="card" style="margin-top:12px"><div class="md">${md(r.ai.text)}</div></div>`;
}

// One editable supplier row (name + phone + remove) in the product form.
function supplierRowHtml(s) {
  s = s || {};
  return `<div class="sup-row">
    <input class="sup-name" placeholder="Supplier name" value="${esc(s.name || "")}">
    <input class="sup-phone" placeholder="Phone" inputmode="tel" value="${esc(s.phone || "")}">
    <button type="button" class="sup-del" onclick="this.closest('.sup-row').remove()" aria-label="Remove supplier"><svg class="ic"><use href="#i-close"/></svg></button>
  </div>`;
}
function addSupplierRow() {
  const list = document.getElementById("supList");
  if (list) list.insertAdjacentHTML("beforeend", supplierRowHtml());
}
async function saveProduct(id) {
  const suppliers = [...document.querySelectorAll("#supList .sup-row")].map(r => ({
    name: r.querySelector(".sup-name").value.trim(),
    phone: r.querySelector(".sup-phone").value.trim(),
  })).filter(s => s.name || s.phone);
  const body = { name: document.getElementById("pName").value,
    unit_price: parseFloat(document.getElementById("pPrice").value) || 0,
    unit_cost: parseFloat(document.getElementById("pCost").value) || 0,
    stock_qty: parseFloat(document.getElementById("pStock").value) || 0,
    low_stock_at: parseFloat(document.getElementById("pLow").value) || 0,
    suppliers };
  if (!body.name) return toast("Enter a product name");
  if (id) await api.send(`/api/products/${id}`, "PUT", body);
  else await api.send("/api/products", "POST", body);
  closeModal(); toast("Product saved"); render();
}
// Reorder a low product: list its suppliers with one-tap Call / WhatsApp.
function callSupplier(product) {
  const sups = (product && product.suppliers) || [];
  if (!sups.length) { toast("No supplier saved for this product yet"); return; }
  openModal(`<h2><svg class="ic"><use href="#i-phone"/></svg> Call supplier</h2>
    <p style="font-size:13px;color:var(--muted);margin:-6px 0 14px">Reorder ${esc(product.name || "this product")}</p>
    ${sups.map(s => `<div class="list-row">
      <div style="flex:1;min-width:0"><div class="main">${esc(s.name || "Supplier")}</div>
        <div class="meta">${esc(s.phone || "No number")}</div></div>
      <div style="display:flex;gap:6px;flex-shrink:0">
        ${telNumber(s.phone) ? `<button class="wa-mini call" onclick='phoneCall(${attrJson({ phone: s.phone })})'><svg class="ic"><use href="#i-phone"/></svg> Call</button>` : ""}
        ${waNumber(s.phone) ? `<button class="wa-mini" onclick='whatsappCall(${attrJson({ name: s.name, phone: s.phone })})'><svg class="ic"><use href="#i-chat"/></svg> WhatsApp</button>` : ""}
      </div></div>`).join("")}
    <button class="btn secondary" style="margin-top:14px" onclick="closeModal()">Close</button>`);
}
function delProduct(id) { closeModal(); toast("Deleted"); _optimistic(() => api.send(`/api/products/${id}`, "DELETE")); }

// ---------- SUPPLIERS (restock orders) ----------
// Suppliers come from the per-product supplier lists (Products → edit). We group
// those across the shop's products so you can build a restock order per supplier
// and fire it off on WhatsApp. ponytail: the supplier price defaults to the
// product's unit cost (editable per line, not saved) — add a per-supplier saved
// price list only if merchants actually keep different prices per supplier.
const _supLow = (p) => (p.low_stock_at || 0) > 0 && (p.stock_qty || 0) <= p.low_stock_at;
async function viewSuppliers() {
  const products = await api.get("/api/products");
  const map = new Map();
  for (const p of products) {
    for (const s of (p.suppliers || [])) {
      const key = waNumber(s.phone) || (s.name || "").trim().toLowerCase();
      if (!key) continue;
      let g = map.get(key);
      if (!g) { g = { name: (s.name || "").trim() || "Supplier", phone: s.phone || "", products: [] }; map.set(key, g); }
      if (!g.phone && s.phone) g.phone = s.phone;
      g.products.push({ id: p.id, name: p.name, unit_cost: p.unit_cost || 0,
        stock_qty: p.stock_qty || 0, low_stock_at: p.low_stock_at || 0 });
    }
  }
  const suppliers = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (!suppliers.length) {
    app.innerHTML = `<div class="card"><div class="empty"><div class="big"><svg class="ic"><use href="#i-suppliers"/></svg></div>
      No suppliers yet.<br>Add a supplier to a product, then come back to build restock orders.</div>
      <button class="btn secondary" onclick="setView('products')">Go to Products</button></div>`;
    return;
  }
  app.innerHTML = `<div class="card"><div class="section-title">Suppliers</div>
      <p style="font-size:13px;color:var(--muted);margin:0">Build a restock order and send it straight to the supplier on WhatsApp.</p></div>
    ${suppliers.map(g => {
      const low = g.products.filter(_supLow).length;
      return `<div class="card list-row" style="cursor:pointer" onclick='supplierOrder(${attrJson(g)})'>
        <div style="flex:1;min-width:0"><div class="main">${esc(g.name)}</div>
          <div class="meta">${g.products.length} product${g.products.length > 1 ? "s" : ""}${low ? ` · <span class="neg">${low} low</span>` : ""}${g.phone ? ` · ${esc(g.phone)}` : " · no number"}</div></div>
        <div class="amount"><svg class="ic"><use href="#i-sales"/></svg></div></div>`;
    }).join("")}`;
}
function supplierOrder(g) {
  // low-stock items first so what actually needs reordering is at the top
  const rows = [...(g.products || [])].sort((a, b) =>
    (_supLow(b) ? 1 : 0) - (_supLow(a) ? 1 : 0) || a.name.localeCompare(b.name));
  const num = waNumber(g.phone);
  openModal(`<h2><svg class="ic"><use href="#i-suppliers"/></svg> Order from ${esc(g.name)}</h2>
    <p style="font-size:13px;color:var(--muted);margin:-6px 0 12px">Set how many to reorder. Price is your cost — edit it if the supplier's price changed.</p>
 <div class="po-head"><span>Product</span><span>Qty</span><span>Price</span></div>
 <div id="poRows">
 ${rows.map(p => `<div class="po-row" data-name="${esc(p.name)}">
 <div class="po-name">${esc(p.name)} ${_supLow(p) ? '<span class="badge unpaid">low</span>' : ""}<div class="po-sub">${(+p.stock_qty).toLocaleString()} in stock</div></div>
 <input class="po-qty" type="number" inputmode="numeric" min="0" placeholder="0" oninput="supplierOrderTotal()">
 <input class="po-price" type="number" inputmode="decimal" min="0" value="${p.unit_cost || 0}" oninput="supplierOrderTotal()">
 </div>`).join("")}
 </div>
 <div class="goal-meta" style="margin-top:12px"><strong>Order total</strong><strong id="poTotal">${money(0)}</strong></div>
 ${num
 ? `<button class="btn whatsapp" style="margin-top:14px" onclick='sendSupplierOrder(${attrJson(g)})'>Send order on WhatsApp</button>`
 : `<button class="btn" style="margin-top:14px" onclick='copySupplierOrder(${attrJson(g)})'>Copy order</button>`}
 <button class="btn secondary" style="margin-top:10px" onclick="closeModal()">Close</button>`);
}
function supplierOrderTotal() {
 let total = 0;
 document.querySelectorAll("#poRows .po-row").forEach(r => {
 const q = parseFloat(r.querySelector(".po-qty").value) || 0;
 const pr = parseFloat(r.querySelector(".po-price").value) || 0;
 if (q > 0) total += q * pr;
 });
 const el = document.getElementById("poTotal");
 if (el) el.textContent = money(total);
}
// Build the WhatsApp order text from the current inputs (null if nothing set).
function _supplierOrderMsg(g) {
 const lines = [];
 let total = 0;
 document.querySelectorAll("#poRows .po-row").forEach(r => {
 const q = parseFloat(r.querySelector(".po-qty").value) || 0;
 if (q <= 0) return;
 const pr = parseFloat(r.querySelector(".po-price").value) || 0;
 total += q * pr;
 lines.push(`• ${r.dataset.name} — ${(+q).toLocaleString()} × ${money(pr)} = ${money(q * pr)}`);
 });
 if (!lines.length) { toast("Set a quantity for at least one item"); return null; }
 const biz = (state.settings && state.settings.business_name) || "us";
 const who = g.name && g.name !== "Supplier" ? g.name : "there";
 return `Hello ${who}, I'd like to place a restock order for ${biz}:\n\n`
    + lines.join("\n") + `\n\nTotal: ${money(total)}\n\nPlease confirm availability and delivery. Thank you!`;
}
function sendSupplierOrder(g) {
  const msg = _supplierOrderMsg(g);   // sync → keeps the WhatsApp deep-link in the tap gesture
  if (!msg) return;
  const num = waNumber(g.phone);
  if (!num) return copySupplierOrder(g);
  _openWhatsApp(num, msg);
}
function copySupplierOrder(g) {
  const msg = _supplierOrderMsg(g);
  if (!msg) return;
  if (navigator.share) { navigator.share({ text: msg }).catch(() => {}); return; }
  if (navigator.clipboard) navigator.clipboard.writeText(msg);
  toast("Order copied — paste it to your supplier");
}

// ---------- CUSTOMERS ----------
async function viewCustomers() {
  const customers = await api.get("/api/customers");
  // Debt book: the server already sorts biggest debtor first.
  const debtors = customers.filter(c => Number(c.owed) > 0.01);
  const total = debtors.reduce((s, c) => s + Number(c.owed), 0);
  const owedCard = debtors.length ? `
    <div class="card">
      <div class="os-label">You're owed</div>
      <div class="os-value warn" style="font-size:26px">${money0(total)}</div>
      <div class="meta">${debtors.length} customer${debtors.length > 1 ? "s" : ""} owing${
        debtors[0].name ? ` · most is ${esc(debtors[0].name)} (${money0(debtors[0].owed)})` : ""}</div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn" onclick="shareStatement()"><svg class="ic"><use href="#i-send"/></svg> Share</button>
        <a class="btn secondary" href="/api/debts/pdf" target="_blank"><svg class="ic"><use href="#i-file"/></svg> PDF</a>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn outline" onclick="shareStatement(null,'png')"><svg class="ic"><use href="#i-image"/></svg> PNG</button>
        <button class="btn outline" onclick="shareStatement(null,'jpg')"><svg class="ic"><use href="#i-image"/></svg> JPG</button>
      </div>
    </div>` : "";
  app.innerHTML = `
    ${owedCard}
    <button class="btn" onclick="customerModal()" style="margin-bottom:14px">＋ Add customer</button>
    <div class="card"><div class="section-title">Customers</div>
      ${customers.length ? customers.map(c => {
        const owed = Number(c.owed) || 0;
        return `
        <div class="list-row" onclick='customerModal(${attrJson(c)})'>
          <div style="flex:1;min-width:0"><div class="main">${esc(c.name)}</div>
            <div class="meta">${owed > 0.01
              ? `<span class="neg">owes ${money0(owed)}</span> · ${c.unpaid_count} unpaid`
              : esc(c.phone || c.email || "")}</div></div>
          <div style="display:flex;gap:6px;flex-shrink:0">
            ${owed > 0.01 ? `<button class="wa-mini" onclick='event.stopPropagation(); customerReminder(${attrJson(c)})'><svg class="ic"><use href="#i-chat"/></svg> Remind</button>` : ""}
            ${waNumber(c.phone) ? `
              <button class="wa-mini call" onclick='event.stopPropagation(); phoneCall(${attrJson({ phone: c.phone })})'><svg class="ic"><use href="#i-phone"/></svg> Call</button>
              ${owed > 0.01 ? "" : `<button class="wa-mini" onclick='event.stopPropagation(); whatsappCall(${attrJson({ id: c.id, name: c.name, phone: c.phone })})'><svg class="ic"><use href="#i-chat"/></svg> WhatsApp</button>`}` : ""}
          </div>
        </div>`; }).join("")
        : `<div class="empty"><div class="big"><svg class="ic"><use href="#i-customers"/></svg></div>No customers yet</div>`}
    </div>`;
}

// Chase a customer for EVERYTHING they owe in one message, rather than one
// reminder per invoice. Called straight from the tap (see _openWhatsApp).
function customerReminder(c) {
  const num = _waResolveNumber(c);
  if (!num) return;
  const biz = (state.settings && state.settings.business_name) || "us";
  const accts = (state.pay && state.pay.accounts) || [];
  const a = (state.pay && state.pay.transfer_enabled)
    ? (accts.find(x => x.is_default) || accts[0]) : null;
  const bank = a && a.number
    ? `\n\nTransfer to:\n${a.number}\n${a.bank}${a.name ? `\n${a.name}` : ""}` : "";
  const across = c.unpaid_count > 1 ? ` across ${c.unpaid_count} invoices` : "";
  _openWhatsApp(num, `Hi ${c.name || "there"}, a friendly reminder from ${biz}: `
    + `you have an outstanding balance of ${money(c.owed)}${across}. `
    + `Kindly arrange payment when you can. Thank you!` + bank);
}
// Share the statement as a FILE, so it lands in a WhatsApp chat as an attachment
// instead of a link only the merchant can open. Same path as invoice sharing:
// native share sheet → Web Share → download. No arg = the whole debt book.
// fmt "png"/"jpg" sends the image version instead (previews inline in the chat
// rather than arriving as a document the customer has to open).
async function shareStatement(c, fmt) {
  const biz = (state.settings && state.settings.business_name) || "SalesPal";
  const path = fmt ? `/api/debts/image?fmt=${fmt}` : "/api/debts/pdf";
  const ext = fmt || "pdf";
  const mime = fmt ? (fmt === "jpg" ? "image/jpeg" : "image/png") : "application/pdf";
  if (!c) {
    return _shareFile(path, `who-owes-me.${ext}`, mime,
      "Who owes me", `${biz} — outstanding customer balances`);
  }
  const slug = (c.name || "customer").toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "customer";
  const across = c.unpaid_count > 1 ? ` across ${c.unpaid_count} invoices` : "";
  await _shareFile(`${path}${fmt ? "&" : "?"}customer_id=${c.id}`,
    `statement-${slug}.${ext}`, mime, `Statement — ${c.name || "customer"}`,
    `Hi ${c.name || "there"}, here's your statement of account from ${biz}. `
    + `Outstanding balance: ${money(c.owed)}${across}. Kindly see the attached.`);
}
function customerModal(c) {
  c = c || {};
  openModal(`<h2>${c.id ? "Edit" : "Add"} customer</h2>
    ${c.id && waNumber(c.phone) ? `<div style="display:flex;gap:10px;margin-bottom:14px">
      <button class="btn" style="flex:1" onclick='phoneCall(${attrJson({ phone: c.phone })})'><svg class="ic"><use href="#i-phone"/></svg> Call</button>
      <button class="btn" style="flex:1;background:#25d366" onclick='whatsappCall(${attrJson({ id: c.id, name: c.name, phone: c.phone })})'><svg class="ic"><use href="#i-chat"/></svg> WhatsApp</button>
    </div>` : ""}
    ${Number(c.owed) > 0.01 ? `<div class="card" style="margin-bottom:14px">
      <div class="os-label">Owes</div><div class="os-value warn">${money0(c.owed)}</div>
      <div class="meta">${c.unpaid_count} unpaid invoice${c.unpaid_count > 1 ? "s" : ""}</div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn" onclick='shareStatement(${attrJson({ id: c.id, name: c.name, owed: c.owed, unpaid_count: c.unpaid_count })})'><svg class="ic"><use href="#i-send"/></svg> Send statement</button>
        <a class="btn secondary" href="/api/debts/pdf?customer_id=${c.id}" target="_blank"><svg class="ic"><use href="#i-file"/></svg> PDF</a>
      </div>
      <div class="btn-row" style="margin-top:8px">
        <button class="btn outline" onclick='shareStatement(${attrJson({ id: c.id, name: c.name, owed: c.owed, unpaid_count: c.unpaid_count })},"png")'><svg class="ic"><use href="#i-image"/></svg> PNG</button>
        <button class="btn outline" onclick='shareStatement(${attrJson({ id: c.id, name: c.name, owed: c.owed, unpaid_count: c.unpaid_count })},"jpg")'><svg class="ic"><use href="#i-image"/></svg> JPG</button>
      </div>
    </div>` : ""}
    <div class="field"><label>Name</label><input id="cName" value="${esc(c.name || "")}"></div>
    <div class="field"><label>Phone</label><input id="cPhone" value="${esc(c.phone || "")}"></div>
    <div class="field"><label>Email</label><input id="cEmail" value="${esc(c.email || "")}"></div>
    <div class="field"><label>Address</label><input id="cAddr" value="${esc(c.address || "")}"></div>
    <button class="btn" onclick="saveCustomer(${c.id || 0})">Save</button>
    ${c.id ? `<button class="btn danger" style="margin-top:10px" onclick="delCustomer(${c.id})">Delete</button>` : ""}`);
}
async function saveCustomer(id) {
  const body = { name: document.getElementById("cName").value,
    phone: document.getElementById("cPhone").value,
    email: document.getElementById("cEmail").value,
    address: document.getElementById("cAddr").value };
  if (!body.name) return toast("Enter a name");
  if (id) await api.send(`/api/customers/${id}`, "PUT", body);
  else await api.send("/api/customers", "POST", body);
  closeModal(); toast("Customer saved"); render();
}
function delCustomer(id) { closeModal(); toast("Deleted"); _optimistic(() => api.send(`/api/customers/${id}`, "DELETE")); }

// ---------- ORDERS (public storefront) ----------
async function viewOrders() {
  const st = state.orders || {};
  const pro = isPro();
  let linkCard;
  if (!pro) {
    linkCard = `<div class="card">
      <div class="section-title"><svg class="ic"><use href="#i-orders"/></svg> Take orders online <span class="pill">PRO</span></div>
      <p style="font-size:14px;color:var(--muted);margin:0 0 12px">Share one link with customers and WhatsApp groups. They order from what's in stock and it lands here for you to fulfil.</p>
 <button class="btn" onclick="showUpgrade('Take orders online — share a live shop link with your customers.')">Upgrade to Pro</button>
 </div>`;
 } else if (!state.activeShop) {
 linkCard = `<div class="card"><div class="section-title">Order link</div>
 <p style="font-size:14px;color:var(--muted);margin:0">Open a specific shop (tap the name at the top) to share its order link — each shop has its own.</p></div>`;
 } else if (st.enabled && st.url) {
 linkCard = `<div class="card">
 <div class="section-title">Your order link is live</div>
 <p style="font-size:13px;color:var(--muted);margin:0 0 10px">Customers at <strong>${esc(activeShopName())}</strong> order from your in-stock items.</p>
 <div class="orderlink">${esc(st.url)}</div>
 <div class="btn-row" style="margin-top:12px">
 <button class="btn whatsapp" onclick="shareOrderLink('whatsapp')">Share on WhatsApp</button>
 <button class="btn secondary" onclick="shareOrderLink('copy')">Copy link</button>
 </div>
 ${alertsRowHtml()}
 <button class="btn ghost" style="margin-top:10px" onclick="disableOrders()">Turn off orders</button>
 </div>`;
 } else {
 linkCard = `<div class="card">
 <div class="section-title">Take orders online</div>
 <p style="font-size:14px;color:var(--muted);margin:0 0 12px">Turn on a shareable link for <strong>${esc(activeShopName())}</strong>. Customers order from what's in stock and it arrives here to fulfil.</p>
      <button class="btn" onclick="enableOrders()">Create my order link</button>
    </div>`;
  }

  // Customers who send their order as a WhatsApp voice note instead of using the
  // link — share the note here and it lands in the same pending list.
  const voiceCard = `<div class="card">
    <div class="section-title">Order from a voice note</div>
    <p style="font-size:14px;color:var(--muted);margin:0 0 12px">A customer sent their order as a voice note? Share it here and it becomes a pending order you can fulfil.</p>
    <input id="voFile" type="file" accept="audio/*" style="display:none" onchange="uploadVoiceOrder()">
    <button class="btn secondary" onclick="document.getElementById('voFile').click()">🎤 Add a voice note</button>
  </div>`;

  let listHtml = `<div class="card"><div class="loading">Loading orders…</div></div>`;
  app.innerHTML = linkCard + voiceCard + `<div id="ordersList">${listHtml}</div>`;

  try {
    const orders = await api.get("/api/orders");
    window._orders = orders;
    const pending = orders.filter(o => o.status === "pending");
    const past = orders.filter(o => o.status !== "pending");
    const row = (o) => `<div class="list-row" onclick='orderDetail(${attrJson(o)})'>
      <div style="flex:1;min-width:0"><div class="main">${esc(o.customer_name || "Customer")} ${orderBadge(o.status)}</div>
        <div class="meta">${o.items.length} item${o.items.length > 1 ? "s" : ""} · ${fmtDate(o.created_at)}</div></div>
      <div class="amount">${money(o.total)}</div></div>`;
    document.getElementById("ordersList").innerHTML =
      `<div class="card"><div class="section-title">Pending${pending.length ? ` · ${pending.length}` : ""}</div>
        ${pending.length ? pending.map(row).join("") : `<div class="empty">No new orders yet. Share your link to start receiving them.</div>`}
      </div>` +
      (past.length ? `<div class="card"><div class="section-title">Past orders</div>${past.map(row).join("")}</div>` : "");
  } catch (e) {
    if (e.message === "__auth__" || e.message === "__upgrade__") return;
    document.getElementById("ordersList").innerHTML = `<div class="card"><div class="empty">Couldn't load orders</div></div>`;
 }
}
function orderBadge(status) {
 if (status === "fulfilled") return '<span class="badge paid">fulfilled</span>';
 if (status === "declined") return '<span class="badge unpaid">declined</span>';
 return '<span class="badge partial">new</span>';
}
function orderDetail(o) {
 const cust = { name: o.customer_name, phone: o.customer_phone };
 const canReach = waNumber(o.customer_phone) || telNumber(o.customer_phone);
 openModal(`<h2>Order from ${esc(o.customer_name || "Customer")}</h2>
 <div class="meta" style="color:var(--muted);margin:-6px 0 12px">${fmtDate(o.created_at)} ${orderBadge(o.status)}</div>
 ${canReach ? `<div class="btn-row" style="margin-bottom:14px">
 ${telNumber(o.customer_phone) ? `<button class="btn secondary" onclick='phoneCall(${attrJson({ phone: o.customer_phone })})'>Call</button>` : ""}
 ${waNumber(o.customer_phone) ? `<button class="btn" style="background:#25d366" onclick='whatsappCall(${attrJson(cust)})'>WhatsApp</button>` : ""}
 </div>` : (o.customer_phone ? `<p class="meta" style="color:var(--muted);margin:0 0 12px">${esc(o.customer_phone)}</p>` : "")}
 <div class="card" style="background:var(--bg)">
 ${o.items.map(it => `<div class="list-row"><div style="flex:1;min-width:0"><div class="main">${esc(it.description)}</div>
 <div class="meta">${it.qty} × ${money(it.unit_price)}</div></div>
 <div class="amount">${money(it.qty * it.unit_price)}</div></div>`).join("")}
 <div class="list-row" style="border-top:2px solid var(--line)"><div class="main">Total</div>
 <div class="amount">${money(o.total)}</div></div>
 </div>
 ${o.note ? `<p style="font-size:13px;margin:12px 2px 0"><strong>Note:</strong> ${esc(o.note)}</p>` : ""}
 ${o.status === "pending" ? `<button class="btn success" style="margin-top:16px" onclick="fulfillOrder(${o.id})">✓ Fulfil — create invoice &amp; reduce stock</button>
 <button class="btn danger" style="margin-top:10px" onclick="declineOrder(${o.id})">Decline order</button>`
 : (o.status === "fulfilled" ? `<p class="meta" style="color:var(--muted);margin-top:14px">Fulfilled — an invoice was created and stock reduced.</p>`
 : `<p class="meta" style="color:var(--muted);margin-top:14px">This order was declined.</p>`)}`);
}
async function uploadVoiceOrder() {
  const inp = document.getElementById("voFile");
  if (!inp || !inp.files || !inp.files[0]) return;
  const f = inp.files[0];
  const fd = new FormData();
  fd.append("audio", f, f.name || "note.ogg");
  toast("Listening to the voice note…");
  try {
    const r = await api.sendForm("/api/orders/from-voice", fd);
    toast(r.free_uses_left != null
      ? `Heard: “${r.transcript}” · ${r.free_uses_left} free voice use${r.free_uses_left === 1 ? "" : "s"} left`
      : `Heard: “${r.transcript}” — check the order below`);
    render();
  } catch (e) {
    if (e.message !== "__upgrade__" && e.message !== "__auth__")
      toast(e.message || "Couldn't read that voice note");
  } finally { inp.value = ""; }
}
async function fulfillOrder(id) {
 try {
 const r = await api.send(`/api/orders/${id}/fulfill`, "POST");
 closeModal(); toast(`Invoice ${r.invoice_no} created ✓`); render();
 } catch (e) { if (e.message !== "__upgrade__" && e.message !== "__auth__") toast(e.message || "Couldn't fulfil"); }
}
async function declineOrder(id) {
  try { await api.send(`/api/orders/${id}/decline`, "POST"); closeModal(); toast("Order declined"); render(); }
  catch (e) { if (e.message !== "__upgrade__" && e.message !== "__auth__") toast(e.message || "Couldn't decline"); }
}
async function enableOrders() {
 try {
 state.orders = await api.send("/api/orders/enable", "POST");
 toast("Order link is live"); render();
 pushSubscribe(false); // ask to allow new-order alerts (user just tapped → gesture ok)
 } catch (e) { if (e.message !== "__upgrade__" && e.message !== "__auth__") toast(e.message || "Couldn't turn on orders"); }
}
// Alert status row for the Orders card — covers every permission state so the
// merchant always knows whether alerts will arrive and how to fix it if not.
// `what` names what the alerts are for — the Orders card and Settings share
// this row, and Settings covers overdue nudges too.
function alertsRowHtml(what = "orders come in") {
  if (!("Notification" in window) || !("PushManager" in window))
    return `<p style="font-size:13px;color:var(--muted);margin:10px 0 0"><svg class="ic"><use href="#i-bell"/></svg> To get alerts, install SalesPal to your home screen first (menu → Install app).</p>`;
  const p = Notification.permission;
  if (p === "granted")
    return `<div class="btn-row" style="margin-top:10px;align-items:center">
      <span style="font-size:13px;color:var(--muted)"><svg class="ic"><use href="#i-bell"/></svg> Alerts on for this device</span>
      <button class="btn outline" onclick="pushTest()">Send test alert</button></div>`;
  if (p === "denied")
    return `<p style="font-size:13px;color:var(--muted);margin:10px 0 0"><svg class="ic"><use href="#i-bell-off"/></svg> Alerts are blocked — allow notifications for SalesPal in your phone settings, then reopen the app.</p>`;
  return `<button class="btn outline" style="margin-top:10px" onclick="pushSubscribe(false).then(()=>render())"><svg class="ic"><use href="#i-bell"/></svg> Alert me when ${what}</button>`;
}
async function pushTest() {
  try {
    await pushSubscribe(true); // make sure this device's subscription is registered
 const r = await api.send("/api/push/test", "POST");
 toast(`Test sent to ${r.devices} device${r.devices > 1 ? "s" : ""} — check your notifications`);
 } catch (e) { if (e.message !== "__upgrade__" && e.message !== "__auth__") toast(e.message || "Couldn't send test"); }
}
// Subscribe this device to new-order alerts. silent=true (app open) only
// refreshes an already-granted subscription; silent=false may show the
// browser's permission prompt. Never throws — alerts are best-effort.
async function pushSubscribe(silent) {
 try {
 if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return;
 if (Notification.permission === "denied") return;
 if (silent && Notification.permission !== "granted") return;
 if (!silent && Notification.permission !== "granted") {
 if ((await Notification.requestPermission()) !== "granted") return;
 }
 const reg = await navigator.serviceWorker.ready;
 const { key } = await api.get("/api/push/key");
 const b = atob(key.replace(/-/g, "+").replace(/_/g, "/").padEnd(key.length + (4 - key.length % 4) % 4, "="));
 const appKey = Uint8Array.from(b, c => c.charCodeAt(0));
 const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: appKey });
 await api.send("/api/push/subscribe", "POST", sub.toJSON());
 if (!silent) toast("You'll get an alert for every new order");
  } catch (e) { /* no support / dismissed prompt — orders still work */ }
}
async function disableOrders() {
  try { state.orders = await api.send("/api/orders/disable", "POST"); toast("Orders turned off"); render(); }
  catch (e) { toast(e.message || "Couldn't turn off orders"); }
}
// Share the storefront link. WhatsApp opens a chat (they pick a contact/group);
// copy/native-share suits any channel. Synchronous → deep-links reliably.
function shareOrderLink(how) {
 const url = state.orders && state.orders.url;
 if (!url) return;
 const msg = `Order from ${activeShopName()}! Browse what's in stock and place your order here:\n${url}`;
  if (how === "whatsapp") { openExternal(`https://wa.me/?text=${encodeURIComponent(msg)}`); return; }
  if (navigator.share) { navigator.share({ title: activeShopName(), text: msg, url }).catch(() => {}); return; }
  if (navigator.clipboard) navigator.clipboard.writeText(url);
  toast("Link copied — paste it anywhere");
}

// ---------- REFER & EARN ----------
async function referralModal() {
  document.getElementById("menuSheet").classList.remove("open");
  let r;
  try { r = await api.get("/api/referral", { fresh: true }); }
  catch (e) { toast(e.message || "Couldn't load your invite link"); return; }
 window._refLink = r.link;
 const earned = r.months_earned;
 openModal(`<h3>Refer &amp; earn</h3>
 <p style="font-size:14px;color:var(--muted);margin:6px 0 14px">Invite another shop owner.
 They get <strong>1 month of Pro free</strong> when they join with your link — and when they
 record their first sale, <strong>you get a free month too</strong>.</p>
 <div class="field"><label>Your invite link</label><input readonly value="${r.link}" onclick="this.select()"></div>
 <button class="btn whatsapp" onclick="shareReferral('whatsapp')">Share on WhatsApp</button>
 <button class="btn outline" style="margin-top:10px" onclick="shareReferral('copy')">Copy link</button>
 <p style="font-size:13px;color:var(--muted);text-align:center;margin:14px 0 0">
 ${r.joined} friend${r.joined === 1 ? "" : "s"} joined · ${earned} free month${earned === 1 ? "" : "s"} earned</p>`);
}

function shareReferral(how) {
 const url = window._refLink;
 if (!url) return;
 const msg = `I use SalesPal to track my sales, see who owes me money, and send invoices on WhatsApp. Join with my link and we BOTH get 1 month of Pro free:\n${url}`;
 if (how === "whatsapp") { openExternal(`https://wa.me/?text=${encodeURIComponent(msg)}`); return; }
 if (navigator.clipboard) navigator.clipboard.writeText(url);
 toast("Invite link copied — paste it anywhere");
}

// ---------- PROMO FLYER ----------
// One-tap ad: a flyer of what's in stock + prices, ready for WhatsApp Status.
async function promoModal() {
  document.getElementById("menuSheet").classList.remove("open");
  openModal(`<h2>\ud83d\udce3 Promo flyer</h2><div class="loading">Building your flyer\u2026</div>`);
  let products = [];
  try { products = await api.get("/api/products"); }
  catch (e) { if (e.message === "__auth__") return; }
  if (!products.filter(p => p.stock_qty > 0).length) {
    updateModal(`<h2>\ud83d\udce3 Promo flyer</h2>
      <p style="color:var(--muted);font-size:14px;margin:0 0 12px">Add products with stock first \u2014 the flyer advertises what you have available right now.</p>
      <button class="btn" onclick="closeModal();setView('products')">Go to products</button>`);
    return;
  }
  updateModal(`<h2>\ud83d\udce3 Promo flyer</h2>
    <p style="color:var(--muted);font-size:14px;margin:0 0 12px">Your in-stock products and prices, ready to post on WhatsApp Status or send to customers.</p>
    <img src="/api/promo/image?fmt=png&t=${Date.now()}" alt="Promo flyer"
      style="width:100%;border:1px solid var(--line);border-radius:12px;margin-bottom:12px" />
    <button class="btn" onclick="sharePromo('png')">\ud83d\udce4 Share flyer</button>
    <button class="btn secondary" style="margin-top:10px" onclick="sharePromo('jpg')">Download JPG</button>`);
}
function sharePromo(fmt) {
  const biz = state.settings.business_name || "My shop";
  shareImageFile(`/api/promo/image?fmt=${fmt}`, `promo.${fmt}`,
    `${biz} \u2014 today's prices`, `${biz} \u2014 see what's in stock today. Order now!`);
}

// ---------- SETTINGS ----------
function transferCardHtml(pay) {
  // Instant bank transfer to the merchant's own account (no processor, no fee).
 const t = `<div class="section-title">Bank transfer · instant</div>`;
 if (pay.transfer_enabled) {
 const accts = pay.accounts || [];
 // One row per saved account. The default is the one used when an invoice
 // doesn't name its own — each sale can still be switched individually.
 const rows = accts.map(a => `<div class="list-row">
   <div><div class="lr-title">${esc(a.bank)}${a.is_default ? ` <span class="pill">Default</span>` : ""}</div>
   <div class="lr-sub">${esc(a.number)} · ${esc(a.name)}</div></div>
   <div class="btn-row" style="gap:6px">
   ${a.is_default ? "" : `<button class="wa-mini" onclick="makeDefaultAccount(${a.id})">Make default</button>`}
   ${accts.length > 1 ? `<button class="wa-mini" onclick="removeAccount(${a.id})" aria-label="Remove account"><svg class="ic"><use href="#i-trash"/></svg></button>` : ""}
   </div></div>`).join("");
 return `<div class="card">${t}
 <p style="font-size:14px;margin:0 0 10px">On — customers pay by direct transfer. Money lands <strong>instantly</strong>, no fees.${accts.length > 1 ? " You can pick which account each sale is paid to." : ""}</p>
 ${rows}
 <div class="btn-row" style="margin-top:12px">
 <button class="btn outline" onclick="addAccountModal()"><svg class="ic"><use href="#i-plus"/></svg> Add account</button>
 <button class="btn outline" onclick="transferModal()">Edit default</button>
 <button class="btn danger" onclick="disableTransfer()">Turn off</button>
 </div></div>`;
 }
 return `<div class="card">${t}
 <p style="font-size:14px;margin:0 0 10px">Let customers pay by <strong>direct bank transfer</strong> to your own account — the money lands <strong>instantly</strong> and there are <strong>no fees</strong>. You confirm each transfer when your bank alert arrives.</p>
 <button class="btn" onclick="transferModal()">Set up instant transfer</button></div>`;
}

function payCardHtml(pay, pro) {
 const title = `<div class="section-title">Card payments</div>`;
 if (!pay || !pay.billing_enabled) {
 return `<div class="card">${title}
 <p style="font-size:13px;color:var(--muted);margin:0">Let customers pay your invoices online — coming soon.</p></div>`;
 }
 if (!pro) {
 return `<div class="card"><div class="section-title">Online payments</div>
 <p style="font-size:14px;margin:0 0 10px">Get paid faster — add <strong>Pay Now</strong> options to your invoices: instant bank transfer (no fees) or card / USSD.</p>
 <p style="font-size:13px;color:var(--muted);margin:0 0 12px">A Pro feature. SalesPal takes 0% — you keep every naira.</p>
 <button class="btn" onclick="showUpgrade()">Upgrade to Pro</button></div>`;
 }
 if (pay.connected) {
 return `<div class="card">${title}
 <p style="font-size:14px;margin:0 0 6px">On — customers can also pay by card, transfer or USSD via Paystack.</p>
 <p style="font-size:13px;color:var(--muted);margin:0 0 6px">Payouts to <strong>${esc(pay.account_name)}</strong> · ${esc(pay.bank_name)} ${esc(pay.account_masked)}</p>
 <p style="font-size:13px;color:var(--muted);margin:0 0 12px"> Paystack settles card payments to your bank the <strong>next business day</strong>.</p>
 <div class="btn-row">
 <button class="btn outline" onclick="connectPayoutModal()">Change bank</button>
 <button class="btn danger" onclick="disconnectPayout()">Turn off</button>
 </div></div>`;
 }
 return `<div class="card">${title}
 <p style="font-size:14px;margin:0 0 10px">Also accept <strong>card &amp; USSD</strong> via Paystack (settles to your bank next business day, SalesPal takes 0%).</p>
 <button class="btn outline" onclick="connectPayoutModal()">Set up card payments</button></div>`;
}

async function viewSettings() {
 const s = await api.get("/api/settings");
 const h = await api.get("/api/health");
 const pay = await api.get("/api/pay/status").catch(() => ({}));
 const pro = isPro();
 const pl = state.plan || {}, usage = pl.usage || {}, lim = pl.limits || {};
 app.innerHTML = `
 <div class="card"><div class="section-title">Business details</div>
 <p style="font-size:13px;color:var(--muted);margin:0 0 12px">These appear on your invoices.</p>
 <div class="field"><label>Business name</label><input id="sName" value="${esc(s.business_name)}"></div>
 <div class="field"><label>Currency symbol</label><input id="sCur" value="${esc(s.currency)}" maxlength="4"></div>
 <div class="field"><label>Phone</label><input id="sPhone" value="${esc(s.phone)}"></div>
 <div class="field"><label>Email</label><input id="sEmail" value="${esc(s.email)}"></div>
 <div class="field"><label>Address</label><input id="sAddr" value="${esc(s.address)}"></div>
 <button class="btn" onclick="saveSettings()">Save</button>
 </div>
 ${pro ? transferCardHtml(pay) : ""}
 ${payCardHtml(pay, pro)}
 <div class="card"><div class="section-title">AI insights</div>
 <p style="font-size:14px;margin:0">${h.ai_enabled
 ? "SalesPal AI is connected. Advice & weekly reports are live."
 : " Not connected. Add ANTHROPIC_API_KEY in backend/.env to enable advice."}</p>
 </div>
 ${pro ? `<div class="card"><div class="section-title"><svg class="ic"><use href="#i-bell"/></svg> Alerts</div>
 <p style="font-size:13px;color:var(--muted);margin:0 0 4px">Get a notification each morning when a customer's payment is overdue.</p>
 ${alertsRowHtml("a payment is overdue")}</div>` : ""}
 <div class="card"><div class="section-title">Your plan</div>
 <p style="font-size:15px;margin:0 0 10px">You're on the <span class="pill ${pro ? 'pro' : ''}">${pro ? 'PRO' : 'FREE'}</span> plan.</p>
      ${pro
        ? `<p style="font-size:13px;color:var(--muted);margin:0">Unlimited invoices &amp; products, plus AI insights.${pl.plan_expires_at ? ` Active until <strong>${fmtDate(pl.plan_expires_at)}</strong>.` : ""}</p>`
        : `<p style="font-size:13px;color:var(--muted);margin:0 0 12px">${usage.invoices_this_month || 0}/${lim.invoices_per_month} invoices this month · ${usage.products || 0}/${lim.products} products used. AI insights are locked.</p>
           <button class="btn" onclick="showUpgrade()"><svg class="ic"><use href="#i-star"/></svg> Upgrade to Pro</button>`}
    </div>
    <div class="card"><div class="section-title"><svg class="ic"><use href="#i-customers"/></svg> Shop attendants</div>
      <p style="font-size:13px;color:var(--muted);margin:0 0 12px">Give staff their own login to record sales & payments and see stock — they never see profit, costs, or settings.</p>
      <button class="btn secondary" onclick="staffModal()">Manage attendants</button>
    </div>
    <div class="card"><div class="section-title">Account</div>
      <div class="field"><label>Current password</label>
        <input id="cpCur" type="password" placeholder="Your current password" autocomplete="current-password"></div>
      <div class="field"><label>New password</label>
        <input id="cpNew" type="password" placeholder="At least 8 characters" autocomplete="new-password">
        <label class="auth-show"><input type="checkbox" onchange="document.getElementById('cpNew').type = this.checked ? 'text' : 'password'"> Show new password</label>
      </div>
      <button class="btn" onclick="changePassword()">Change password</button>
      <button class="btn danger" onclick="logout()" style="margin-top:10px">Log out</button>
    </div>
    <div class="card"><div class="section-title">App version</div>
      <p style="font-size:13px;color:var(--muted);margin:0 0 12px">You're running <strong id="appVer">…</strong>. New features arrive on their own — use this if one seems missing.</p>
      <button class="btn secondary" onclick="forceUpdate(this)">Get the latest version</button>
    </div>`;
  showVersion();
}

// The service-worker cache name IS the deployed version, so there's no separate
// constant to keep in sync with a release.
async function showVersion() {
  const el = document.getElementById("appVer");
  if (!el) return;
  try {
    const k = (await caches.keys()).find(x => x.startsWith("salespal-v"));
    el.textContent = k ? k.replace("salespal-", "") : "the web version";
  } catch (e) { el.textContent = "the web version"; }
}

// Manual escape hatch for a phone stuck on old code. Inside the Android app
// there's no browser UI to clear a cache with, so do it from here: drop the
// shell caches and let the service worker refetch (it fetches no-cache, which
// also defeats the WebView's own HTTP cache).
async function forceUpdate(btn) {
  if (btn) btn.disabled = true;
  toast("Getting the latest version…");
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) await reg.update();
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("salespal-v")).map(k => caches.delete(k)));
  } catch (e) { /* still worth reloading — the query param alone busts the HTTP cache */ }
  location.replace("/app/?u=" + Date.now());
}

async function changePassword() {
  const current_password = document.getElementById("cpCur").value;
  const new_password = document.getElementById("cpNew").value;
  if ((new_password || "").length < 8) { toast("New password must be 8+ characters"); return; }
  try {
    await api.send("/api/auth/change-password", "POST", { current_password, new_password });
    document.getElementById("cpCur").value = "";
    document.getElementById("cpNew").value = "";
    toast("Password changed ✓");
  } catch (e) { toast(e.message || "Could not change password"); }
}
// ---------- Shop attendants (owner-managed staff logins) ----------
async function staffModal() {
  openModal(`<h2><svg class="ic"><use href="#i-customers"/></svg> Shop attendants</h2><div class="loading">Loading…</div>`);
  let staff = [], shops = [];
  try {
    [staff, shops] = await Promise.all([
      api.get("/api/staff").then(r => r.staff || []),
      api.get("/api/shops").then(r => r.shops || []),
    ]);
  } catch (e) { closeModal(); toast(e.message || "Couldn't load"); return; }
 const shopOpts = (sel) => shops.map(s =>
 `<option value="${s.id}" ${s.id === sel ? "selected" : ""}>${esc(s.name)}</option>`).join("");
 const multi = shops.length > 1;
 const rows = staff.length ? staff.map(s => `
 <div class="list-row">
 <div style="flex:1;min-width:0"><div class="main">${esc(s.name || s.username)}</div>
 <div class="meta">@${esc(s.username)}${multi ? "" : ` · ${esc(s.shop_name || "shop")}`}</div>
 ${multi ? `<select class="staff-shop" onchange="reassignStaff(${s.id}, this.value)">${shopOpts(s.shop_id)}</select>` : ""}</div>
 <button class="wa-mini" style="background:var(--red-bg);color:var(--red)" onclick="delStaff(${s.id})">Remove</button>
 </div>`).join("") : `<div class="empty">No attendants yet</div>`;
 updateModal(`<h2>Shop attendants</h2>
 <div style="margin-bottom:14px">${rows}</div>
 <div class="section-title">Add an attendant</div>
 <div class="field"><label>Name</label><input id="stName" placeholder="e.g. Amaka"></div>
 <div class="field"><label>Shop</label><select id="stShop">${shopOpts()}</select></div>
 <div class="field"><label>Username (they log in with this)</label>
 <input id="stUser" autocapitalize="none" autocomplete="off" placeholder="e.g. amaka"></div>
 <div class="field"><label>Password / PIN</label><input id="stPass" placeholder="At least 6 characters"></div>
 <button class="btn" onclick="saveStaff()">Create attendant</button>
 <button class="btn ghost" style="margin-top:10px" onclick="closeModal()">Done</button>`);
}
async function saveStaff() {
 const name = document.getElementById("stName").value.trim();
 const username = document.getElementById("stUser").value.trim().toLowerCase();
 const password = document.getElementById("stPass").value;
 const shop_id = parseInt(document.getElementById("stShop").value, 10) || null;
 if (username.length < 3) return toast("Username needs 3+ characters");
 if ((password || "").length < 6) return toast("Password needs 6+ characters");
 try { await api.send("/api/staff", "POST", { name, username, password, shop_id }); }
 catch (e) { if (e.message !== "__auth__" && e.message !== "__upgrade__") toast(e.message || "Couldn't add"); return; }
  toast(`Attendant @${username} created ✓`);
  staffModal();
}
async function reassignStaff(id, shopId) {
  try { await api.send(`/api/staff/${id}`, "PUT", { shop_id: parseInt(shopId, 10) }); }
  catch (e) { if (e.message !== "__auth__" && e.message !== "__upgrade__") toast(e.message || "Couldn't reassign"); return; }
 toast("Shop reassigned ✓");
}
async function delStaff(id) {
 if (!confirm("Remove this attendant? They won't be able to log in anymore.")) return;
  try { await api.send(`/api/staff/${id}`, "DELETE"); } catch (e) { toast(e.message || "Couldn't remove"); return; }
 toast("Attendant removed");
 staffModal();
}

async function saveSettings() {
 await api.send("/api/settings", "PUT", {
 business_name: document.getElementById("sName").value,
 currency: document.getElementById("sCur").value || "₦",
 phone: document.getElementById("sPhone").value,
 email: document.getElementById("sEmail").value,
 address: document.getElementById("sAddr").value });
 state.settings = await api.get("/api/settings");
 updateShopBar(); // appbar shows the active shop, not the business name
 toast("Settings saved");
}

// ---------- Online payments (payout setup + pay links) ----------
let _payBanks = null;
async function connectPayoutModal() {
 openModal(`<h2>Online payments</h2>
 <p style="color:var(--muted);font-size:14px;margin:0 0 6px">Add the bank account where customer payments should land. SalesPal takes 0% — you keep every naira.</p>
 <p style="color:var(--muted);font-size:13px;margin:0 0 14px"> Paystack settles payments into your bank the <strong>next business day</strong>.</p>
 <div class="field"><label>Bank</label><select id="payBank"><option value="">Loading banks…</option></select></div>
 <div class="field"><label>Account number</label><input id="payAcct" inputmode="numeric" maxlength="10" placeholder="10-digit account number"></div>
 <div id="payResolved" style="font-size:14px;min-height:20px;margin:-4px 0 12px;color:var(--muted)"></div>
 <button class="btn" id="payConnectBtn" disabled onclick="savePayout()">Connect</button>
 <button class="btn ghost" onclick="closeModal()">Cancel</button>`);
 try {
 if (!_payBanks) _payBanks = (await api.get("/api/pay/banks")).banks || [];
 const sel = document.getElementById("payBank");
 sel.innerHTML = `<option value="">Select your bank</option>` +
 _payBanks.map(b => `<option value="${esc(b.code)}">${esc(b.name)}</option>`).join("");
 sel.onchange = payMaybeResolve;
 const acct = document.getElementById("payAcct");
 acct.oninput = () => { acct.value = acct.value.replace(/\D/g, ""); payMaybeResolve(); };
 } catch (e) {
 const out = document.getElementById("payResolved");
 if (out) out.textContent = "Couldn't load the bank list — try again.";
  }
}

async function payMaybeResolve() {
  const code = document.getElementById("payBank").value;
  const acct = document.getElementById("payAcct").value;
  const out = document.getElementById("payResolved");
  const btn = document.getElementById("payConnectBtn");
  btn.disabled = true;
  if (!code || acct.length !== 10) { out.textContent = ""; return; }
  out.style.color = "var(--muted)"; out.textContent = "Checking account…";
  try {
    const r = await api.send("/api/pay/resolve", "POST", { account_number: acct, bank_code: code });
    if (r.account_name) {
      out.style.color = "var(--pos, #16a34a)"; out.textContent = "✓ " + r.account_name;
      btn.disabled = false;
    } else { out.textContent = ""; }
  } catch (e) {
    out.style.color = "var(--neg, #dc2626)";
    out.textContent = e.message || "Couldn't verify that account";
 }
}

async function savePayout() {
 const code = document.getElementById("payBank").value;
 const acct = document.getElementById("payAcct").value;
 const btn = document.getElementById("payConnectBtn");
 btn.disabled = true; btn.textContent = "Connecting…";
 try {
 state.pay = await api.send("/api/pay/connect", "POST", { account_number: acct, bank_code: code });
 closeModal(); toast("Online payments connected ✓"); render();
 } catch (e) {
 btn.disabled = false; btn.textContent = "Connect";
 if (e.message !== "__upgrade__") toast(e.message || "Couldn't connect");
  }
}

async function disconnectPayout() {
  if (!confirm("Turn off online payments? Your existing pay links will stop working until you turn it back on.")) return;
  try { state.pay = await api.send("/api/pay/disconnect", "POST"); toast("Online payments turned off"); render(); }
  catch (e) { toast(e.message); }
}

function transferModal() {
  const p = state.pay || {};
  const name = p.transfer_name || p.account_name || "";
  const number = p.transfer_number || "";
  const bank = p.transfer_bank || p.bank_name || "";
  openModal(`<h2>Instant bank transfer <svg class="ic"><use href="#i-zap"/></svg></h2>
    <p style="color:var(--muted);font-size:14px;margin:0 0 14px">Customers transfer straight to this account — money lands <strong>instantly</strong> with no fees. You confirm each payment when your bank alert arrives.</p>
    <div class="field"><label>Account name</label><input id="trName" value="${esc(name)}" placeholder="e.g. Ada Beauty Store"></div>
    <div class="field"><label>Account number</label><input id="trNum" inputmode="numeric" value="${esc(number)}" placeholder="Your account number"></div>
    <div class="field"><label>Bank / wallet</label><input id="trBank" value="${esc(bank)}" placeholder="e.g. OPay, Moniepoint, GTBank"></div>
    <button class="btn" onclick="saveTransfer()"><svg class="ic"><use href="#i-zap"/></svg> Turn on instant transfer</button>
    <button class="btn ghost" onclick="closeModal()">Cancel</button>`);
}

async function saveTransfer() {
  const account_name = document.getElementById("trName").value.trim();
  const account_number = document.getElementById("trNum").value.replace(/\D/g, "");
  const bank = document.getElementById("trBank").value.trim();
  if (!account_name || !account_number || !bank) { toast("Fill in name, number and bank"); return; }
  try {
    state.pay = await api.send("/api/pay/transfer", "POST", { enabled: true, account_name, account_number, bank });
    closeModal(); toast("Instant transfer is on ✓"); render();
  } catch (e) { if (e.message !== "__upgrade__") toast(e.message || "Couldn't save"); }
}

// Add another account customers can transfer to (on top of the default).
function addAccountModal() {
  openModal(`<h2>Add bank account</h2>
    <p style="color:var(--muted);font-size:14px;margin:0 0 14px">Save more than one account, then pick which one each sale is paid to.</p>
    <div class="field"><label>Account name</label><input id="acName" placeholder="e.g. Ada Beauty Store"></div>
    <div class="field"><label>Account number</label><input id="acNum" inputmode="numeric" placeholder="Account number"></div>
    <div class="field"><label>Bank / wallet</label><input id="acBank" placeholder="e.g. OPay, Moniepoint, GTBank"></div>
    <button class="btn" onclick="saveNewAccount()">Save account</button>
    <button class="btn ghost" onclick="closeModal()">Cancel</button>`);
}

async function saveNewAccount() {
  const account_name = document.getElementById("acName").value.trim();
  const account_number = document.getElementById("acNum").value.replace(/\D/g, "");
  const bank = document.getElementById("acBank").value.trim();
  if (!account_name || !account_number || !bank) { toast("Fill in name, number and bank"); return; }
  try {
    const r = await api.send("/api/bank-accounts", "POST", { account_name, account_number, bank });
    state.pay = Object.assign({}, state.pay, { accounts: r.accounts, transfer_enabled: true });
    closeModal(); toast("Account added"); render();
  } catch (e) { if (e.message !== "__upgrade__") toast(e.message || "Couldn't save"); }
}

async function makeDefaultAccount(id) {
  try {
    const r = await api.send(`/api/bank-accounts/${id}/default`, "POST", {});
    const d = (r.accounts || []).find(a => a.is_default) || {};
    state.pay = Object.assign({}, state.pay, { accounts: r.accounts,
      transfer_name: d.name || "", transfer_number: d.number || "", transfer_bank: d.bank || "" });
    toast("Default account updated"); render();
  } catch (e) { toast(e.message || "Couldn't update"); }
}

async function removeAccount(id) {
  if (!confirm("Remove this account? Sales already set to it will fall back to your default.")) return;
  try {
    const r = await api.send(`/api/bank-accounts/${id}`, "DELETE");
    const d = (r.accounts || []).find(a => a.is_default) || {};
    state.pay = Object.assign({}, state.pay, { accounts: r.accounts,
      transfer_name: d.name || "", transfer_number: d.number || "", transfer_bank: d.bank || "" });
    toast("Account removed"); render();
  } catch (e) { toast(e.message || "Couldn't remove"); }
}

async function disableTransfer() {
 const p = state.pay || {};
 if (!confirm("Turn off bank transfer payments? Customers won't see your account on new pay links.")) return;
  try {
    state.pay = await api.send("/api/pay/transfer", "POST", { enabled: false,
      account_name: p.transfer_name, account_number: p.transfer_number, bank: p.transfer_bank });
    toast("Bank transfer turned off"); render();
  } catch (e) { toast(e.message); }
}

async function confirmClaim(iid, cid) {
  try {
    await api.send(`/api/invoices/${iid}/claims/${cid}/confirm`, "POST");
    closeModal(); toast("Payment confirmed ✓"); receiptOffer(iid); render();
  } catch (e) { toast(e.message || "Couldn't confirm"); }
}

async function dismissClaim(iid, cid) {
 try {
 await api.send(`/api/invoices/${iid}/claims/${cid}/dismiss`, "POST");
 toast("Marked as not received"); invoiceDetail(iid);
 } catch (e) { toast(e.message); }
}

// Send the pay link straight to the customer on WhatsApp (like the payment
// reminder): use their saved number, ask once if we don't have it. The link is
// pre-fetched with the invoice (inv.pay_url) so WhatsApp opens synchronously and
// deep-links into the chat. Falls back to the share sheet / clipboard when no
// number is provided, or fetches the link on demand if it wasn't pre-loaded.
function sharePaymentLink(inv) {
 const url = inv && inv.pay_url;
 if (!url) { _sharePayLinkFallback(inv && inv.id); return; } // link not ready → async path
 const cust = inv.customer;
 const num = _waResolveNumber(cust);
 if (!num) { _sharePayLinkShare(inv, url); return; } // no number → share/copy
 const biz = state.settings.business_name || "SalesPal";
 const who = cust && cust.name ? cust.name : "there";
 const msg = `Hi ${who}, here's your payment link from ${biz} for invoice ${inv.invoice_no || ""}`
    + `${inv.balance ? " — " + money(inv.balance) + " due" : ""}:\n${url}\n`
    + `Tap to pay securely. Thank you!`;
  _openWhatsApp(num, msg);
}

// Share the pay link via the native share sheet / clipboard (no WhatsApp number).
async function _sharePayLinkShare(inv, url) {
  const biz = state.settings.business_name || "SalesPal";
  const text = `${biz} — pay invoice ${inv.invoice_no || ""}${inv.balance ? " (" + money(inv.balance) + ")" : ""}: ${url}`;
  try {
    if (navigator.share) { await navigator.share({ title: `Pay ${inv.invoice_no || "invoice"}`, text, url }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  try {
    await navigator.clipboard.writeText(url);
    toast("Payment link copied ✓");
  } catch (e) {
    openModal(`<h2>Payment link</h2>
      <p style="font-size:13px;color:var(--muted);margin:0 0 10px">Share this link with your customer — they can pay by card, transfer or USSD.</p>
      <div class="field"><input value="${esc(url)}" readonly onclick="this.select()"></div>
      <button class="btn ghost" onclick="closeModal()">Done</button>`);
  }
}

// Rare path: the invoice didn't carry a pay_url (e.g. stale view) — create it,
// then share via the sheet/clipboard (can't deep-link after an await).
async function _sharePayLinkFallback(id) {
  if (!id) { toast("Couldn't create link"); return; }
 try {
 const res = await api.send(`/api/invoices/${id}/payment-link`, "POST");
 const inv = await api.get(`/api/invoices/${id}`).catch(() => ({ id }));
 _sharePayLinkShare(inv, res.url);
 } catch (e) { if (e.message !== "__upgrade__") toast(e.message || "Couldn't create link"); }
}

// ---------- boot ----------
(async function init() {
  // Fire every independent boot request at once (they don't depend on each
  // other, only on being logged in) so the dashboard shows after ONE round-trip
  // instead of a 5-deep waterfall.
  const meP = api.get("/api/auth/me");
  const settingsP = api.get("/api/settings").catch(() => null);
  const planP = api.get("/api/plan").catch(() => null);
  const payP = api.get("/api/pay/status").catch(() => null);
  const shopsP = api.get("/api/shops").catch(() => null);
  const ordersP = api.get("/api/orders/status").catch(() => null);
  let user;
  try { user = await meP; }
  catch (e) { requireAuthUI(); return; } // no/invalid session → login/signup
  try {
    await bootstrap(user, { settings: settingsP, plan: planP, pay: payP, shops: shopsP, orders: ordersP });
    await handlePaymentReturn(); // handle return from Paystack checkout
    updateSyncBar(); flushOutbox();   // push anything captured offline last session
  } catch (e) { requireAuthUI(); }
})();

// expose handlers used in inline onclick
Object.assign(window, { newSaleModal, invoiceDetail, deleteInvoice, editSaleModal, saveEditedSale, shareInvoice, markPaid, markUnpaid, settleCustomer, openOwed, paymentModal,
  savePayment, addProductItem, addCustomItem, pickProduct, updItem, removeItem,
  saveSale, voiceSale, expenseModal, expCatChanged, saveExpense, delExpense, productModal, saveProduct,
  delProduct, addSupplierRow, callSupplier, priceCheckModal, pcNudge, runPriceCheck, customerModal, saveCustomer, delCustomer, saveSettings, loadAdvice, forceUpdate, referralModal, shareReferral, promoModal, sharePromo, uploadProductPhoto,
  filterCustomerSuggest, pickCustomerSuggest, hideCustomerSuggest,
  goalModal, saveGoal, goalTips,
  loadWeekly, render, setView, viewSales, renderSalesList, setSalesStatus, loadSavedReports, openReport,
  doAuth, toggleAuthMode, setAuthMode, togglePw, logout, changePassword, showUpgrade, paywallSelect, paywallCheckout, whatsappReminder, whatsappCall, phoneCall,
  startCheckout, renderLanding, startBuy, startFree,
  shopSwitcher, switchShop, addShop,
  shareInvoiceImage, shareReceipt, receiptOffer, settleReceiptOffer, shareSettleReceipt,
  connectPayoutModal, payMaybeResolve, savePayout, disconnectPayout, sharePaymentLink,
  transferModal, saveTransfer, disableTransfer, confirmClaim, dismissClaim,
  addAccountModal, saveNewAccount, makeDefaultAccount, removeAccount,
  bankSwitcherHtml, setInvoiceAccount, bankPickerFieldHtml, saleBankAccountId,
  viewOrders, orderDetail, fulfillOrder, declineOrder, enableOrders, disableOrders, shareOrderLink,
  pushSubscribe, pushTest, backupTest,
  supplierOrder, supplierOrderTotal, sendSupplierOrder, copySupplierOrder,
  attendantSaleModal, attendantSaveSale, setPayMode, attendantInvoice, attendantPay,
  viewStock, viewAttendantHome, staffModal, saveStaff, delStaff, reassignStaff });
