import { prisma } from "@/lib/prisma"
import type {
  FlightOffer,
  FlightProvider,
  FlightSearchParams,
  NearbyAirportSuggestion,
  PriceHistorySummary,
  PricePoint,
} from "../types"
import {
  AIRLINES,
  AIRPORTS,
  Airport,
  hash,
  haversineKm,
  resolveAirports,
  seededRng,
} from "./data"

const CABIN_MULT: Record<string, number> = {
  economy: 1,
  premium: 1.6,
  business: 2.9,
  first: 4.5,
}

// Per-airport cost index — how pricey it is to fly into. Powers the
// "fly into Gatwick instead of Heathrow" savings suggestion.
const AIRPORT_FACTOR: Record<string, number> = {
  LHR: 1.15,
  LGW: 0.92,
  STN: 0.85,
  LCY: 1.2,
  JFK: 1.1,
  EWR: 0.95,
  LGA: 1.0,
  CDG: 1.08,
  ORY: 0.96,
}

// When a query doesn't match our airport table, synthesize a stable airport so
// distances/prices still work rather than failing the search.
function pseudoAirport(query: string): Airport {
  const h = hash(query.toLowerCase())
  return {
    code: query.slice(0, 3).toUpperCase(),
    name: query,
    city: query,
    country: "—",
    lat: -60 + (h % 12000) / 100,
    lng: -180 + ((h >> 8) % 36000) / 100,
  }
}

function resolveOne(query: string): Airport {
  return resolveAirports(query)[0] ?? pseudoAirport(query)
}

const addMin = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60000).toISOString()

function generateOffers(
  origin: Airport,
  dest: Airport,
  params: FlightSearchParams
): FlightOffer[] {
  const distance = Math.max(150, haversineKm(origin, dest))
  const rng = seededRng(hash(`${origin.code}-${dest.code}-${params.departDate}-${params.cabin}`))
  const cabinMult = CABIN_MULT[params.cabin] ?? 1
  const destFactor = AIRPORT_FACTOR[dest.code] ?? 1
  const count = 5 + Math.floor(rng() * 4) // 5–8 offers

  const offers: FlightOffer[] = []
  for (let i = 0; i < count; i++) {
    const airline = AIRLINES[Math.floor(rng() * AIRLINES.length)]
    const stops = rng() < 0.5 ? 0 : rng() < 0.75 ? 1 : 2
    // Base fare ~ distance; nonstop costs more, extra stops add travel time.
    const baseFare = 40 + distance * (0.07 + rng() * 0.05)
    const nonstopPremium = stops === 0 ? 1.18 : 1
    const price = Math.round(
      baseFare * cabinMult * destFactor * nonstopPremium * params.passengers
    )
    const flightMin = Math.round(distance / 12 + 45) // ~720km/h + taxi
    const layoverMin = stops * (60 + Math.floor(rng() * 120))
    const durationMin = flightMin + layoverMin
    const departHour = 6 + Math.floor(rng() * 15) // 06:00–21:00
    const departAt = `${params.departDate}T${String(departHour).padStart(2, "0")}:${
      rng() < 0.5 ? "05" : "40"
    }:00.000Z`
    const layovers: string[] = []
    for (let s = 0; s < stops; s++) {
      const hub = AIRPORTS[Math.floor(rng() * AIRPORTS.length)].code
      if (hub !== origin.code && hub !== dest.code) layovers.push(hub)
    }
    offers.push({
      id: "", // assigned once persisted
      provider: "mock",
      airlineCode: airline.code,
      airlineName: airline.name,
      flightNumber: `${airline.code}${100 + Math.floor(rng() * 8900)}`,
      origin: origin.code,
      destination: dest.code,
      departAt,
      arriveAt: addMin(departAt, durationMin),
      durationMin,
      stops,
      layovers,
      price,
      currency: "USD",
      cabin: params.cabin,
      baggage: params.cabin === "economy" ? "1 x 23kg checked" : "2 x 32kg checked",
    })
  }
  return offers
}

function synthHistory(seed: number, current: number): PricePoint[] {
  const rng = seededRng(seed)
  const points: PricePoint[] = []
  const today = new Date()
  for (let d = 60; d >= 0; d -= 5) {
    const day = new Date(today.getTime() - d * 86400000)
    const wobble = 0.8 + rng() * 0.5 // 0.8–1.3x
    points.push({ date: day.toISOString().slice(0, 10), price: Math.round(current * wobble) })
  }
  points[points.length - 1].price = current // last point == current
  return points
}

async function priceHistoryFor(
  kind: "flight" | "hotel",
  route: string,
  current: number,
  currency: string
): Promise<PriceHistorySummary> {
  // Read cached history; write-through a synthetic series the first time so the
  // PriceHistory table is genuinely used and ready for real ingestion.
  let rows = await prisma.priceHistory.findMany({
    where: { kind, route },
    orderBy: { date: "asc" },
  })
  if (rows.length === 0) {
    const points = synthHistory(hash(`${kind}:${route}`), current)
    await prisma.priceHistory.createMany({
      data: points.map((p) => ({ kind, route, date: new Date(p.date), price: p.price, currency })),
    })
    rows = await prisma.priceHistory.findMany({ where: { kind, route }, orderBy: { date: "asc" } })
  }

  const points = rows.map((r) => ({ date: r.date.toISOString().slice(0, 10), price: r.price }))
  const prices = points.map((p) => p.price)
  const lowest = Math.min(...prices)
  const average = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
  // Book if current is at/near the historical floor or below average.
  const book = current <= lowest * 1.05 || current < average * 0.98
  return {
    currency,
    current,
    lowest,
    average,
    recommendation: book ? "book" : "wait",
    reason: book
      ? "Current price is at or near its lowest — a good time to book."
      : "Prices have been lower recently; they may dip again — consider waiting.",
    points,
  }
}

export const mockFlightProvider: FlightProvider = {
  name: "mock",

  async searchFlights(params) {
    const origin = resolveOne(params.origin)
    const dests = resolveAirports(params.destination)
    const destList = dests.length ? dests : [pseudoAirport(params.destination)]
    return destList.flatMap((d) => generateOffers(origin, d, params)).sort((a, b) => a.price - b.price)
  },

  async priceHistory(origin, destination, currency) {
    const o = resolveOne(origin)
    const d = resolveOne(destination)
    const route = `${o.code}-${d.code}`
    const offers = await this.searchFlights({
      origin,
      destination,
      departDate: new Date().toISOString().slice(0, 10),
      passengers: 1,
      cabin: "economy",
      roundTrip: false,
    })
    const current = offers.length ? Math.min(...offers.map((x) => x.price)) : 300
    return priceHistoryFor("flight", route, current, currency)
  },

  async nearbyAirports(params, offers) {
    const requested = resolveAirports(params.destination)
    if (requested.length === 0) return []
    const primary = requested[0]
    const requestedCodes = new Set(requested.map((a) => a.code))
    const cheapestRequested = offers.length ? Math.min(...offers.map((o) => o.price)) : Infinity

    const origin = resolveOne(params.origin)
    const suggestions: NearbyAirportSuggestion[] = []
    for (const alt of AIRPORTS) {
      if (requestedCodes.has(alt.code)) continue
      const distanceKm = haversineKm(primary, alt)
      if (distanceKm > 120) continue // same metro area only
      const altOffers = generateOffers(origin, alt, params)
      const altCheapest = Math.min(...altOffers.map((o) => o.price))
      if (altCheapest < cheapestRequested) {
        suggestions.push({
          requested: primary.code,
          alternative: alt.code,
          alternativeName: `${alt.name} (${alt.city})`,
          distanceKm,
          savings: Math.round(cheapestRequested - altCheapest),
          currency: offers[0]?.currency ?? "USD",
        })
      }
    }
    return suggestions.sort((a, b) => b.savings - a.savings).slice(0, 2)
  },
}

export { priceHistoryFor }
