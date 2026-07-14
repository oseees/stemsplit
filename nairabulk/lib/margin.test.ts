// Run: npx tsx lib/margin.test.ts
import assert from "node:assert"
import { computeUnitMargin } from "./margin"

// Healthy margin: Redmi at ₦285k, ¥890 cost, rate 230.5 → cost ₦205,145, ~28%.
const healthy = computeUnitMargin({
  targetNairaPerUnit: 285000,
  baseCostRmb: 890,
  rmbToNgn: 230.5,
})
assert.equal(healthy.costNaira, 205145)
assert.ok(Math.abs(healthy.marginPct - 28.02) < 0.1, `got ${healthy.marginPct}`)
assert.equal(healthy.belowThreshold, false)

// Naira weakens to 300 → cost ₦267,000, margin ~6.3% → flagged.
const squeezed = computeUnitMargin({
  targetNairaPerUnit: 285000,
  baseCostRmb: 890,
  rmbToNgn: 300,
})
assert.ok(squeezed.marginPct < 15)
assert.equal(squeezed.belowThreshold, true)

// Custom threshold.
assert.equal(
  computeUnitMargin({ targetNairaPerUnit: 100, baseCostRmb: 1, rmbToNgn: 80, thresholdPct: 25 })
    .belowThreshold,
  true // 20% < 25%
)

console.log("margin ok")
