"use client"

import type { NearbyAirportSuggestion } from "@/lib/providers/types"
import { money } from "@/lib/utils"

export default function NearbyAirports({ suggestions }: { suggestions: NearbyAirportSuggestion[] }) {
  if (suggestions.length === 0) return null
  return (
    <div className="card space-y-2 border-emerald-200 bg-emerald-50">
      <h3 className="font-semibold text-emerald-800">💡 Nearby airports</h3>
      {suggestions.map((s) => (
        <p key={s.alternative} className="text-sm text-emerald-700">
          Instead of {s.requested}, fly into <strong>{s.alternativeName}</strong> ({s.distanceKm} km
          away) and save <strong>{money(s.savings, s.currency)}</strong>.
        </p>
      ))}
    </div>
  )
}
