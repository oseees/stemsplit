"use strict";
/* Production optimizer UI — broiler weight gain + layer egg production (Nigeria).
 * Self-contained: window.PoultryBoost.mount(sectionEl) injects the form, wires the
 * broiler/layer toggle and the submit, calls /api/optimize, and renders the plan.
 */
(function () {
  const e = (s) =>
    String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  function statesFromDom() {
    return [...document.querySelectorAll('#diagnoseForm select[name="state"] option')]
      .map((o) => o.value)
      .filter(Boolean);
  }

  function formHtml() {
    const stateOpts =
      '<option value="">Select…</option>' + statesFromDom().map((s) => `<option>${e(s)}</option>`).join("");
    return `
      <h2>📈 Boost production</h2>
      <p class="muted">Grounded, Nigeria-specific advice to raise <strong>broiler weight gain</strong> (towards a good 6-week weight) or <strong>layer egg production</strong> — through feed, management and health. No hormones, no illegal boosters.</p>
      <form id="boostForm">
        <div class="seg">
          <label class="seg-opt on"><input type="radio" name="bird_type" value="broiler" checked> 🍗 Broiler — weight</label>
          <label class="seg-opt"><input type="radio" name="bird_type" value="layer"> 🥚 Layer — eggs</label>
        </div>
        <div class="row">
          <label>Age <input name="age" placeholder="e.g. 4 weeks / 30 weeks" /></label>
          <label>Flock size <input name="flock_size" type="number" min="1" inputmode="numeric" /></label>
        </div>
        <div class="row">
          <label>Breed / strain <input name="breed" placeholder="e.g. Ross 308 / ISA Brown" /></label>
          <label>State <select name="state">${stateOpts}</select></label>
        </div>
        <label data-for="broiler">Current average weight
          <input name="cm_broiler" placeholder="e.g. about 0.9 kg at 4 weeks" />
        </label>
        <label data-for="layer" class="hidden">Current egg production
          <input name="cm_layer" placeholder="e.g. 68% hen-day, or 380 eggs/day from 600 hens" />
        </label>
        <label>Your goal
          <input name="target" placeholder="broiler: 2.2 kg by 6 weeks · layer: reach 90%" />
        </label>
        <label>Feed you use
          <input name="feed" placeholder="brand &amp; type, e.g. Top Feeds finisher / self-mixed layer mash" />
        </label>
        <label>How you feed
          <input name="feeding_practice" placeholder="e.g. free choice / 120g twice a day" />
        </label>
        <label data-for="layer" class="hidden">Light hours per day
          <input name="lighting" placeholder="e.g. natural only, ~12 hours" />
        </label>
        <label>Challenges
          <input name="challenges" placeholder="e.g. heat, high feed cost, recent illness" />
        </label>
        <button type="submit" id="boostSubmit">Get production plan</button>
      </form>
      <div id="boostStatus" class="hidden"></div>
      <div id="boostResult"></div>`;
  }

  function applyType(root, type) {
    root.querySelectorAll("[data-for]").forEach((el) => {
      el.classList.toggle("hidden", el.getAttribute("data-for") !== type);
    });
    root.querySelectorAll(".seg-opt").forEach((l) => {
      l.classList.toggle("on", l.querySelector("input").value === type);
    });
  }

  function mount(sectionEl) {
    sectionEl.innerHTML = formHtml();
    const form = sectionEl.querySelector("#boostForm");
    const statusEl = sectionEl.querySelector("#boostStatus");
    const resultEl = sectionEl.querySelector("#boostResult");
    const submitBtn = sectionEl.querySelector("#boostSubmit");

    form.querySelectorAll('input[name="bird_type"]').forEach((r) =>
      r.addEventListener("change", () => applyType(sectionEl, r.value))
    );

    form.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (!navigator.onLine) {
        statusEl.className = "error";
        statusEl.textContent = "⚠️ You're offline. The production plan needs internet — the Visual guide and Vaccination schedule work offline.";
        statusEl.classList.remove("hidden");
        return;
      }
      const fd = new FormData(form);
      const type = fd.get("bird_type");
      const req = { bird_type: type };
      const fields = ["age", "breed", "state", "target", "feed", "feeding_practice", "challenges"];
      fields.forEach((k) => {
        const v = (fd.get(k) || "").trim();
        if (v) req[k] = v;
      });
      const fs = (fd.get("flock_size") || "").trim();
      if (fs) req.flock_size = Number(fs);
      const cm = (fd.get(type === "broiler" ? "cm_broiler" : "cm_layer") || "").trim();
      if (cm) req.current_metric = cm;
      if (type === "layer") {
        const lt = (fd.get("lighting") || "").trim();
        if (lt) req.lighting = lt;
      }

      submitBtn.disabled = true;
      resultEl.innerHTML = "";
      statusEl.className = "";
      statusEl.classList.remove("hidden");
      statusEl.innerHTML = '<span class="spinner"></span> Building your production plan from the knowledge base…';
      try {
        const res = await fetch("/api/optimize", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
        resultEl.innerHTML = renderPlan(data, type);
        statusEl.classList.add("hidden");
        resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch (err) {
        statusEl.className = "error";
        statusEl.textContent = "⚠️ " + err.message;
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  function sec(title, inner) {
    return `<div class="result-section"><h3>${title}</h3>${inner}</div>`;
  }
  function ul(items) {
    if (!items || !items.length) return '<p class="muted">None.</p>';
    return `<ul class="clean">${items.map((i) => `<li>${e(i)}</li>`).join("")}</ul>`;
  }

  function renderPlan(d, type) {
    const head = type === "broiler" ? "🍗 Broiler weight-gain plan" : "🥚 Layer egg-production plan";
    const parts = [`<div class="boost-head">${head}</div>`];

    parts.push(sec("Summary", `<p>${e(d.summary)}</p>`));
    if (d.current_assessment) parts.push(sec("Where your flock is now", `<div class="findings">${e(d.current_assessment)}</div>`));

    if (d.targets && d.targets.length) {
      const rows = d.targets.map((t) => `<tr><td>${e(t.label)}</td><td><strong>${e(t.value)}</strong></td></tr>`).join("");
      parts.push(sec("Targets (benchmark)", `<table class="vx-table"><tbody>${rows}</tbody></table>`));
    }

    parts.push(sec("Likely gaps holding you back", ul(d.gaps)));

    if (d.feeding_plan && d.feeding_plan.length) {
      const rows = d.feeding_plan
        .map((p) => `<div class="phase"><div class="phase-name">${e(p.phase)}</div><div>${e(p.detail)}</div></div>`)
        .join("");
      parts.push(sec("Feeding plan", rows));
    }

    parts.push(sec("Management actions", ul(d.management_actions)));
    parts.push(sec("Health checks", ul(d.health_checks)));

    if (d.weekly_plan && d.weekly_plan.length) {
      const rows = d.weekly_plan
        .map((w) => `<div class="tl"><div class="tl-when">${e(w.period)}</div><div class="tl-do">${e(w.actions)}</div></div>`)
        .join("");
      parts.push(sec("Week-by-week plan", `<div class="timeline">${rows}</div>`));
    }

    if (d.expected_outcome) parts.push(sec("What to expect", `<p>${e(d.expected_outcome)}</p>`));

    if (d.cautions && d.cautions.length) {
      parts.push(sec("⚠️ Cautions", `<ul class="clean cautions">${d.cautions.map((c) => `<li>${e(c)}</li>`).join("")}</ul>`));
    }

    if (d.sources_used && d.sources_used.length) {
      const src = d.sources_used.map((s) => `<li>${e(s.title)} <span class="muted">(${e(s.ref)})</span></li>`).join("");
      parts.push(sec("Sources used", `<ul class="clean sources">${src}</ul>`));
    }

    if (d.disclaimer) parts.push(`<p class="disclaimer">${e(d.disclaimer)}</p>`);

    return `<div class="card">${parts.join("")}</div>`;
  }

  window.PoultryBoost = { mount, renderPlan };
})();
