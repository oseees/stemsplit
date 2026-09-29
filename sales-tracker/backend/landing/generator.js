// Shared by the free document generators. Each page has the same form
// (#kind #no #biz #phone #cust #date #items, optional #bank / #method) and a
// #doc preview; <select id="kind" data-default="…"> picks the page's type.
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const naira = n => "₦" + (Math.round(n * 100) / 100).toLocaleString("en-NG");
const KINDS = {
  Invoice:   { title: "INVOICE", pre: "INV", to: "Bill to", total: "Total due", pay: true,
               foot: "Thank you for your patronage." },
  Receipt:   { title: "RECEIPT", pre: "RCT", to: "Received from", total: "Amount paid", paid: true,
               foot: "Thank you for your business!" },
  Proforma:  { title: "PROFORMA INVOICE", pre: "PRF", to: "Bill to", total: "Total", pay: true,
               foot: "This proforma invoice is for approval — it is not a receipt." },
  Quotation: { title: "QUOTATION", pre: "QT", to: "Prepared for", total: "Total",
               foot: "This is a quotation, not a request for payment." },
  Waybill:   { title: "WAYBILL", pre: "WB", to: "Deliver to", noPrice: true,
               foot: "Received in good condition by: ______________________ &nbsp; Date: ____________" },
};
const SAVED = ["biz", "phone", "bank"].filter(k => $(k));
const kind = () => KINDS[$("kind").value] || KINDS.Invoice;

function addItem(d = "", q = 1, p = "") {
  const r = document.createElement("div");
  r.className = "item";
  r.innerHTML = `<input placeholder="Item" value="${esc(d)}"><input type="number" min="0" inputmode="decimal" value="${q}"><input type="number" min="0" inputmode="decimal" placeholder="0" value="${p}"><button type="button" aria-label="Remove item">×</button>`;
  r.querySelector("button").onclick = () => { r.remove(); render(); };
  $("items").append(r);
  render();
}
function items() {
  return [...document.querySelectorAll(".item")].map(r => {
    const [d, q, p] = r.querySelectorAll("input");
    return { d: d.value.trim(), q: +q.value || 0, p: +p.value || 0 };
  }).filter(i => i.d || i.p);
}
function render() {
  const k = kind(), its = items(), total = its.reduce((s, i) => s + i.q * i.p, 0);
  document.querySelector(".tool").classList.toggle("noprice", !!k.noPrice);
  const date = $("date").value ? new Date($("date").value).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric" }) : "";
  const bank = $("bank") && $("bank").value, method = $("method") && $("method").value;
  $("doc").innerHTML = `<div class="top"><div><strong style="font-size:17px">${esc($("biz").value || "Your business")}</strong><br>${esc($("phone").value)}</div>
    <div style="text-align:right"><h2>${k.title}</h2>${esc($("no").value)}<br>${date}</div></div>
    <div>${k.to}: <strong>${esc($("cust").value || "—")}</strong></div>
    <table><tr><th>Item</th><th class="num">Qty</th>${k.noPrice ? "" : `<th class="num">Price</th><th class="num">Amount</th>`}</tr>
    ${its.map(i => `<tr><td>${esc(i.d)}</td><td class="num">${i.q}</td>${k.noPrice ? "" : `<td class="num">${naira(i.p)}</td><td class="num">${naira(i.q * i.p)}</td>`}</tr>`).join("")}</table>
    <div class="total">${k.noPrice ? `Total items: ${its.reduce((s, i) => s + i.q, 0)}` : `${k.total}: ${naira(total)}`}</div>
    ${k.pay && bank ? `<p><strong>Pay to:</strong> ${esc(bank)}</p>` : ""}
    ${k.paid && method ? `<p><strong>Paid by:</strong> ${esc(method)}</p>` : ""}
    <p class="foot">${k.foot}<br>Made free with SalesPal — salespal.online</p>`;
  try { SAVED.forEach(f => localStorage.setItem("ig_" + f, $(f).value)); } catch (e) {}
}
function sendWA() {
  const k = kind(), its = items(), total = its.reduce((s, i) => s + i.q * i.p, 0);
  const bank = $("bank") && $("bank").value, method = $("method") && $("method").value;
  const t = `*${k.title} ${$("no").value}* — ${$("biz").value}\n${k.to}: ${$("cust").value}\n`
    + its.map(i => k.noPrice ? `• ${i.d} × ${i.q}` : `• ${i.d} × ${i.q} = ${naira(i.q * i.p)}`).join("\n")
    + (k.noPrice ? "" : `\n*${k.total}: ${naira(total)}*`)
    + (k.pay && bank ? `\nPay to: ${bank}` : "") + (k.paid && method ? `\nPaid by: ${method}` : "");
  open("https://wa.me/?text=" + encodeURIComponent(t), "_blank");
}
// Carry what they typed into the app: /app reads salespal_draft on #new after signup.
const SOURCE = location.pathname.split("/")[1] || "generator";
function saveToApp() {
  try { localStorage.setItem("salespal_draft", JSON.stringify({ customer: $("cust").value, items: items() })); } catch (e) {}
  location.href = `/app/?utm_source=${SOURCE}#new`;
}
function nudge() { $("nudge").hidden = false; }

$("kind").innerHTML = Object.keys(KINDS).map(n => `<option>${n}</option>`).join("");
$("kind").value = $("kind").dataset.default || "Invoice";
$("no").value = kind().pre + "-001";
// Switching type renumbers only while the number is still an untouched default.
$("kind").addEventListener("change", () => {
  if (/^[A-Z]+-001$/.test($("no").value)) $("no").value = kind().pre + "-001";
  render();
});
try { SAVED.forEach(f => { const v = localStorage.getItem("ig_" + f); if (v) $(f).value = v; }); } catch (e) {}
$("date").valueAsDate = new Date();
document.querySelector(".tool").addEventListener("input", render);
addItem();
