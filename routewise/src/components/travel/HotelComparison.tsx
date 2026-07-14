"use client"

import type { HotelOffer } from "@/lib/providers/types"
import { money } from "@/lib/utils"

export default function HotelComparison({
  offers,
  remainingBefore,
  currency,
  onClose,
  onSelect,
}: {
  offers: HotelOffer[]
  remainingBefore?: number // trip budget remaining before adding a hotel
  currency?: string
  onClose: () => void
  onSelect?: (o: HotelOffer) => void
}) {
  const minTotal = Math.min(...offers.map((o) => o.totalPrice))
  const maxRating = Math.max(...offers.map((o) => o.rating))
  const cur = currency ?? offers[0]?.currency ?? "USD"

  const rows: { label: string; cell: (o: HotelOffer) => React.ReactNode; best?: (o: HotelOffer) => boolean }[] = [
    { label: "Nightly", cell: (o) => money(o.nightlyPrice, o.currency) },
    { label: "Total stay", cell: (o) => money(o.totalPrice, o.currency), best: (o) => o.totalPrice === minTotal },
    { label: "Rating", cell: (o) => o.rating.toFixed(1), best: (o) => o.rating === maxRating },
    { label: "Stars", cell: (o) => "★".repeat(o.stars) },
    { label: "Distance", cell: (o) => `${o.distanceKm} km` },
    { label: "Amenities", cell: (o) => (o.amenities.length ? o.amenities.join(", ") : "—") },
    { label: "Cancellation", cell: (o) => o.cancellation },
    {
      label: "Budget impact",
      cell: (o) => {
        if (remainingBefore == null) return "—"
        const after = remainingBefore - o.totalPrice
        return (
          <span className={after < 0 ? "text-red-600" : "text-emerald-600"}>
            {money(after, cur)} left
          </span>
        )
      },
    },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <h2 className="font-bold">Compare hotels</h2>
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-slate-50">
                <th className="bg-slate-50 px-4 py-2" />
                {offers.map((o) => (
                  <td key={o.id} className="px-4 py-2 font-semibold text-slate-800">
                    {o.name}
                  </td>
                ))}
              </tr>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-slate-50">
                  <th className="whitespace-nowrap bg-slate-50 px-4 py-2 text-left font-medium text-slate-500">
                    {row.label}
                  </th>
                  {offers.map((o) => (
                    <td
                      key={o.id}
                      className={`px-4 py-2 ${row.best?.(o) ? "font-semibold text-emerald-600" : "text-slate-700"}`}
                    >
                      {row.cell(o)}
                    </td>
                  ))}
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
