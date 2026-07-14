"use client"

import { useMemo, useState } from "react"
import type { HotelOffer, PriceHistorySummary } from "@/lib/providers/types"
import type { TripBudgetInfo } from "@/lib/travel/tripBudget"
import { sortHotels, filterHotels, type HotelSort, type HotelFilters } from "@/lib/travel/hotels"
import { estimate } from "@/lib/travel/budget"
import HotelCard from "./HotelCard"
import HotelFiltersPanel from "./HotelFilters"
import HotelComparison from "./HotelComparison"
import BudgetSidebar from "./BudgetSidebar"
import PriceHistoryCard from "./PriceHistoryCard"
import { ResultSkeleton, EmptyState, ErrorState } from "./states"

type SearchResult = {
  offers: HotelOffer[]
  bestValueId: string | null
  priceHistory: PriceHistorySummary
}

const SORTS: { value: HotelSort; label: string }[] = [
  { value: "price", label: "Price" },
  { value: "rating", label: "Rating" },
  { value: "distance", label: "Distance" },
  { value: "value", label: "Best value" },
]

export default function HotelSearchClient({ trips }: { trips: TripBudgetInfo[] }) {
  const [localTrips, setLocalTrips] = useState(trips)
  const [tripId, setTripId] = useState(trips[0]?.id ?? "")

  const [destination, setDestination] = useState("Lisbon")
  const [checkIn, setCheckIn] = useState("")
  const [checkOut, setCheckOut] = useState("")
  const [guests, setGuests] = useState(2)
  const [rooms, setRooms] = useState(1)

  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [error, setError] = useState("")
  const [data, setData] = useState<SearchResult | null>(null)

  const [filters, setFilters] = useState<HotelFilters>({})
  const [sort, setSort] = useState<HotelSort>("price")
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [compareOffers, setCompareOffers] = useState<HotelOffer[] | null>(null)
  const [preview, setPreview] = useState<number | null>(null)
  const [notice, setNotice] = useState("")

  const selectedTrip = localTrips.find((t) => t.id === tripId)
  const remainingBefore = selectedTrip
    ? estimate({
        budget: selectedTrip.budget,
        currency: selectedTrip.currency,
        flight: selectedTrip.flightCost,
        expenses: selectedTrip.expensesTotal,
      }).remaining
    : undefined

  const visible = useMemo(() => {
    if (!data) return []
    return sortHotels(filterHotels(data.offers, filters), sort)
  }, [data, filters, sort])

  async function search(e: React.FormEvent) {
    e.preventDefault()
    if (!destination || !checkIn || !checkOut) {
      setError("Enter a destination and check-in / check-out dates.")
      setStatus("error")
      return
    }
    setStatus("loading")
    setError("")
    setCompareIds([])
    const qs = new URLSearchParams({
      destination,
      checkIn,
      checkOut,
      guests: String(guests),
      rooms: String(rooms),
    })
    try {
      const res = await fetch(`/api/hotels/search?${qs}`)
      if (!res.ok) throw new Error()
      setData(await res.json())
      setStatus("done")
    } catch {
      setStatus("error")
      setError("Hotel search failed. Please try again.")
    }
  }

  async function selectHotel(offer: HotelOffer) {
    if (!tripId) {
      setNotice("Create or pick a trip first to track this against your budget.")
      return
    }
    setNotice("")
    const res = await fetch(`/api/trips/${tripId}/select-hotel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...offer, city: destination }),
    })
    if (!res.ok) {
      setNotice("Could not add hotel to trip.")
      return
    }
    const { estimate: est } = await res.json()
    setLocalTrips((ts) => ts.map((t) => (t.id === tripId ? { ...t, hotelCost: est.hotel } : t)))
    setNotice(`Added ${offer.name} to ${selectedTrip?.label}.`)
  }

  function toggleCompare(id: string) {
    setCompareIds((ids) =>
      ids.includes(id) ? ids.filter((x) => x !== id) : ids.length < 3 ? [...ids, id] : ids
    )
  }

  async function openCompare() {
    const res = await fetch(`/api/hotels/compare?ids=${compareIds.join(",")}`)
    if (res.ok) setCompareOffers((await res.json()).offers)
  }

  return (
    <div className="space-y-6">
      <form onSubmit={search} className="card grid grid-cols-2 gap-3 lg:grid-cols-6">
        <div className="col-span-2">
          <label className="label">Destination</label>
          <input className="field" value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Lisbon" />
        </div>
        <div>
          <label className="label">Check-in</label>
          <input type="date" className="field" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
        </div>
        <div>
          <label className="label">Check-out</label>
          <input type="date" className="field" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
        </div>
        <div>
          <label className="label">Guests</label>
          <input type="number" min={1} max={16} className="field" value={guests} onChange={(e) => setGuests(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Rooms</label>
          <input type="number" min={1} max={8} className="field" value={rooms} onChange={(e) => setRooms(Number(e.target.value))} />
        </div>
        <div className="col-span-2 lg:col-span-6">
          <button className="btn-primary w-full sm:w-auto" disabled={status === "loading"}>
            {status === "loading" ? "Searching…" : "Search hotels"}
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
              title="Search for hotels"
              hint="Enter a destination and dates to compare stays against your budget."
            />
          )}
          {status === "done" && data && (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">{visible.length} hotels</p>
                <div className="flex items-center gap-2">
                  {compareIds.length >= 2 && (
                    <button className="btn-ghost" onClick={openCompare}>
                      Compare ({compareIds.length})
                    </button>
                  )}
                  <select className="field w-auto" value={sort} onChange={(e) => setSort(e.target.value as HotelSort)}>
                    {SORTS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {visible.length === 0 ? (
                <EmptyState title="No hotels match your filters" hint="Try relaxing the filters." />
              ) : (
                <div className="space-y-3">
                  {visible.map((o) => (
                    <HotelCard
                      key={o.id}
                      offer={o}
                      badge={o.id === data.bestValueId ? "Best value" : undefined}
                      compareChecked={compareIds.includes(o.id)}
                      compareDisabled={compareIds.length >= 3}
                      onCompareToggle={() => toggleCompare(o.id)}
                      onSelect={() => selectHotel(o)}
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
                kind="hotel"
                preview={preview != null ? { hotel: preview } : undefined}
              />
            </>
          ) : (
            <div className="card text-sm text-slate-500">
              Create a trip to track hotel costs against a budget.
            </div>
          )}

          {status === "done" && data && <PriceHistoryCard history={data.priceHistory} />}
          {status === "done" && data && (
            <HotelFiltersPanel offers={data.offers} filters={filters} onChange={setFilters} />
          )}
        </aside>
      </div>

      {compareOffers && (
        <HotelComparison
          offers={compareOffers}
          remainingBefore={remainingBefore}
          currency={selectedTrip?.currency}
          onClose={() => setCompareOffers(null)}
          onSelect={(o) => {
            setCompareOffers(null)
            selectHotel(o)
          }}
        />
      )}
    </div>
  )
}
