"use client"

import type { FlightOffer } from "@/lib/providers/types"
import { money, fmtTime, fmtDuration } from "@/lib/utils"

export default function FlightCard({
  offer,
  badge,
  selected,
  compareChecked,
  compareDisabled,
  onSelect,
  onCompareToggle,
  onHover,
}: {
  offer: FlightOffer
  badge?: string
  selected?: boolean
  compareChecked?: boolean
  compareDisabled?: boolean
  onSelect?: () => void
  onCompareToggle?: () => void
  onHover?: (price: number | null) => void
}) {
  const stopsLabel =
    offer.stops === 0 ? "Nonstop" : `${offer.stops} stop${offer.stops > 1 ? "s" : ""}`

  return (
    <div
      className={`card transition ${selected ? "ring-2 ring-brand-500" : ""}`}
      onMouseEnter={() => onHover?.(offer.price)}
      onMouseLeave={() => onHover?.(null)}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-2">
            <span className="font-semibold text-slate-800">{offer.airlineName}</span>
            <span className="text-xs text-slate-400">{offer.flightNumber}</span>
            {badge && (
              <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">
                {badge}
              </span>
            )}
          </div>

          <div className="flex items-center gap-3">
            <div className="text-center">
              <p className="text-lg font-bold">{fmtTime(offer.departAt)}</p>
              <p className="text-xs text-slate-400">{offer.origin}</p>
            </div>
            <div className="flex-1 text-center">
              <p className="text-xs text-slate-400">{fmtDuration(offer.durationMin)}</p>
              <div className="my-1 h-px bg-slate-200" />
              <p className="text-xs text-slate-500">
                {stopsLabel}
                {offer.layovers.length > 0 && ` · ${offer.layovers.join(", ")}`}
              </p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold">{fmtTime(offer.arriveAt)}</p>
              <p className="text-xs text-slate-400">{offer.destination}</p>
            </div>
          </div>

          <p className="mt-2 text-xs text-slate-400">
            {offer.cabin} · {offer.baggage} · via {offer.provider}
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 sm:flex-col sm:items-end">
          <p className="text-2xl font-bold text-slate-900">{money(offer.price, offer.currency)}</p>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-xs text-slate-500">
              <input
                type="checkbox"
                checked={!!compareChecked}
                disabled={compareDisabled && !compareChecked}
                onChange={onCompareToggle}
              />
              Compare
            </label>
            <button className={selected ? "btn-ghost" : "btn-primary"} onClick={onSelect}>
              {selected ? "Selected" : "Select"}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
