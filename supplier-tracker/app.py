# Supplier Tracker — what each supplier sold to me, and what I still owe them.
# Each supplier has their own price per product; price edits sync catalog <-> supply form.
# One file: FastAPI + SQLite + inline HTML. Run: ../backend/venv/bin/uvicorn app:app --port 8006
import sqlite3
from contextlib import closing
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field

DB = __file__.rsplit("/", 1)[0] + "/supplier.db"

def db():
    conn = sqlite3.connect(DB)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

with closing(db()) as c:
    c.executescript("""
    CREATE TABLE IF NOT EXISTS products(
        supplier TEXT NOT NULL COLLATE NOCASE,
        name TEXT NOT NULL COLLATE NOCASE,
        price REAL NOT NULL CHECK(price >= 0),
        UNIQUE(supplier, name)
    );
    CREATE TABLE IF NOT EXISTS purchases(
        id INTEGER PRIMARY KEY,
        supplier TEXT NOT NULL COLLATE NOCASE,
        item TEXT NOT NULL,
        price REAL NOT NULL CHECK(price >= 0),
        qty REAL NOT NULL CHECK(qty > 0),
        created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments(
        id INTEGER PRIMARY KEY,
        supplier TEXT NOT NULL COLLATE NOCASE,
        amount REAL NOT NULL CHECK(amount > 0),
        created_at TEXT NOT NULL
    );
    """)
    c.commit()

app = FastAPI(title="Supplier Tracker")

class Purchase(BaseModel):
    supplier: str = Field(min_length=1, max_length=100)
    item: str = Field(min_length=1, max_length=200)
    price: float = Field(ge=0)
    qty: float = Field(gt=0)

class Payment(BaseModel):
    supplier: str = Field(min_length=1, max_length=100)
    amount: float = Field(gt=0)

class ProductPrice(BaseModel):
    supplier: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    price: float = Field(ge=0)

def now():
    return datetime.now(timezone.utc).isoformat()

def upsert_product(c, supplier, name, price):
    c.execute("""INSERT INTO products(supplier,name,price) VALUES(?,?,?)
                 ON CONFLICT(supplier,name) DO UPDATE SET price=excluded.price""",
              (supplier, name, price))

@app.post("/api/purchases")
def add_purchase(p: Purchase):
    with closing(db()) as c:
        # ponytail: purchase price is the supplier's current price — entering a new
        # price here updates the catalog too ("reflects on both ends")
        c.execute("INSERT INTO purchases(supplier,item,price,qty,created_at) VALUES(?,?,?,?,?)",
                  (p.supplier.strip(), p.item.strip(), p.price, p.qty, now()))
        upsert_product(c, p.supplier.strip(), p.item.strip(), p.price)
        c.commit()
    return {"ok": True}

@app.put("/api/products")
def set_price(p: ProductPrice):
    with closing(db()) as c:
        upsert_product(c, p.supplier.strip(), p.name.strip(), p.price)
        c.commit()
    return {"ok": True}

@app.delete("/api/products")
def delete_product(supplier: str, name: str):
    with closing(db()) as c:
        c.execute("DELETE FROM products WHERE supplier=? AND name=?", (supplier, name))
        c.commit()
    return {"ok": True}

@app.post("/api/payments")
def add_payment(p: Payment):
    with closing(db()) as c:
        owed = c.execute(
            "SELECT COALESCE((SELECT SUM(price*qty) FROM purchases WHERE supplier=?),0)"
            " - COALESCE((SELECT SUM(amount) FROM payments WHERE supplier=?),0)",
            (p.supplier.strip(), p.supplier.strip())).fetchone()[0]
        if p.amount > owed + 0.005:
            raise HTTPException(400, f"Payment exceeds balance owed (₦{owed:,.2f})")
        c.execute("INSERT INTO payments(supplier,amount,created_at) VALUES(?,?,?)",
                  (p.supplier.strip(), p.amount, now()))
        c.commit()
    return {"ok": True}

@app.delete("/api/purchases/{pid}")
def delete_purchase(pid: int):
    with closing(db()) as c:
        c.execute("DELETE FROM purchases WHERE id=?", (pid,))
        c.commit()
    return {"ok": True}

@app.get("/api/supplier/{name}")
def supplier_view(name: str):
    with closing(db()) as c:
        purchases = [dict(r) for r in c.execute(
            "SELECT id, item, price, qty, price*qty AS total, created_at FROM purchases"
            " WHERE supplier=? ORDER BY created_at DESC", (name,))]
        payments = [dict(r) for r in c.execute(
            "SELECT amount, created_at FROM payments WHERE supplier=? ORDER BY created_at DESC", (name,))]
        products = [dict(r) for r in c.execute(
            "SELECT name, price FROM products WHERE supplier=? ORDER BY name", (name,))]
    supplied = sum(p["total"] for p in purchases)
    paid = sum(p["amount"] for p in payments)
    return {"supplier": name, "supplied": supplied, "paid": paid, "owed": supplied - paid,
            "products": products, "purchases": purchases, "payments": payments}

@app.get("/api/summary")
def summary():
    with closing(db()) as c:
        suppliers = [dict(r) for r in c.execute("""
            SELECT s.supplier,
                   COALESCE(b.bought,0) AS bought,
                   COALESCE(p.paid,0) AS paid,
                   COALESCE(b.bought,0) - COALESCE(p.paid,0) AS owed
            FROM (SELECT supplier FROM purchases UNION SELECT supplier FROM payments
                  UNION SELECT supplier FROM products) s
            LEFT JOIN (SELECT supplier, SUM(price*qty) bought FROM purchases GROUP BY supplier) b USING(supplier)
            LEFT JOIN (SELECT supplier, SUM(amount) paid FROM payments GROUP BY supplier) p USING(supplier)
            ORDER BY owed DESC""")]
        products = [dict(r) for r in c.execute(
            "SELECT supplier, name, price FROM products ORDER BY supplier, name")]
        history = [dict(r) for r in c.execute("""
            SELECT id, 'purchase' kind, supplier, item, price, qty, price*qty AS total, created_at
            FROM purchases
            UNION ALL
            SELECT id, 'payment', supplier, NULL, NULL, NULL, amount, created_at FROM payments
            ORDER BY created_at DESC LIMIT 100""")]
    return {"suppliers": suppliers, "products": products, "history": history}

HTML = """<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Supplier Tracker</title>
<style>
:root{--bg:#0f172a;--card:#1e293b;--txt:#e2e8f0;--mut:#94a3b8;--acc:#34d399;--red:#f87171;--line:#334155}
*{box-sizing:border-box;margin:0}
body{font:16px/1.5 system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--txt);padding:16px;max-width:640px;margin:0 auto}
h1{font-size:1.3rem;margin-bottom:12px}
h2{font-size:1rem;color:var(--mut);margin:20px 0 8px}
.card{background:var(--card);border-radius:12px;padding:14px;margin-bottom:10px}
form{display:grid;gap:8px}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
input{width:100%;padding:10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--txt);font-size:16px}
button{padding:11px;border:0;border-radius:8px;background:var(--acc);color:#052e22;font-weight:700;font-size:15px;cursor:pointer}
button.pay{background:#60a5fa;color:#0c1e3a}
.sup{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--line)}
.sup:last-child{border:0}
.owed{font-weight:700;color:var(--red)}
.owed.zero{color:var(--acc)}
.prodsup{font-weight:700;margin-top:8px}
.prodsup:first-child{margin-top:0}
.prod{display:flex;justify-content:space-between;align-items:center;padding:5px 0 5px 12px;border-bottom:1px solid var(--line);font-size:.9rem}
.prod:last-child{border:0}
.prod .price{cursor:pointer;text-decoration:underline dotted var(--mut);white-space:nowrap}
.hist{font-size:.85rem;color:var(--mut);padding:6px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:8px}
.hist:last-child{border:0}
.hist .amt{white-space:nowrap}
.hist.payment .amt{color:var(--acc)}
.del{background:none;border:0;color:var(--mut);cursor:pointer;padding:0 4px;font-size:1rem}
#msg{color:var(--red);font-size:.85rem;min-height:1.2em}
small{color:var(--mut)}
.sup b{cursor:pointer;text-decoration:underline dotted var(--mut)}
#supview{display:none}
body.pov #main{display:none}
body.pov #supview{display:block}
.back{background:none;border:0;color:var(--mut);font-size:15px;cursor:pointer;padding:0;margin-bottom:10px}
.big{font-size:1.6rem;font-weight:700}
.statement{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center}
.statement small{display:block}
</style></head><body>
<h1>📦 Supplier Tracker</h1>

<div id="supview">
<button class="back" onclick="location.hash=''">← Back to all suppliers</button>
<div class="card">
<div class="big" id="svname"></div>
<small id="svsub"></small>
</div>
<div class="card statement">
<div><small>Supplied you</small><span id="svsupplied"></span></div>
<div><small>You paid</small><span id="svpaid"></span></div>
<div><small>You still owe</small><span class="owed" id="svowed"></span></div>
</div>
<div class="card">
<h2 style="margin-top:0">➕ Add what I supplied</h2>
<form id="svaddf">
<input name="item" placeholder="Product" required list="svprods" autocomplete="off">
<datalist id="svprods"></datalist>
<div class="row2">
<input name="price" type="number" step="0.01" min="0" placeholder="Price ₦" required inputmode="decimal">
<input name="qty" type="number" step="any" min="0.01" placeholder="Amount / qty" required inputmode="decimal">
</div>
<button>Record supply</button>
</form>
</div>

<div class="card">
<h2 style="margin-top:0">💰 Clock in a payment</h2>
<form id="svpayf">
<input name="amount" type="number" step="0.01" min="0.01" placeholder="Amount paid ₦" required inputmode="decimal">
<button class="pay">Record payment</button>
</form>
<div id="svmsg"></div>
</div>

<h2>Their price list <small>(tap a price to change it)</small></h2>
<div class="card" id="svproducts"></div>
<h2>Supplies delivered</h2>
<div class="card" id="svpurchases"></div>
<h2>Payments received</h2>
<div class="card" id="svpayments"></div>
</div>

<div id="main">

<div class="card">
<h2 style="margin-top:0">New supply (what they sold me)</h2>
<form id="pf">
<input name="supplier" placeholder="Supplier name" required list="sups" autocomplete="off">
<datalist id="sups"></datalist>
<input name="item" placeholder="Product" required list="prods" autocomplete="off">
<datalist id="prods"></datalist>
<div class="row2">
<input name="price" type="number" step="0.01" min="0" placeholder="Price ₦" required inputmode="decimal">
<input name="qty" type="number" step="any" min="0.01" placeholder="Amount / qty" required inputmode="decimal">
</div>
<button>Add supply</button>
</form>
</div>

<div class="card">
<h2 style="margin-top:0">Record payment (reduces balance)</h2>
<form id="payf">
<input name="supplier" placeholder="Supplier name" required list="sups" autocomplete="off">
<input name="amount" type="number" step="0.01" min="0.01" placeholder="Amount paid ₦" required inputmode="decimal">
<button class="pay">Record payment</button>
</form>
<div id="msg"></div>
</div>

<h2>Balances owed</h2>
<div class="card" id="balances"><small>No suppliers yet.</small></div>

<h2>Products &amp; prices <small>(tap a price to change it)</small></h2>
<div class="card" id="products"><small>No products yet.</small></div>

<h2>History</h2>
<div class="card" id="history"><small>Nothing yet.</small></div>
</div>

<script>
const ngn = n => '₦' + Number(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const esc = s => s.replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
let CATALOG = [];   // [{supplier,name,price}] — the one source of truth for prices

async function load(){
  const d = await (await fetch('/api/summary')).json();
  CATALOG = d.products;
  document.getElementById('sups').innerHTML = d.suppliers.map(s=>`<option value="${esc(s.supplier)}">`).join('');
  fillProductList();
  document.getElementById('balances').innerHTML = d.suppliers.length ? d.suppliers.map(s=>
    `<div class="sup"><div><b onclick="location.hash=encodeURIComponent('${esc(s.supplier)}')">${esc(s.supplier)}</b><br><small>bought ${ngn(s.bought)} · paid ${ngn(s.paid)} · tap name for their view</small></div>
     <span class="owed ${s.owed<=0.005?'zero':''}">${ngn(s.owed)}</span></div>`).join('') : '<small>No suppliers yet.</small>';
  const bySup = {};
  d.products.forEach(p => (bySup[p.supplier] = bySup[p.supplier]||[]).push(p));
  document.getElementById('products').innerHTML = d.products.length ? Object.entries(bySup).map(([sup,ps])=>
    `<div class="prodsup">${esc(sup)}</div>` + ps.map(p=>
      `<div class="prod"><span>${esc(p.name)}</span>
       <span><span class="price" onclick="editPrice('${esc(p.supplier)}','${esc(p.name)}',${p.price})">${ngn(p.price)}</span>
       <button class="del" onclick="delProduct('${esc(p.supplier)}','${esc(p.name)}')" title="Remove">✕</button></span></div>`).join('')
  ).join('') : '<small>No products yet.</small>';
  document.getElementById('history').innerHTML = d.history.length ? d.history.map(h=>
    h.kind==='purchase'
    ? `<div class="hist"><span>${esc(h.supplier)} — ${esc(h.item)} (${h.qty} × ${ngn(h.price)})</span>
       <span class="amt">${ngn(h.total)} <button class="del" onclick="delPurchase(${h.id})" title="Delete">✕</button></span></div>`
    : `<div class="hist payment"><span>${esc(h.supplier)} — payment</span><span class="amt">−${ngn(h.total)}</span></div>`
  ).join('') : '<small>Nothing yet.</small>';
}

const pf = document.getElementById('pf');

function fillProductList(){
  const sup = pf.supplier.value.trim().toLowerCase();
  const mine = CATALOG.filter(p => !sup || p.supplier.toLowerCase() === sup);
  document.getElementById('prods').innerHTML = [...new Set(mine.map(p=>p.name))]
    .map(n=>`<option value="${esc(n)}">`).join('');
}

function autofillPrice(){
  const sup = pf.supplier.value.trim().toLowerCase(), item = pf.item.value.trim().toLowerCase();
  const hit = CATALOG.find(p => p.supplier.toLowerCase()===sup && p.name.toLowerCase()===item);
  if(hit) pf.price.value = hit.price;
}
pf.supplier.addEventListener('input', ()=>{ fillProductList(); autofillPrice(); });
pf.item.addEventListener('input', autofillPrice);

async function post(url, body, method='POST'){
  const r = await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok){ const e = await r.json().catch(()=>({})); throw new Error(e.detail || 'Failed'); }
}

pf.onsubmit = async e => {
  e.preventDefault();
  await post('/api/purchases',{supplier:pf.supplier.value,item:pf.item.value,price:+pf.price.value,qty:+pf.qty.value});
  pf.item.value=pf.price.value=pf.qty.value=''; load();
};
document.getElementById('payf').onsubmit = async e => {
  e.preventDefault(); const f = e.target, msg = document.getElementById('msg'); msg.textContent='';
  try{ await post('/api/payments',{supplier:f.supplier.value,amount:+f.amount.value}); f.amount.value=''; load(); }
  catch(err){ msg.textContent = err.message; }
};
async function editPrice(supplier, name, cur){
  const v = prompt(`New price for ${name} (${supplier}):`, cur);
  if(v===null) return;
  const price = parseFloat(v);
  if(isNaN(price) || price < 0) return alert('Enter a valid price');
  await post('/api/products',{supplier,name,price},'PUT'); route();
}
async function delProduct(supplier, name){
  if(confirm(`Remove ${name} from ${supplier}'s price list? (history is kept)`)){
    await fetch(`/api/products?supplier=${encodeURIComponent(supplier)}&name=${encodeURIComponent(name)}`,{method:'DELETE'}); load();
  }
}
async function delPurchase(id){
  if(confirm('Delete this supply record?')){ await fetch('/api/purchases/'+id,{method:'DELETE'}); load(); }
}

// --- Supplier's own page: they add supplies, owner clocks in payments ---
// ponytail: no login — the URL hash IS the supplier's page; fine for a trusted-supplier ledger
let SVPRODUCTS = [];  // current supplier's catalog, for price autofill
const svaddf = document.getElementById('svaddf');
svaddf.item.addEventListener('input', ()=>{
  const hit = SVPRODUCTS.find(p => p.name.toLowerCase() === svaddf.item.value.trim().toLowerCase());
  if(hit) svaddf.price.value = hit.price;
});
svaddf.onsubmit = async e => {
  e.preventDefault();
  const name = decodeURIComponent(location.hash.slice(1));
  await post('/api/purchases',{supplier:name,item:svaddf.item.value,price:+svaddf.price.value,qty:+svaddf.qty.value});
  svaddf.item.value=svaddf.price.value=svaddf.qty.value=''; route();
};
document.getElementById('svpayf').onsubmit = async e => {
  e.preventDefault();
  const name = decodeURIComponent(location.hash.slice(1));
  const f = e.target, msg = document.getElementById('svmsg'); msg.textContent='';
  try{ await post('/api/payments',{supplier:name,amount:+f.amount.value}); f.amount.value=''; route(); }
  catch(err){ msg.textContent = err.message; }
};

const fmtDate = iso => new Date(iso).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});

async function route(){
  const name = decodeURIComponent(location.hash.slice(1));
  document.body.classList.toggle('pov', !!name);
  if(!name) return load();
  const d = await (await fetch('/api/supplier/'+encodeURIComponent(name))).json();
  document.getElementById('svname').textContent = d.supplier;
  document.getElementById('svsub').textContent = 'Account statement — their side of the book';
  document.getElementById('svsupplied').textContent = ngn(d.supplied);
  document.getElementById('svpaid').textContent = ngn(d.paid);
  const owedEl = document.getElementById('svowed');
  owedEl.textContent = ngn(d.owed);
  owedEl.classList.toggle('zero', d.owed <= 0.005);
  SVPRODUCTS = d.products;
  document.getElementById('svprods').innerHTML = d.products.map(p=>`<option value="${esc(p.name)}">`).join('');
  document.getElementById('svproducts').innerHTML = d.products.length ? d.products.map(p=>
    `<div class="prod"><span>${esc(p.name)}</span><span class="price" onclick="editPrice('${esc(d.supplier)}','${esc(p.name)}',${p.price})">${ngn(p.price)}</span></div>`).join('') : '<small>No products yet.</small>';
  document.getElementById('svpurchases').innerHTML = d.purchases.length ? d.purchases.map(h=>
    `<div class="hist"><span>${fmtDate(h.created_at)} — ${esc(h.item)} (${h.qty} × ${ngn(h.price)})</span><span class="amt">${ngn(h.total)}</span></div>`).join('') : '<small>Nothing delivered yet.</small>';
  document.getElementById('svpayments').innerHTML = d.payments.length ? d.payments.map(h=>
    `<div class="hist payment"><span>${fmtDate(h.created_at)} — payment</span><span class="amt">${ngn(h.amount)}</span></div>`).join('') : '<small>No payments yet.</small>';
}
window.addEventListener('hashchange', route);
route();
</script></body></html>"""

@app.get("/", response_class=HTMLResponse)
def index():
    return HTML
