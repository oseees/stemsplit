export type PriceTier = { minUnits: number; pricePerUnitNaira: number }

// Best (lowest) price whose minUnits threshold the committed volume has reached.
// Below the first tier's threshold, the first tier's price applies.
export function currentTierPrice(tiers: PriceTier[], unitsCommitted: number): number {
  const sorted = [...tiers].sort((a, b) => a.minUnits - b.minUnits)
  let price = sorted[0].pricePerUnitNaira
  for (const tier of sorted) {
    if (unitsCommitted >= tier.minUnits) price = tier.pricePerUnitNaira
  }
  return price
}
