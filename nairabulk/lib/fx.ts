import { prisma } from "./prisma"

export type Rates = { rmbToNgn: number; usdToNgn: number; source: string }

type FetchLike = typeof fetch

// One call to a USD base gives us both pairs:
//   USD→NGN = conversion_rates.NGN
//   RMB→NGN = (USD→NGN) / (USD→CNY)
export async function fetchRates(fetchImpl: FetchLike = fetch): Promise<Rates> {
  const key = process.env.EXCHANGERATE_API_KEY
  if (!key || key === "YOUR_FX_KEY") {
    throw new Error("EXCHANGERATE_API_KEY is not configured")
  }

  const url = `https://v6.exchangerate-api.com/v6/${key}/latest/USD`
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`FX API returned ${res.status}`)
  const body = (await res.json()) as {
    result?: string
    conversion_rates?: Record<string, number>
  }
  const rates = body.conversion_rates
  if (body.result !== "success" || !rates?.NGN || !rates?.CNY) {
    throw new Error("FX API response missing NGN/CNY rates")
  }

  return {
    usdToNgn: rates.NGN,
    rmbToNgn: rates.NGN / rates.CNY,
    source: "exchangerate-api.com/USD",
  }
}

// Fetch live rates and persist them — the audit trail of what rate we used, when.
export async function captureRateSnapshot(fetchImpl: FetchLike = fetch) {
  const r = await fetchRates(fetchImpl)
  return prisma.exchangeRateSnapshot.create({
    data: {
      rmbToNgnRate: r.rmbToNgn.toFixed(4),
      usdToNgnRate: r.usdToNgn.toFixed(4),
      source: r.source,
    },
  })
}

export function latestRateSnapshot() {
  return prisma.exchangeRateSnapshot.findFirst({ orderBy: { capturedAt: "desc" } })
}
