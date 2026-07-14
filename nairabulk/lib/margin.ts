export type MarginResult = {
  costNaira: number // per-unit landed cost in NGN at the given rate
  marginNaira: number // per-unit profit in NGN
  marginPct: number // profit as a % of selling price
  thresholdPct: number
  belowThreshold: boolean
}

// Our margin at a given RMB→NGN rate. As the naira weakens (rate rises), the
// RMB cost in naira rises and margin shrinks — belowThreshold flags that.
export function computeUnitMargin(args: {
  targetNairaPerUnit: number
  baseCostRmb: number
  rmbToNgn: number
  thresholdPct?: number
}): MarginResult {
  const { targetNairaPerUnit, baseCostRmb, rmbToNgn, thresholdPct = 15 } = args
  const costNaira = baseCostRmb * rmbToNgn
  const marginNaira = targetNairaPerUnit - costNaira
  const marginPct = targetNairaPerUnit > 0 ? (marginNaira / targetNairaPerUnit) * 100 : 0
  return {
    costNaira,
    marginNaira,
    marginPct,
    thresholdPct,
    belowThreshold: marginPct < thresholdPct,
  }
}
