"use strict";

// Register the service worker so the app installs and works offline.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

const form = document.getElementById("diagnoseForm");
const statusEl = document.getElementById("status");
const resultEl = document.getElementById("result");
const submitBtn = document.getElementById("submitBtn");
const imageInput = document.getElementById("imageInput");
const thumbs = document.getElementById("thumbs");

// ---- health check ----
fetch("/api/health")
  .then((r) => r.json())
  .then((h) => {
    if (!h.has_api_key) document.getElementById("keyWarning").classList.remove("hidden");
    setupVoice(h);
  })
  .catch(() => {});

// ---- voice input (speech -> text into the symptoms box, for review) ----
const recordBtn = document.getElementById("recordBtn");
const voiceBox = document.getElementById("voiceBox");
const voiceLang = document.getElementById("voiceLang");
const voiceStatus = document.getElementById("voiceStatus");
const voiceHint = document.getElementById("voiceHint");
const symptomsEl = document.getElementById("symptoms");
let mediaRecorder = null;
let chunks = [];
let recording = false;

function setupVoice(h) {
  const supported = h.has_voice && navigator.mediaDevices && window.MediaRecorder;
  if (!supported) return; // voice box stays hidden; typing still works
  voiceLang.innerHTML = Object.entries(h.voice_languages || { "": "Auto-detect" })
    .map(([code, label]) => `<option value="${code}">${esc(label)}</option>`)
    .join("");
  voiceBox.classList.remove("hidden");
  recordBtn.addEventListener("click", toggleRecording);
}

function pickMime() {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"];
  return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || "";
}

async function toggleRecording() {
  if (recording) {
    mediaRecorder && mediaRecorder.stop();
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    voiceStatus.textContent = "⚠️ Microphone permission denied.";
    return;
  }
  const mime = pickMime();
  chunks = [];
  mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
  mediaRecorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach((t) => t.stop());
    recording = false;
    recordBtn.classList.remove("rec");
    recordBtn.textContent = "🎙️ Describe flock & symptoms";
    await uploadAudio(new Blob(chunks, { type: mime || "audio/webm" }));
  };
  mediaRecorder.start();
  recording = true;
  recordBtn.classList.add("rec");
  recordBtn.textContent = "■ Stop & fill form";
  voiceStatus.textContent = "● Recording… say the bird type, age, flock size, vaccinations, your state, and what you see. Then tap stop.";
}

async function uploadAudio(blob) {
  voiceStatus.innerHTML = '<span class="spinner"></span> Transcribing & reading the details…';
  const fd = new FormData();
  fd.append("audio", blob, "clip.webm");
  fd.append("language", voiceLang.value || "");
  try {
    const res = await fetch("/api/voice-intake", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
    if (!data.transcript) {
      voiceStatus.textContent = "Didn't catch anything — try again, closer to the mic.";
      return;
    }
    const filled = fillForm(data.fields || {});
    symptomsEl.focus();
    voiceHint.classList.remove("hidden");
    if (data.extracted && filled.length) {
      voiceStatus.textContent = `Filled from your voice: ${filled.join(", ")}. Please check each field.`;
    } else {
      voiceStatus.textContent = "Added your words to Symptoms. Please check it and fill the other fields.";
    }
  } catch (err) {
    voiceStatus.textContent = "⚠️ " + err.message;
  }
}

// Put extracted fields into the form (selects only set if the option exists).
function fillForm(fields) {
  const f = document.getElementById("diagnoseForm");
  const labels = {
    species: "Type", age: "Age", flock_size: "Flock size", sick_count: "Sick",
    dead_count: "Dead", days_since_onset: "Days since onset",
    vaccination_history: "Vaccinations", state: "State",
    recent_changes: "Recent changes", symptoms: "Symptoms",
  };
  const filled = [];
  for (const name of Object.keys(labels)) {
    const val = (fields[name] || "").trim();
    const el = f.elements[name];
    if (!val || !el) continue;
    if (el.tagName === "SELECT") {
      const opt = [...el.options].find((o) => o.value === val || o.text === val);
      if (!opt) continue; // unknown option -> leave for the farmer to pick
      el.value = opt.value;
    } else {
      el.value = val;
    }
    el.classList.add("voicefilled");
    filled.push(labels[name]);
  }
  return filled;
}

// ---- production optimizer (broiler weight / layer eggs) ----
const boostBtn = document.getElementById("boostBtn");
const boostEl = document.getElementById("boost");
if (boostBtn && window.PoultryBoost) {
  boostBtn.addEventListener("click", () => {
    const hidden = boostEl.classList.toggle("hidden");
    if (!hidden && !boostEl.dataset.rendered) {
      PoultryBoost.mount(boostEl);
      boostEl.dataset.rendered = "1";
    }
    if (!hidden) boostEl.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// ---- visual symptom guide ----
const guideBtn = document.getElementById("guideBtn");
const guideEl = document.getElementById("guide");
if (guideBtn && window.PoultryVisuals) {
  guideBtn.addEventListener("click", () => {
    const hidden = guideEl.classList.toggle("hidden");
    if (!hidden && !guideEl.dataset.rendered) {
      guideEl.innerHTML = `<h2>📷 Visual symptom guide</h2>${PoultryVisuals.renderGuide()}`;
      guideEl.dataset.rendered = "1";
    }
    if (!hidden) guideEl.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// ---- sample case (for quick testing — no typing) ----
const SAMPLE_CASE = {
  species: "Chicken — broiler",
  state: "Ogun",
  age: "4 weeks",
  flock_size: "1000",
  sick_count: "20",
  dead_count: "5",
  days_since_onset: "10",
  vaccination_history: "Newcastle, Gumboro",
  symptoms: "breathing difficulty, watery droppings, weakness, poor appetite",
};
const sampleBtn = document.getElementById("sampleBtn");
if (sampleBtn) {
  sampleBtn.addEventListener("click", () => {
    fillForm(SAMPLE_CASE);
    submitBtn.scrollIntoView({ behavior: "smooth", block: "center" });
  });
}

// ---- vaccination schedule ----
const vaxBtn = document.getElementById("vaxBtn");
const vaxEl = document.getElementById("vaccines");
if (vaxBtn && window.PoultryVaccines) {
  vaxBtn.addEventListener("click", () => {
    const hidden = vaxEl.classList.toggle("hidden");
    if (!hidden && !vaxEl.dataset.rendered) {
      vaxEl.innerHTML = `<h2>💉 Vaccination schedule</h2>${PoultryVaccines.renderSchedule()}`;
      vaxEl.dataset.rendered = "1";
    }
    if (!hidden) vaxEl.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

// ---- image preview ----
imageInput.addEventListener("change", () => {
  thumbs.innerHTML = "";
  [...imageInput.files].slice(0, 4).forEach((f) => {
    const img = document.createElement("img");
    img.src = URL.createObjectURL(f);
    thumbs.appendChild(img);
  });
});

// ---- submit ----
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!navigator.onLine) {
    statusEl.className = "error";
    statusEl.textContent =
      "⚠️ You're offline. Diagnosis needs internet — but the Visual guide and Vaccination schedule work offline.";
    statusEl.classList.remove("hidden");
    return;
  }
  const fd = new FormData(form);

  const numeric = ["flock_size", "sick_count", "dead_count", "days_since_onset"];
  const farm = {};
  for (const [k, v] of fd.entries()) {
    if (k === "images") continue;
    if (v === "" || v == null) continue;
    farm[k] = numeric.includes(k) ? Number(v) : v;
  }

  const payload = new FormData();
  payload.append("farm", JSON.stringify(farm));
  [...imageInput.files].slice(0, 4).forEach((f) => payload.append("images", f));

  setLoading(true);
  resultEl.innerHTML = "";
  try {
    const res = await fetch("/api/diagnose", { method: "POST", body: payload });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || `Error ${res.status}`);
    render(data);
    statusEl.classList.add("hidden");
  } catch (err) {
    statusEl.className = "error";
    statusEl.textContent = "⚠️ " + err.message;
  } finally {
    setLoading(false);
  }
});

function setLoading(on) {
  submitBtn.disabled = on;
  if (on) {
    statusEl.className = "";
    statusEl.innerHTML = '<span class="spinner"></span> Analysing flock, images, and knowledge base…';
  }
}

// ---- rendering ----
const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function section(title, inner) {
  return `<div class="result-section"><h3>${title}</h3>${inner}</div>`;
}
function list(items) {
  if (!items || !items.length) return '<p class="muted">None provided.</p>';
  return `<ul class="clean">${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

function render(d) {
  const parts = [];

  parts.push(section("Summary", `<p>${esc(d.summary)}</p>`));

  if (d.image_findings) {
    parts.push(section("Image findings", `<div class="findings">${esc(d.image_findings)}</div>`));
  }

  const diseases = (d.likely_diseases || [])
    .map((dz) => {
      const pct = Math.max(0, Math.min(100, dz.confidence_percent || 0));
      const v = window.PoultryVisuals ? PoultryVisuals.forName(dz.name) : null;
      const vlinks = v
        ? [
            v.photo ? `<a href="${v.photo}" target="_blank" rel="noopener">See real photos →</a>` : "",
            v.reference ? `<a href="${v.reference}" target="_blank" rel="noopener">📖 MSD Vet Manual →</a>` : "",
          ].join("")
        : "";
      const visual = v
        ? `<div class="disease-visual"><div class="vis-art sm">${v.svg}</div>
             <div class="disease-visual-txt"><span>Typical look: ${esc(v.signs)}</span>
               <span class="vis-links">${vlinks}</span>
             </div>
           </div>`
        : "";
      return `<div class="disease">
        <div class="disease-head"><span class="disease-name">${esc(dz.name)}</span><span class="conf">${pct}%</span></div>
        <div class="bar"><span style="width:${pct}%"></span></div>
        <div class="disease-reason">${esc(dz.reasoning)}</div>
        ${visual}
      </div>`;
    })
    .join("");
  parts.push(section("Likely diseases", diseases || '<p class="muted">Not enough information.</p>'));

  parts.push(section("Immediate actions", list(d.immediate_actions)));
  if (d.isolation) parts.push(section("Isolation", `<p>${esc(d.isolation)}</p>`));
  parts.push(section("Treatment plan", list(d.treatment_plan)));

  const drugs =
    d.drugs && d.drugs.length
      ? d.drugs
          .map(
            (dr) =>
              `<div class="drug"><div class="drug-name">${esc(dr.name)}</div><div>${esc(dr.note)}</div><div class="drug-src">Source: ${esc(dr.source)}</div></div>`
          )
          .join("")
      : '<p class="muted">No drug found in the knowledge base for this case. A vet should prescribe any medication.</p>';
  parts.push(section("Drugs", drugs));

  const tests =
    d.recommended_tests && d.recommended_tests.length
      ? d.recommended_tests
          .map(
            (t) =>
              `<div class="test"><div class="test-name">${esc(t.test)}</div><div class="test-reason">${esc(t.reason)}</div></div>`
          )
          .join("")
      : '<p class="muted">No specific confirmatory test suggested.</p>';
  parts.push(section("Recommended tests (to confirm)", tests));

  parts.push(section("Prevention", list(d.prevention)));

  const v = d.call_vet || { urgency: "soon", reason: "", recommended: true };
  const label = { routine: "Routine", soon: "See a vet soon", urgent: "🚨 Call a vet urgently" }[v.urgency] || "See a vet";
  parts.push(section("When to call a vet", `<div class="vet ${esc(v.urgency)}">${label} — ${esc(v.reason)}</div>`));

  if (d.labs && d.labs.length) {
    const labs = d.labs
      .map(
        (l) =>
          `<div class="lab">
            <div class="lab-name">${esc(l.name)}</div>
            <div class="lab-loc">📍 ${esc(l.location)}</div>
            <div class="lab-svc">${esc(l.services)}</div>
            <div class="lab-contact">📞 ${esc(l.contact)}</div>
            <div class="lab-note muted">${esc(l.note)}</div>
          </div>`
      )
      .join("");
    parts.push(
      section(
        "Where to get tested — Nigeria",
        `<p class="muted">Contact a lab to run the confirmatory tests above. Verify the contact details before travelling.</p>${labs}`
      )
    );
  }

  if (d.sources_used && d.sources_used.length) {
    const src = d.sources_used.map((s) => `<li>${esc(s.title)} <span class="muted">(${esc(s.ref)})</span></li>`).join("");
    parts.push(section("Sources used", `<ul class="clean sources">${src}</ul>`));
  }

  if (d.disclaimer) parts.push(`<p class="disclaimer">${esc(d.disclaimer)}</p>`);

  if (d.case_id) parts.push(feedbackPanel(d.case_id));

  resultEl.innerHTML = `<div class="card">${parts.join("")}</div>`;
  if (d.case_id) wireFeedback(d.case_id);
  resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---- outcome feedback (accuracy loop) ----
function feedbackPanel(caseId) {
  return `<div class="result-section feedback" id="fb-${caseId}">
    <h3>📝 Help us improve — what happened?</h3>
    <p class="muted">Tell us what your vet found and how your birds did. This makes the guidance more accurate for everyone.</p>
    <label class="fb-row">A vet/lab confirmed it was
      <input type="text" id="fb-confirmed" placeholder="e.g. Coccidiosis (leave blank if not confirmed)" />
    </label>
    <label class="fb-row">Outcome
      <select id="fb-outcome">
        <option value="">Select…</option>
        <option value="recovered">Birds recovered</option>
        <option value="ongoing">Still ongoing</option>
        <option value="died">Birds died</option>
        <option value="not_sure">Not sure yet</option>
      </select>
    </label>
    <label class="fb-row">Notes (optional)
      <input type="text" id="fb-notes" placeholder="What treatment did you use? Anything else?" />
    </label>
    <div class="fb-actions">
      <span class="fb-q">Was this helpful?</span>
      <button type="button" class="chip" data-helpful="yes">👍 Yes</button>
      <button type="button" class="chip" data-helpful="no">👎 No</button>
      <button type="button" id="fb-submit" class="fb-send">Send feedback</button>
    </div>
    <div id="fb-status" class="muted"></div>
  </div>`;
}

function wireFeedback(caseId) {
  let helpful = null;
  const root = document.getElementById(`fb-${caseId}`);
  if (!root) return;
  root.querySelectorAll(".chip").forEach((b) =>
    b.addEventListener("click", () => {
      helpful = b.dataset.helpful === "yes";
      root.querySelectorAll(".chip").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
    })
  );
  root.querySelector("#fb-submit").addEventListener("click", async () => {
    const payload = {
      case_id: caseId,
      confirmed_disease: root.querySelector("#fb-confirmed").value,
      outcome: root.querySelector("#fb-outcome").value,
      notes: root.querySelector("#fb-notes").value,
      helpful,
    };
    const status = root.querySelector("#fb-status");
    status.textContent = "Saving…";
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("Error " + res.status);
      status.textContent = "✅ Thank you — this helps improve PoultryPal.";
      root.querySelector("#fb-submit").disabled = true;
    } catch (err) {
      status.textContent = "⚠️ Could not save — " + err.message;
    }
  });
}
