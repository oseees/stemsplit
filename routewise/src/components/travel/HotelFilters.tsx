"use client"

import type { HotelOffer } from "@/lib/providers/types"
import { HOTEL_AMENITIES } from "@/lib/providers/types"
import type { HotelFilters } from "@/lib/travel/hotels"

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-100 py-3 last:border-0">
      <p className="mb-2 text-sm font-semibold text-slate-700">{title}</p>
      {children}
    </div>
  )
}

export default function HotelFiltersPanel({
  offers,
  filters,
  onChange,
}: {
  offers: HotelOffer[]
  filters: HotelFilters
  onChange: (f: HotelFilters) => void
}) {
  const maxTotal = Math.max(...offers.map((o) => o.totalPrice), 100)
  const set = (patch: Partial<HotelFilters>) => onChange({ ...filters, ...patch })

  const toggleAmenity = (a: string) => {
    const cur = filters.amenities ?? []
    set({ amenities: cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a] })
  }

  return (
    <div className="card">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold">Filters</h3>
        <button className="text-xs text-brand-700" onClick={() => onChange({})}>
          Clear
        </button>
      </div>

      <Section title={`Budget (max total)`}>
        <input
          type="range"
          min={0}
          max={Math.ceil(maxTotal)}
          step={10}
          value={filters.maxPrice ?? Math.ceil(maxTotal)}
          onChange={(e) => set({ maxPrice: Number(e.target.value) })}
          className="w-full accent-brand-600"
        />
        <p className="text-xs text-slate-500">
          Up to {filters.maxPrice ?? Math.ceil(maxTotal)}
        </p>
      </Section>

      <Section title="Star rating">
        <div className="flex gap-1.5">
          {[3, 4, 5].map((s) => (
            <button
              key={s}
              onClick={() => set({ minStars: filters.minStars === s ? undefined : s })}
              className={`rounded-lg border px-2.5 py-1 text-xs ${
                filters.minStars === s
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-slate-200 text-slate-600"
              }`}
            >
              {s}+ ★
            </button>
          ))}
        </div>
      </Section>

      <Section title="Amenities">
        <div className="space-y-1">
          {HOTEL_AMENITIES.map((a) => (
            <label key={a} className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={filters.amenities?.includes(a) ?? false}
                onChange={() => toggleAmenity(a)}
              />
              {a}
            </label>
          ))}
        </div>
      </Section>
    </div>
  )
}
