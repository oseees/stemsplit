"use client"

import type { FlightHighlights } from "@/lib/travel/flights"
import type { FlightOffer } from "@/lib/providers/types"
import { money, fmtDuration } from "@/lib/utils"

const CARDS: { key: keyof FlightHighlights; label: string; accent: string }[] = [
  { key: "cheapest", label: "Cheapest", accent: "text-emerald-600" },
  { key: "bestValue", label: "Best value", accent: "text-brand-600" },
  { key: "fastest", label: "Fastest", accent: "text-violet-600" },
]

export default function FlightHighlightsRow({
  highlights,
  onPick,
}: {
  highlights: FlightHighlights
  onPick?: (offer: FlightOffer) => void
}) {
  const has = CARDS.some((c) => highlights[c.key])
  if (!has) return null
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {CARDS.map(({ key, label, accent }) => {
        const o = highlights[key]
        if (!o) return null
        return (
          <button
            key={key}
            onClick={() => onPick?.(o)}
            className="card text-left transition hover:shadow-md"
          >
            <p className={`text-xs font-semibold uppercase tracking-wide ${accent}`}>{label}</p>
            <p className="mt-1 text-xl font-bold">{money(o.price, o.currency)}</p>
            <p className="text-sm text-slate-500">
              {o.airlineName} · {fmtDuration(o.durationMin)} ·{" "}
              {o.stops === 0 ? "nonstop" : `${o.stops} stop${o.stops > 1 ? "s" : ""}`}
            </p>
          </button>
        )
      })}
    </div>
  )
}
