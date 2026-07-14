"use client"

import { useMemo, useState } from "react"
import type {
  FlightOffer,
  NearbyAirportSuggestion,
  PriceHistorySummary,
} from "@/lib/providers/types"
import { CABINS } from "@/lib/providers/types"
import type { TripBudgetInfo } from "@/lib/travel/tripBudget"
import {
  sortFlights,
  filterFlights,
  pickHighlights,
  type FlightSort,
  type FlightFilters,
} from "@/lib/travel/flights"
import FlightCard from "./FlightCard"
import FlightFiltersPanel from "./FlightFilters"
import FlightHighlightsRow from "./FlightHighlights"
import FlightComparison from "./FlightComparison"
import BudgetSidebar from "./BudgetSidebar"
import PriceHistoryCard from "./PriceHistoryCard"
import NearbyAirports from "./NearbyAirports"
import { ResultSkeleton, EmptyState, ErrorState } from "./states"

type SearchResult = {
  offers: FlightOffer[]
  priceHistory: PriceHistorySummary
  nearbyAirports: NearbyAirportSuggestion[]
}

const SORTS: { value: FlightSort; label: string }[] = [
  { value: "price", label: "Lowest price" },
  { value: "duration", label: "Shortest duration" },
  { value: "stops", label: "Fewest stops" },
  { value: "earliest", label: "Earliest departure" },
  { value: "latest", label: "Latest departure" },
]

export default function FlightSearchClient({ trips }: { trips: TripBudgetInfo[] }) {
  const [localTrips, setLocalTrips] = useState(trips)
  const [tripId, setTripId] = useState(trips[0]?.id ?? "")

  const [origin, setOrigin] = useState("Lagos")
  const [destination, setDestination] = useState("London")
  const [departDate, setDepartDate] = useState("")
  const [returnDate, setReturnDate] = useState("")
  const [passengers, setPassengers] = useState(1)
  const [cabin, setCabin] = useState("economy")
  const [roundTrip, setRoundTrip] = useState(false)

  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [error, setError] = useState("")
  const [data, setData] = useState<SearchResult | null>(null)

  const [filters, setFilters] = useState<FlightFilters>({})
  const [sort, setSort] = useState<FlightSort>("price")
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [compareOffers, setCompareOffers] = useState<FlightOffer[] | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const [notice, setNotice] = useState("")

  const selectedTrip = localTrips.find((t) => t.id === tripId)

  const visible = useMemo(() => {
    if (!data) return []
    return sortFlights(filterFlights(data.offers, filters), sort)
  }, [data, filters, sort])

  const highlights = useMemo(() => pickHighlights(visible), [visible])

  async function search(e: React.FormEvent) {
    e.preventDefault()
    if (!origin || !destination || !departDate) {
      setError("Enter origin, destination and a departure date.")
      setStatus("error")
      return
    }
    setStatus("loading")
    setError("")
    setCompareIds([])
    const qs = new URLSearchParams({
      origin,
      destination,
      departDate,
      passengers: String(passengers),
      cabin,
      roundTrip: String(roundTrip),
    })
    if (roundTrip && returnDate) qs.set("returnDate", returnDate)
    try {
      const res = await fetch(`/api/flights/search?${qs}`)
      if (!res.ok) throw new Error()
      setData(await res.json())
      setStatus("done")
    } catch {
      setStatus("error")
      setError("Flight search failed. Please try again.")
    }
  }

  async function selectFlight(offer: FlightOffer) {
    if (!tripId) {
      setNotice("Create or pick a trip first to track this against your budget.")
      return
    }
    setNotice("")
    const res = await fetch(`/api/trips/${tripId}/select-flight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(offer),
    })
    if (!res.ok) {
      setNotice("Could not add flight to trip.")
      return
    }
    const { estimate } = await res.json()
    setLocalTrips((ts) =>
      ts.map((t) => (t.id === tripId ? { ...t, flightCost: estimate.flight } : t))
    )
    setNotice(`Added ${offer.airlineName} flight to ${selectedTrip?.label}.`)
  }

  function toggleCompare(id: string) {
    setCompareIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < 3 ? [...ids, id] : ids
    )
  }

  async function openCompare() {
    const res = await fetch(`/api/flights/compare?ids=${compareIds.join(",")}`)
    if (res.ok) setCompareOffers((await res.json()).offers)
  }

  return (
    <div className="space-y-6">
      <form onSubmit={search} className="card grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="col-span-2 lg:col-span-1">
          <label className="label">From</label>
          <input className="field" value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="Lagos or LOS" />
        </div>
        <div className="col-span-2 lg:col-span-1">
          <label className="label">To</label>
          <input className="field" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="London or LHR" />
        </div>
        <div>
          <label className="label">Departure</label>
          <input type="date" className="field" value={departDate} onChange={(e) => setDepartDate(e.target.value)} />
        </div>
        <div>
          <label className="label">Return</label>
          <input
            type="date"
            className="field"
            value={returnDate}
            disabled={!roundTrip}
            onChange={(e) => setReturnDate(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Passengers</label>
          <input type="number" min={1} max={9} className="field" value={passengers} onChange={(e) => setPassengers(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Cabin</label>
          <select className="field capitalize" value={cabin} onChange={(e) => setCabin(e.target.value)}>
            {CABINS.map((c) => (
              <option key={c} value={c} className="capitalize">
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <div className="flex rounded-xl border border-slate-300 p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setRoundTrip(false)}
              className={`rounded-lg px-3 py-1.5 ${!roundTrip ? "bg-brand-600 text-white" : "text-slate-600"}`}
            >
              One-way
            </button>
            <button
              type="button"
              onClick={() => setRoundTrip(true)}
              className={`rounded-lg px-3 py-1.5 ${roundTrip ? "bg-brand-600 text-white" : "text-slate-600"}`}
            >
              Round trip
            </button>
          </div>
        </div>
        <div className="flex items-end">
          <button className="btn-primary w-full" disabled={status === "loading"}>
            {status === "loading" ? "Searching…" : "Search flights"}
          </button>
        </div>
      </form>

      {notice && (
        <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-2 text-sm text-brand-700">
          {notice}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          {status === "loading" && <ResultSkeleton />}
          {status === "error" && <ErrorState message={error} onRetry={() => setStatus("idle")} />}
          {status === "idle" && (
            <EmptyState
              title="Search for flights"
              hint="Enter your route and dates to compare cheapest, best-value and fastest options."
            />
          )}
          {status === "done" && data && (
            <>
              {data.nearbyAirports.length > 0 && <NearbyAirports suggestions={data.nearbyAirports} />}
              <FlightHighlightsRow highlights={highlights} onPick={selectFlight} />

              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">{visible.length} flights</p>
                <div className="flex items-center gap-2">
                  {compareIds.length >= 2 && (
                    <button className="btn-ghost" onClick={openCompare}>
                      Compare ({compareIds.length})
                    </button>
                  )}
                  <select
                    className="field w-auto"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as FlightSort)}
                  >
                    {SORTS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {visible.length === 0 ? (
                <EmptyState title="No flights match your filters" hint="Try relaxing the filters." />
              ) : (
                <div className="space-y-3">
                  {visible.map((o) => (
                    <FlightCard
                      key={o.id}
                      offer={o}
                      badge={
                        o.id === highlights.bestValue?.id
                          ? "Best value"
                          : o.id === highlights.cheapest?.id
                            ? "Cheapest"
                            : o.id === highlights.fastest?.id
                              ? "Fastest"
                              : undefined
                      }
                      compareChecked={compareIds.includes(o.id)}
                      compareDisabled={compareIds.length >= 3}
                      onCompareToggle={() => toggleCompare(o.id)}
                      onSelect={() => selectFlight(o)}
                      onHover={setPreview}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <aside className="space-y-4">
          {localTrips.length > 0 && selectedTrip ? (
            <>
              <div className="card">
                <label className="label">Track against trip</label>
                <select className="field" value={tripId} onChange={(e) => setTripId(e.target.value)}>
                  {localTrips.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <BudgetSidebar
                trip={selectedTrip}
                kind="flight"
                preview={preview != null ? { flight: preview } : undefined}
              />
            </>
          ) : (
            <div className="card text-sm text-slate-500">
              Create a trip to track flight costs against a budget.
            </div>
          )}

          {status === "done" && data && <PriceHistoryCard history={data.priceHistory} />}

          {status === "done" && data && (
            <FlightFiltersPanel offers={data.offers} filters={filters} onChange={setFilters} />
          )}
        </aside>
      </div>

      {compareOffers && (
        <FlightComparison
          offers={compareOffers}
          onClose={() => setCompareOffers(null)}
          onSelect={(o) => {
            setCompareOffers(null)
            selectFlight(o)
          }}
        />
      )}
    </div>
  )
}
