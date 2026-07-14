"use strict";
/* Visual symptom references for PoultryPal.
 *
 * These are simple, hand-drawn ILLUSTRATIONS (not photographs) of the hallmark
 * visible signs, so a farmer can compare what they see on the farm. Each disease
 * maps to an illustration + short "what to look for" + a link to REAL photos on
 * the web. Exposed as window.PoultryVisuals.
 */
(function () {
  const STROKE = "#9ca3af";

  // --- reusable parts -------------------------------------------------------

  // A chicken head; comb/wattle colour is the key clinical signal.
  function head(o) {
    o = o || {};
    const comb = o.comb || "#e11d48";
    const wattle = o.wattle || comb;
    const face = o.face || "#fff7ed";
    const eye = o.swollenEye
      ? `<ellipse cx="66" cy="54" rx="11" ry="8.5" fill="#fde68a" stroke="${STROKE}"/><circle cx="66" cy="54" r="2.6" fill="#111"/>`
      : `<circle cx="66" cy="53" r="2.6" fill="#111"/>`;
    const scabs = o.scabs
      ? `<g fill="#7c4a02"><circle cx="44" cy="30" r="3.2"/><circle cx="54" cy="24" r="3.4"/><circle cx="63" cy="29" r="2.8"/><circle cx="60" cy="66" r="3"/><circle cx="50" cy="68" r="2.6"/></g>`
      : "";
    const discharge = o.discharge
      ? `<path d="M86 60 q5 8 1 15" stroke="#93c5fd" stroke-width="3" fill="none"/>`
      : "";
    return `
      <path d="M38 24 q6 -13 12 -2 q6 -13 12 -1 q6 -11 10 3 q3 9 -3 12 l-40 0 q-4 -11 9 -12 Z" fill="${comb}" stroke="#00000022"/>
      <circle cx="58" cy="58" r="27" fill="${face}" stroke="${STROKE}" stroke-width="2"/>
      <path d="M84 54 l17 4 -17 6 Z" fill="#f59e0b"/>
      <path d="M70 80 q9 13 1 21 q-9 -1 -10 -17 Z" fill="${wattle}" stroke="#00000022"/>
      ${eye}${scabs}${discharge}`;
  }

  // A pile of droppings; colour + blood streaks are the signal.
  function dropping(color, streaks) {
    const s = streaks
      ? `<path d="M52 62 q6 9 0 18 M62 60 q5 9 -1 18" stroke="#b91c1c" stroke-width="3.5" fill="none"/>`
      : "";
    return `
      <ellipse cx="60" cy="74" rx="32" ry="15" fill="${color}" stroke="${STROKE}" stroke-width="2"/>
      <ellipse cx="60" cy="60" rx="15" ry="10" fill="${color}" stroke="${STROKE}" stroke-width="2"/>
      ${s}`;
  }

  // Newcastle: head/neck twisted up and back over the body ("star-gazing").
  function twistedNeck() {
    return `
      <ellipse cx="58" cy="84" rx="34" ry="18" fill="#f9fafb" stroke="${STROKE}" stroke-width="2"/>
      <path d="M44 80 Q18 66 30 42 Q38 24 60 30" fill="none" stroke="#f9fafb" stroke-width="15" stroke-linecap="round"/>
      <path d="M44 80 Q18 66 30 42 Q38 24 60 30" fill="none" stroke="${STROKE}" stroke-width="2" stroke-linecap="round"/>
      <circle cx="62" cy="30" r="12" fill="#f9fafb" stroke="${STROKE}" stroke-width="2"/>
      <path d="M52 24 q3 -7 6 -1 q3 -6 6 1 Z" fill="#e11d48"/>
      <path d="M50 30 l-10 3 10 3 Z" fill="#f59e0b"/>
      <circle cx="58" cy="29" r="2.2" fill="#111"/>`;
  }

  // Marek's: classic splayed legs — one stretched forward, one back.
  function legParalysis() {
    return `
      <ellipse cx="58" cy="50" rx="36" ry="22" fill="#f9fafb" stroke="${STROKE}" stroke-width="2"/>
      <circle cx="92" cy="40" r="12" fill="#f9fafb" stroke="${STROKE}" stroke-width="2"/>
      <path d="M86 30 q3 -7 6 -1 q3 -6 6 1 Z" fill="#e11d48"/>
      <path d="M104 38 l10 3 -10 3 Z" fill="#f59e0b"/>
      <circle cx="95" cy="38" r="2.2" fill="#111"/>
      <path d="M44 68 L22 94 M22 94 h8 M22 94 h-6" stroke="#f59e0b" stroke-width="4" fill="none"/>
      <path d="M72 68 L98 90 M98 90 h-8 M98 90 h6" stroke="#f59e0b" stroke-width="4" fill="none"/>`;
  }

  function svg(inner) {
    return `<svg viewBox="0 0 120 110" xmlns="http://www.w3.org/2000/svg" role="img">${inner}</svg>`;
  }

  function photo(query) {
    return "https://www.google.com/search?udm=2&q=" + encodeURIComponent(query + " chicken poultry symptoms");
  }

  // Authoritative citation: direct, verified MSD/Merck Veterinary Manual article URLs.
  const MSD = "https://www.merckvetmanual.com/poultry/";
  const REF = {
    coccidiosis: MSD + "coccidiosis/coccidiosis-in-poultry",
    newcastle: MSD + "newcastle-disease-and-other-paramyxovirus-infections/newcastle-disease-in-poultry",
    avian_influenza: MSD + "avian-influenza-in-poultry-and-wild-birds/avian-influenza-in-poultry-and-wild-birds",
    gumboro: MSD + "infectious-bursal-disease/infectious-bursal-disease-in-poultry",
    mareks: MSD + "neoplasms-in-poultry/marek-s-disease-in-poultry",
    fowl_pox: MSD + "fowlpox/fowlpox-in-chickens-and-turkeys",
    crd: MSD + "mycoplasmosis/overview-of-mycoplasmosis-in-poultry",
    infectious_bronchitis: MSD + "infectious-bronchitis/infectious-bronchitis-in-poultry",
    fowl_cholera: MSD + "fowl-cholera/fowl-cholera",
    worms: MSD + "helminthiasis/helminthiasis-in-poultry",
    salmonellosis: MSD + "salmonelloses-in-poultry/overview-of-salmonelloses-in-poultry",
  };
  // Direct article if known, else a domain-scoped search that always resolves.
  function refFor(key, name) {
    return REF[key] || ("https://www.google.com/search?q=" + encodeURIComponent((name || "") + " in poultry site:merckvetmanual.com"));
  }

  // --- per-disease visuals --------------------------------------------------
  const V = {
    healthy:        { name: "Healthy bird (for comparison)", svg: svg(head({ comb: "#e11d48" })), signs: "Bright red comb & wattles, alert, clear eyes, firm brown droppings." },
    coccidiosis:    { name: "Coccidiosis",            svg: svg(dropping("#6b4423", true)), signs: "Bloody / dark droppings, pale comb, ruffled feathers, huddling." },
    newcastle:      { name: "Newcastle disease",      svg: svg(twistedNeck()),             signs: "Twisted neck, paralysis, greenish watery diarrhoea, gasping; sudden deaths." },
    avian_influenza:{ name: "Avian influenza",        svg: svg(head({ comb: "#6d28d9", wattle: "#6d28d9", swollenEye: true })), signs: "Swollen, blue/purple comb & head; sudden high death. REPORT immediately." },
    gumboro:        { name: "Gumboro (IBD)",          svg: svg(dropping("#eef2f7", false)), signs: "Whitish, watery diarrhoea, soiled vent, huddling; spiking mortality 3–6 wks." },
    mareks:         { name: "Marek's disease",        svg: svg(legParalysis()),            signs: "Leg/wing paralysis — one leg forward, one back; wasting; grey eye." },
    fowl_pox:       { name: "Fowl pox",               svg: svg(head({ scabs: true })),     signs: "Wart-like scabs on comb, wattles and face (dry form)." },
    crd:            { name: "CRD / Mycoplasma",       svg: svg(head({ swollenEye: true, discharge: true })), signs: "Swollen face/sinus, watery eyes, sneezing, nasal discharge, rattling." },
    infectious_bronchitis: { name: "Infectious bronchitis", svg: svg(head({ swollenEye: true, discharge: true })), signs: "Coughing, sneezing, watery eyes; misshapen/soft-shelled eggs in layers." },
    fowl_cholera:   { name: "Fowl cholera",           svg: svg(head({ comb: "#7e22ce", wattle: "#7e22ce" })), signs: "Dark/purple swollen wattles, sudden deaths, greenish diarrhoea." },
    worms:          { name: "Intestinal worms",       svg: svg(head({ comb: "#fca5a5", wattle: "#fca5a5" })), signs: "Pale comb (anaemia), poor growth, dull feathers; worms in droppings." },
    salmonellosis:  { name: "Salmonellosis / Pullorum", svg: svg(dropping("#eef2f7", false)), signs: "Chicks: white pasty vent, huddling, high death. Adults: green diarrhoea." },
  };

  // Reference "keys" shown in the guide.
  const KEYS = [
    {
      name: "Comb & wattle colour — quick check",
      svg: svg(
        `<g transform="translate(-8,0) scale(0.62)">${head({ comb: "#e11d48" })}</g>` +
        `<g transform="translate(34,0) scale(0.62)">${head({ comb: "#fca5a5", wattle: "#fca5a5" })}</g>` +
        `<g transform="translate(76,0) scale(0.62)">${head({ comb: "#6d28d9", wattle: "#6d28d9" })}</g>`
      ),
      signs: "Red = healthy · Pale = anaemia (worms, severe disease) · Blue/purple = avian influenza or fowl cholera (urgent).",
    },
    {
      name: "Droppings colour — quick check",
      svg: svg(
        `<g transform="translate(-12,0) scale(0.5)">${dropping("#6b4423", false)}</g>` +
        `<g transform="translate(18,0) scale(0.5)">${dropping("#6b4423", true)}</g>` +
        `<g transform="translate(48,0) scale(0.5)">${dropping("#4d7c0f", false)}</g>` +
        `<g transform="translate(78,0) scale(0.5)">${dropping("#eef2f7", false)}</g>`
      ),
      signs: "Brown = normal · Bloody = coccidiosis · Greenish = Newcastle/cholera · White pasty = pullorum/Gumboro.",
    },
  ];

  // Match a disease name (from the diagnosis) to a visual.
  const ALIASES = [
    ["coccidios", "coccidiosis"], ["newcastle", "newcastle"], ["bursal", "gumboro"], ["gumboro", "gumboro"],
    ["influenza", "avian_influenza"], ["bird flu", "avian_influenza"], ["avian influen", "avian_influenza"],
    ["marek", "mareks"], ["pox", "fowl_pox"], ["mycoplasma", "crd"], ["respiratory", "crd"], ["crd", "crd"],
    ["bronchitis", "infectious_bronchitis"], ["cholera", "fowl_cholera"], ["pasteurell", "fowl_cholera"],
    ["worm", "worms"], ["helminth", "worms"], ["salmonell", "salmonellosis"], ["pullorum", "salmonellosis"], ["typhoid", "salmonellosis"],
  ];

  function forName(name) {
    const n = (name || "").toLowerCase();
    for (const [needle, key] of ALIASES) if (n.includes(needle)) {
      return Object.assign({ key }, V[key], { photo: photo(V[key].name), reference: refFor(key, V[key].name) });
    }
    return null;
  }

  function card(v) {
    return `<figure class="vis-card">
      <div class="vis-art">${v.svg}</div>
      <figcaption><strong>${v.name}</strong><span>${v.signs}</span>
        <span class="vis-links">
          ${v.photo ? `<a href="${v.photo}" target="_blank" rel="noopener">See real photos →</a>` : ""}
          ${v.reference ? `<a href="${v.reference}" target="_blank" rel="noopener">📖 MSD Vet Manual →</a>` : ""}
        </span>
      </figcaption>
    </figure>`;
  }

  function renderGuide() {
    const order = ["newcastle", "avian_influenza", "coccidiosis", "gumboro", "mareks", "fowl_pox", "crd", "fowl_cholera", "worms", "salmonellosis"];
    const cards = KEYS.map((k) => card(k)).join("") +
      card(Object.assign({}, V.healthy, { photo: photo(V.healthy.name) })) +
      order.map((k) => card(Object.assign({ key: k }, V[k], { photo: photo(V[k].name), reference: refFor(k, V[k].name) }))).join("");
    return `<div class="vis-note">🖍️ These are simple <strong>illustrations</strong> to help you compare — not photographs and not a diagnosis. Use the “See real photos” links and confirm with a vet.</div>
      <div class="vis-grid">${cards}</div>`;
  }

  window.PoultryVisuals = { forName, renderGuide, card };
})();
