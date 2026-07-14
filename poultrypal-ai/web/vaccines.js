"use strict";
/* Typical Nigerian poultry vaccination schedules (broilers + layers).
 *
 * Programmes VARY by hatchery, vaccine brand, and local disease pressure — this is a
 * common reference, not a prescription. Compiled from standard Nigerian poultry guides
 * and the Merck/MSD Veterinary Manual "Vaccination Programs for Poultry". Exposed as
 * window.PoultryVaccines.
 */
(function () {
  const BROILER = [
    ["Day 1", "Marek's disease", "At hatchery (injection)", "Usually done by the hatchery"],
    ["Day 7–9", "Gumboro / IBD — 1st", "Drinking water", ""],
    ["Day 14", "Newcastle (Lasota) ± IB — 1st", "Drinking water / eye drop", ""],
    ["Day 18–21", "Gumboro / IBD — 2nd", "Drinking water", ""],
    ["Day 24–28", "Newcastle (Lasota) — 2nd", "Drinking water", ""],
    ["Week 4*", "Fowl pox", "Wing-web stab", "*Only where fowl pox is common"],
  ];

  const LAYER = [
    ["Day 1", "Marek's disease", "At hatchery (injection)", "Usually done by the hatchery"],
    ["Day 7", "Newcastle (Hitchner B1 / Lasota) + IB — 1st", "Eye drop / drinking water", ""],
    ["Day 14", "Gumboro / IBD — 1st", "Drinking water", ""],
    ["Day 21", "Gumboro / IBD — 2nd", "Drinking water", ""],
    ["Day 28", "Newcastle (Lasota) — booster", "Drinking water", ""],
    ["Week 6", "Fowl pox + Newcastle (Komarov / killed)", "Wing-web + injection", ""],
    ["Week 8*", "Fowl typhoid", "Injection", "*Where fowl typhoid is endemic"],
    ["Week 10–12*", "Infectious coryza", "Injection", "*Where endemic"],
    ["Week 16–18", "Newcastle (killed) + IB + EDS — before lay", "Injection", "Deworm around point-of-lay"],
    ["In lay", "Newcastle (Lasota) booster every ~8–12 weeks", "Drinking water", "Keeps ND immunity up during lay"],
  ];

  function table(rows) {
    const body = rows
      .map(
        (r) =>
          `<tr><td class="vx-age">${r[0]}</td><td>${r[1]}</td><td class="vx-route">${r[2]}</td><td class="vx-note">${r[3] || ""}</td></tr>`
      )
      .join("");
    return `<table class="vx-table"><thead><tr><th>Age</th><th>Vaccine</th><th>Route</th><th>Notes</th></tr></thead><tbody>${body}</tbody></table>`;
  }

  function renderSchedule() {
    return `<div class="vis-note">💉 A <strong>typical</strong> Nigerian schedule — exact vaccines, ages and routes vary by hatchery, vaccine brand and the diseases common in your area. <strong>Confirm with your vet or vaccine supplier</strong>, give vaccines only to healthy birds, and keep the cold chain.</div>
      <h3 style="margin:14px 0 6px">Broilers</h3>${table(BROILER)}
      <h3 style="margin:18px 0 6px">Layers / pullets</h3>${table(LAYER)}
      <p class="muted" style="margin-top:10px">Tip: set phone reminders for each date. Good vaccination is the cheapest way to prevent the deadliest diseases (Newcastle, Gumboro, Marek's).</p>`;
  }

  window.PoultryVaccines = { renderSchedule, BROILER, LAYER };
})();
