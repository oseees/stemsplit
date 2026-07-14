// Run: npx tsx lib/pricing.test.ts
import assert from 'node:assert'
import { currentTierPrice, type PriceTier } from './pricing'

const tiers: PriceTier[] = [
  { minUnits: 10, pricePerUnitNaira: 85000 },
  { minUnits: 50, pricePerUnitNaira: 78000 },
]

assert.equal(currentTierPrice(tiers, 0), 85000) // below first threshold → first tier
assert.equal(currentTierPrice(tiers, 10), 85000) // exactly first threshold
assert.equal(currentTierPrice(tiers, 49), 85000) // between tiers
assert.equal(currentTierPrice(tiers, 50), 78000) // hits better tier
assert.equal(currentTierPrice(tiers, 200), 78000) // past last tier stays at best
// unsorted input must still work
assert.equal(currentTierPrice([tiers[1], tiers[0]], 60), 78000)

console.log('pricing ok')
