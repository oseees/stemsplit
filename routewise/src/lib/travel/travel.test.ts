import { test } from "node:test"
import assert from "node:assert/strict"
import type { FlightOffer, HotelOffer } from "../providers/types"
import { sortFlights, filterFlights, pickHighlights } from "./flights"
import { sortHotels, filterHotels, bestValueHotel } from "./hotels"
import { estimate, budgetWarning } from "./budget"

function flight(p: Partial<FlightOffer>): FlightOffer {
  return {
    id: "",
    provider: "mock",
    airlineCode: "BA",
    airlineName: "British Airways",
    flightNumber: "BA100",
    origin: "LOS",
    destination: "LIS",
    departAt: "2026-09-10T08:00:00.000Z",
    arriveAt: "2026-09-10T14:00:00.000Z",
    durationMin: 360,
    stops: 0,
    layovers: [],
    price: 500,
    currency: "USD",
    cabin: "economy",
    baggage: "1 x 23kg checked",
    ...p,
  }
}

const offers: FlightOffer[] = [
  flight({ price: 900, durationMin: 300, stops: 0, airlineCode: "TP", departAt: "2026-09-10T06:00:00.000Z" }),
  flight({ price: 400, durationMin: 700, stops: 2, airlineCode: "BA", departAt: "2026-09-10T20:00:00.000Z" }),
  flight({ price: 620, durationMin: 420, stops: 1, airlineCode: "AF", departAt: "2026-09-10T12:00:00.000Z" }),
]

test("sortFlights by price ascending", () => {
  const s = sortFlights(offers, "price")
  assert.deepEqual(s.map((o) => o.price), [400, 620, 900])
})

test("sortFlights by duration and stops", () => {
  assert.equal(sortFlights(offers, "duration")[0].durationMin, 300)
  assert.equal(sortFlights(offers, "stops")[0].stops, 0)
})

test("sortFlights earliest/latest by departure", () => {
  assert.equal(sortFlights(offers, "earliest")[0].departAt, "2026-09-10T06:00:00.000Z")
  assert.equal(sortFlights(offers, "latest")[0].departAt, "2026-09-10T20:00:00.000Z")
})

test("filterFlights by stops, price and airline", () => {
  assert.equal(filterFlights(offers, { maxStops: 0 }).length, 1)
  assert.equal(filterFlights(offers, { maxPrice: 650 }).length, 2)
  assert.deepEqual(
    filterFlights(offers, { airlines: ["BA"] }).map((o) => o.airlineCode),
    ["BA"]
  )
})

test("filterFlights by departure hour window", () => {
  // departFrom 10 keeps 12:00 and 20:00 departures
  assert.equal(filterFlights(offers, { departFrom: 10 }).length, 2)
})

test("pickHighlights identifies cheapest, fastest, best value", () => {
  const h = pickHighlights(offers)
  assert.equal(h.cheapest?.price, 400)
  assert.equal(h.fastest?.durationMin, 300)
  // Best value should not be the 2-stop cheapest nor the priciest nonstop.
  assert.equal(h.bestValue?.airlineCode, "AF")
})

test("pickHighlights on empty list", () => {
  assert.deepEqual(pickHighlights([]), {})
})

function hotel(p: Partial<HotelOffer>): HotelOffer {
  return {
    id: "",
    provider: "mock",
    name: "Test Hotel",
    image: "",
    rating: 8,
    stars: 4,
    nightlyPrice: 120,
    currency: "USD",
    nights: 5,
    totalPrice: 600,
    distanceKm: 1,
    amenities: ["Free Wi-Fi"],
    cancellation: "Free",
    ...p,
  }
}

const hotels: HotelOffer[] = [
  hotel({ name: "A", totalPrice: 900, rating: 9.2, distanceKm: 0.5, stars: 5, amenities: ["Free Wi-Fi", "Pool"] }),
  hotel({ name: "B", totalPrice: 400, rating: 7.0, distanceKm: 4, stars: 3, amenities: ["Free Wi-Fi"], nightlyPrice: 80 }),
  hotel({ name: "C", totalPrice: 600, rating: 8.4, distanceKm: 1.2, stars: 4, amenities: ["Free Wi-Fi", "Pool", "Parking"], nightlyPrice: 120 }),
]

test("sortHotels by price/rating/distance", () => {
  assert.equal(sortHotels(hotels, "price")[0].name, "B")
  assert.equal(sortHotels(hotels, "rating")[0].name, "A")
  assert.equal(sortHotels(hotels, "distance")[0].name, "A")
})

test("filterHotels by stars and amenities (all must match)", () => {
  assert.equal(filterHotels(hotels, { minStars: 4 }).length, 2)
  assert.deepEqual(
    filterHotels(hotels, { amenities: ["Pool", "Parking"] }).map((h) => h.name),
    ["C"]
  )
})

test("bestValueHotel picks quality per dollar", () => {
  assert.equal(bestValueHotel(hotels)?.name, "B")
})

test("estimate computes committed and remaining", () => {
  const e = estimate({ budget: 2500, currency: "USD", flight: 720, hotel: 850, expenses: 0 })
  assert.equal(e.committed, 1570)
  assert.equal(e.remaining, 930)
  assert.equal(Math.round(e.usedPct), 63)
})

test("budgetWarning only fires when over budget", () => {
  assert.equal(budgetWarning(100, "USD", "flight"), null)
  const w = budgetWarning(-145, "USD", "hotel")
  assert.ok(w)
  assert.equal(w!.amount, 145)
  assert.match(w!.message, /exceeds your remaining budget/)
  assert.equal(w!.suggestions.length, 3)
})
