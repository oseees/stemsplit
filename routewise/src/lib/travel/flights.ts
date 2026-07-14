import type { FlightOffer } from "../providers/types"

export type FlightSort = "price" | "duration" | "stops" | "earliest" | "latest"

export interface FlightFilters {
  airlines?: string[] // airlineCode allow-list
  maxStops?: number
  minPrice?: number
  maxPrice?: number
  departFrom?: number // hour 0–23 inclusive
  departTo?: number
  arriveFrom?: number
  arriveTo?: number
  cabin?: string
}

export const hourOf = (iso: string): number => new Date(iso).getUTCHours()

export function sortFlights(offers: FlightOffer[], sort: FlightSort): FlightOffer[] {
  const copy = [...offers]
  switch (sort) {
    case "duration":
      return copy.sort((a, b) => a.durationMin - b.durationMin)
    case "stops":
      return copy.sort((a, b) => a.stops - b.stops || a.price - b.price)
    case "earliest":
      return copy.sort((a, b) => Date.parse(a.departAt) - Date.parse(b.departAt))
    case "latest":
      return copy.sort((a, b) => Date.parse(b.departAt) - Date.parse(a.departAt))
    case "price":
    default:
      return copy.sort((a, b) => a.price - b.price)
  }
}

export function filterFlights(offers: FlightOffer[], f: FlightFilters): FlightOffer[] {
  return offers.filter((o) => {
    if (f.airlines?.length && !f.airlines.includes(o.airlineCode)) return false
    if (f.maxStops != null && o.stops > f.maxStops) return false
    if (f.minPrice != null && o.price < f.minPrice) return false
    if (f.maxPrice != null && o.price > f.maxPrice) return false
    if (f.cabin && o.cabin !== f.cabin) return false
    const dep = hourOf(o.departAt)
    const arr = hourOf(o.arriveAt)
    if (f.departFrom != null && dep < f.departFrom) return false
    if (f.departTo != null && dep > f.departTo) return false
    if (f.arriveFrom != null && arr < f.arriveFrom) return false
    if (f.arriveTo != null && arr > f.arriveTo) return false
    return true
  })
}

export interface FlightHighlights {
  cheapest?: FlightOffer
  fastest?: FlightOffer
  bestValue?: FlightOffer
}

// Best value balances price and duration (normalised 0–1) with a small stop
// penalty, so a slightly pricier nonstop can beat a rock-bottom triple-connection.
export function pickHighlights(offers: FlightOffer[]): FlightHighlights {
  if (offers.length === 0) return {}
  const prices = offers.map((o) => o.price)
  const durations = offers.map((o) => o.durationMin)
  const pMin = Math.min(...prices)
  const pMax = Math.max(...prices)
  const dMin = Math.min(...durations)
  const dMax = Math.max(...durations)
  const norm = (v: number, lo: number, hi: number) => (hi === lo ? 0 : (v - lo) / (hi - lo))

  let cheapest = offers[0]
  let fastest = offers[0]
  let bestValue = offers[0]
  let bestScore = Infinity
  for (const o of offers) {
    if (o.price < cheapest.price) cheapest = o
    if (o.durationMin < fastest.durationMin) fastest = o
    const score =
      0.6 * norm(o.price, pMin, pMax) + 0.35 * norm(o.durationMin, dMin, dMax) + 0.05 * o.stops
    if (score < bestScore) {
      bestScore = score
      bestValue = o
    }
  }
  return { cheapest, fastest, bestValue }
}
