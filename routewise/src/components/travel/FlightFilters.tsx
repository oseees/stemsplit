"use client"

import type { FlightOffer } from "@/lib/providers/types"
import type { FlightFilters } from "@/lib/travel/flights"

const TIME_BUCKETS: { label: string; from: number; to: number }[] = [
  { label: "Morning", from: 6, to: 11 },
  { label: "Afternoon", from: 12, to: 17 },
  { label: "Evening", from: 18, to: 23 },
  { label: "Night", from: 0, to: 5 },
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-100 py-3 last:border-0">
      <p className="mb-2 text-sm font-semibold text-slate-700">{title}</p>
      {children}
    </div>
  )
}

export default function FlightFiltersPanel({
  offers,
  filters,
  onChange,
}: {
  offers: FlightOffer[]
  filters: FlightFilters
  onChange: (f: FlightFilters) => void
}) {
  const airlines = Array.from(
    new Map(offers.map((o) => [o.airlineCode, o.airlineName])).entries()
  )
  const cabins = Array.from(new Set(offers.map((o) => o.cabin)))
  const prices = offers.map((o) => o.price)
  const lo = Math.min(...prices, 0)
  const hi = Math.max(...prices, 100)
  const set = (patch: Partial<FlightFilters>) => onChange({ ...filters, ...patch })

  const toggleAirline = (code: string) => {
    const cur = filters.airlines ?? []
    set({ airlines: cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code] })
  }
  const timeActive = (from?: number, to?: number, b?: { from: number; to: number }) =>
    from === b?.from && to === b?.to

  return (
    <div className="card">
      <div className="mb-1 flex items-center justify-between">
        <h3 className="font-semibold">Filters</h3>
        <button className="text-xs text-brand-700" onClick={() => onChange({})}>
          Clear
        </button>
      </div>

      <Section title="Stops">
        <div className="flex flex-wrap gap-1.5">
          {[
            { label: "Any", v: undefined },
            { label: "Nonstop", v: 0 },
            { label: "≤ 1 stop", v: 1 },
          ].map((opt) => (
            <button
              key={opt.label}
              onClick={() => set({ maxStops: opt.v })}
              className={`rounded-lg border px-2.5 py-1 text-xs ${
                filters.maxStops === opt.v
                  ? "border-brand-500 bg-brand-50 text-brand-700"
                  : "border-slate-200 text-slate-600"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Price">
        <div className="flex items-center gap-2">
          <input
            type="number"
            className="field"
            placeholder={`${Math.floor(lo)}`}
            value={filters.minPrice ?? ""}
            onChange={(e) => set({ minPrice: e.target.value ? Number(e.target.value) : undefined })}
          />
          <span className="text-slate-400">–</span>
          <input
            type="number"
            className="field"
            placeholder={`${Math.ceil(hi)}`}
            value={filters.maxPrice ?? ""}
            onChange={(e) => set({ maxPrice: e.target.value ? Number(e.target.value) : undefined })}
          />
        </div>
      </Section>

      <Section title="Airlines">
        <div className="space-y-1">
          {airlines.map(([code, name]) => (
            <label key={code} className="flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={filters.airlines?.includes(code) ?? false}
                onChange={() => toggleAirline(code)}
              />
              {name}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Departure time">
        <div className="flex flex-wrap gap-1.5">
          {TIME_BUCKETS.map((b) => {
            const active = timeActive(filters.departFrom, filters.departTo, b)
            return (
              <button
                key={b.label}
                onClick={() =>
                  set(active ? { departFrom: undefined, departTo: undefined } : { departFrom: b.from, departTo: b.to })
                }
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  active ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"
                }`}
              >
                {b.label}
              </button>
            )
          })}
        </div>
      </Section>

      <Section title="Arrival time">
        <div className="flex flex-wrap gap-1.5">
          {TIME_BUCKETS.map((b) => {
            const active = timeActive(filters.arriveFrom, filters.arriveTo, b)
            return (
              <button
                key={b.label}
                onClick={() =>
                  set(active ? { arriveFrom: undefined, arriveTo: undefined } : { arriveFrom: b.from, arriveTo: b.to })
                }
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  active ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"
                }`}
              >
                {b.label}
              </button>
            )
          })}
        </div>
      </Section>

      {cabins.length > 1 && (
        <Section title="Cabin">
          <div className="flex flex-wrap gap-1.5">
            {cabins.map((c) => (
              <button
                key={c}
                onClick={() => set({ cabin: filters.cabin === c ? undefined : c })}
                className={`rounded-lg border px-2.5 py-1 text-xs capitalize ${
                  filters.cabin === c ? "border-brand-500 bg-brand-50 text-brand-700" : "border-slate-200 text-slate-600"
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}
