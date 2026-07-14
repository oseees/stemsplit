"use client"

import type { FlightOffer } from "@/lib/providers/types"
import { money, fmtTime, fmtDuration } from "@/lib/utils"

const ROWS: { label: string; render: (o: FlightOffer) => string }[] = [
  { label: "Price", render: (o) => money(o.price, o.currency) },
  { label: "Airline", render: (o) => `${o.airlineName} (${o.flightNumber})` },
  { label: "Duration", render: (o) => fmtDuration(o.durationMin) },
  { label: "Stops", render: (o) => (o.stops === 0 ? "Nonstop" : `${o.stops}`) },
  { label: "Layovers", render: (o) => (o.layovers.length ? o.layovers.join(", ") : "—") },
  { label: "Departs", render: (o) => `${fmtTime(o.departAt)} ${o.origin}` },
  { label: "Arrives", render: (o) => `${fmtTime(o.arriveAt)} ${o.destination}` },
  { label: "Cabin", render: (o) => o.cabin },
  { label: "Baggage", render: (o) => o.baggage },
]

export default function FlightComparison({
  offers,
  onClose,
  onSelect,
}: {
  offers: FlightOffer[]
  onClose: () => void
  onSelect?: (o: FlightOffer) => void
}) {
  // Highlight the cheapest / shortest for quick scanning.
  const minPrice = Math.min(...offers.map((o) => o.price))
  const minDur = Math.min(...offers.map((o) => o.durationMin))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <h2 className="font-bold">Compare flights</h2>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.label} className="border-b border-slate-50">
                  <th className="whitespace-nowrap bg-slate-50 px-4 py-2 text-left font-medium text-slate-500">
                    {row.label}
                  </th>
                  {offers.map((o) => {
                    const best =
                      (row.label === "Price" && o.price === minPrice) ||
                      (row.label === "Duration" && o.durationMin === minDur)
                    return (
                      <td
                        key={o.id}
                        className={`px-4 py-2 ${best ? "font-semibold text-emerald-600" : "text-slate-700"}`}
                      >
                        {row.render(o)}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {onSelect && (
                <tr>
                  <th className="bg-slate-50 px-4 py-2" />
                  {offers.map((o) => (
                    <td key={o.id} className="px-4 py-2">
                      <button className="btn-primary" onClick={() => onSelect(o)}>
                        Select
                      </button>
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
