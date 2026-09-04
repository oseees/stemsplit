import { test } from "node:test";
import assert from "node:assert/strict";
import { simulate, DEFAULT_INPUTS, bearingToCardinal, type BroilerInputs } from "./broiler.ts";

const make = (overrides: Partial<BroilerInputs> = {}): BroilerInputs => ({
  ...DEFAULT_INPUTS,
  ...overrides,
});

test("target temperature follows the brooding curve", () => {
  assert.equal(simulate(make({ birdAgeDays: 0 })).targetTempC, 34);
  assert.equal(simulate(make({ birdAgeDays: 21 })).targetTempC, 26);
  assert.equal(simulate(make({ birdAgeDays: 42 })).targetTempC, 20);
  // Monotonically decreasing with age.
  const t7 = simulate(make({ birdAgeDays: 7 })).targetTempC;
  const t28 = simulate(make({ birdAgeDays: 28 })).targetTempC;
  assert.ok(t7 > t28, "younger birds need a warmer house");
});

test("body weight and feed grow with age", () => {
  const young = simulate(make({ birdAgeDays: 7 }));
  const old = simulate(make({ birdAgeDays: 42 }));
  assert.ok(old.bodyWeightKg > young.bodyWeightKg);
  assert.ok(old.dailyFeedGPerBird > young.dailyFeedGPerBird);
});

test("comfort band widens as birds age", () => {
  const young = simulate(make({ birdAgeDays: 3 }));
  const old = simulate(make({ birdAgeDays: 42 }));
  const bandYoung = young.comfortHighC - young.comfortLowC;
  const bandOld = old.comfortHighC - old.comfortLowC;
  assert.ok(bandOld > bandYoung);
});

test("hot, humid, poorly ventilated house flags extreme heat stress", () => {
  const r = simulate(make({
    birdAgeDays: 38,
    outsideTempC: 42,
    relativeHumidity: 80,
    ventilation: "natural",
    evaporativeCooling: false,
  }));
  assert.equal(r.heatStress.severity, "danger");
  assert.equal(r.climateStatus, "danger");
  assert.ok(r.thi > 30, `THI ${r.thi} should exceed the extreme threshold`);
  assert.equal(r.recommendations[0].severity, "danger");
  assert.ok(r.recommendations.some((x) => /heat stress/i.test(x.title)));
});

test("cold day-old chicks without heating trigger cold stress", () => {
  const r = simulate(make({
    birdAgeDays: 3,
    outsideTempC: 5,
    heatingAvailable: false,
    ventilation: "natural",
    evaporativeCooling: false,
  }));
  assert.equal(r.coldStress, true);
  assert.ok(r.effectiveTempC < r.comfortLowC);
  assert.ok(r.recommendations.some((x) => x.severity === "danger" && /cold/i.test(x.title)));
});

test("heating load is reported when it is cold and heating is available", () => {
  const cold = simulate(make({ birdAgeDays: 3, outsideTempC: 5, heatingAvailable: true }));
  assert.notEqual(cold.heatingLoadKw, null);
  assert.ok((cold.heatingLoadKw ?? 0) > 0);
  // A warm house needs no heating.
  const warm = simulate(make({ birdAgeDays: 3, outsideTempC: 34, heatingAvailable: true }));
  assert.ok(warm.heatingLoadKw === null || warm.heatingLoadKw === 0);
});

test("compass solar load: E-W is low, N-S is high", () => {
  const ew = simulate(make({ houseOrientationDeg: 90 }));
  const ns = simulate(make({ houseOrientationDeg: 0 }));
  assert.ok(ew.compass.solarLoadIndex < 0.05);
  assert.ok(ns.compass.solarLoadIndex > 0.95);
});

test("ventilation alignment rewards the right wind direction per vent type", () => {
  // Tunnel wants wind running ALONG the long axis.
  const tunnelGood = simulate(make({ ventilation: "tunnel", houseOrientationDeg: 90, prevailingWindDeg: 90 }));
  const tunnelBad = simulate(make({ ventilation: "tunnel", houseOrientationDeg: 90, prevailingWindDeg: 0 }));
  assert.ok(tunnelGood.compass.ventAlignmentScore > 0.9);
  assert.ok(tunnelBad.compass.ventAlignmentScore < 0.1);

  // Natural wants wind ACROSS the long axis.
  const natGood = simulate(make({ ventilation: "natural", houseOrientationDeg: 90, prevailingWindDeg: 0 }));
  const natBad = simulate(make({ ventilation: "natural", houseOrientationDeg: 90, prevailingWindDeg: 90 }));
  assert.ok(natGood.compass.ventAlignmentScore > 0.9);
  assert.ok(natBad.compass.ventAlignmentScore < 0.1);
});

test("overcrowding is flagged above the welfare ceiling", () => {
  const r = simulate(make({ birdAgeDays: 42, birdCount: 40000, houseLengthM: 100, houseWidthM: 12 }));
  assert.ok(r.densityKgM2 > 42);
  assert.equal(r.densityStatus, "danger");
  assert.ok(r.recommendations.some((x) => /density/i.test(x.title)));
});

test("water demand rises with heat", () => {
  const mild = simulate(make({ birdAgeDays: 35, outsideTempC: 20, evaporativeCooling: false }));
  const hot = simulate(make({ birdAgeDays: 35, outsideTempC: 40, ventilation: "natural", evaporativeCooling: false }));
  assert.ok(hot.dailyWaterMlPerBird > mild.dailyWaterMlPerBird);
});

test("recommendations are sorted most-severe first", () => {
  const r = simulate(make({
    birdAgeDays: 40,
    outsideTempC: 41,
    relativeHumidity: 82,
    birdCount: 40000,
    houseLengthM: 100,
    houseWidthM: 12,
    ventilation: "natural",
    evaporativeCooling: false,
  }));
  const rank = { danger: 0, warn: 1, info: 2, ok: 3 };
  for (let i = 1; i < r.recommendations.length; i++) {
    assert.ok(rank[r.recommendations[i].severity] >= rank[r.recommendations[i - 1].severity]);
  }
});

test("bearingToCardinal maps degrees to compass points", () => {
  assert.equal(bearingToCardinal(0), "N");
  assert.equal(bearingToCardinal(90), "E");
  assert.equal(bearingToCardinal(180), "S");
  assert.equal(bearingToCardinal(270), "W");
  assert.equal(bearingToCardinal(360), "N");
});
