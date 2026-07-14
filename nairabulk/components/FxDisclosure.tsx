import { latestRateSnapshot } from "@/lib/fx"

// Upfront FX transparency: we source in RMB, so we show the reference rate and
// when it was captured. The buyer's naira price is fixed — FX never raises it.
export default async function FxDisclosure() {
  const snap = await latestRateSnapshot()
  if (!snap) return null

  const rate = snap.rmbToNgnRate.toNumber()
  const captured = snap.capturedAt.toLocaleString("en-NG", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <div className="mt-6 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm">
      <p className="font-semibold text-gray-800">How we price — no hidden FX markup</p>
      <p className="mt-1 text-gray-600">
        We buy in Chinese Yuan (¥). Our reference rate is{" "}
        <span className="font-semibold">₦{rate.toFixed(2)} per ¥1</span>, captured{" "}
        {captured} <span className="text-gray-400">({snap.source})</span>.
      </p>
      <p className="mt-1 text-gray-600">
        Your price is fixed in Naira the moment you join — if the exchange rate moves,
        it&apos;s on us, never on you.
      </p>
    </div>
  )
}
