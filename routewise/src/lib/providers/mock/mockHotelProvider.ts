import type { HotelOffer, HotelProvider, HotelSearchParams } from "../types"
import { HOTEL_AMENITIES } from "../types"
import { hash, seededRng } from "./data"
import { priceHistoryFor } from "./mockFlightProvider"

const NAME_PREFIX = ["Grand", "Central", "Riverside", "Sunset", "Royal", "Harbour", "Old Town", "Park"]
const NAME_SUFFIX = ["Hotel", "Suites", "Inn", "Residence", "Boutique", "Lodge"]

const CANCELLATION = [
  "Free cancellation until 24h before check-in",
  "Free cancellation until 48h before check-in",
  "Non-refundable",
  "Free cancellation anytime",
]

function nights(checkIn: string, checkOut: string): number {
  const n = Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86400000)
  return Math.max(1, n || 1)
}

export const mockHotelProvider: HotelProvider = {
  name: "mock",

  async searchHotels(params) {
    const stay = nights(params.checkIn, params.checkOut)
    const rng = seededRng(hash(`${params.destination}-${params.checkIn}-${params.guests}`))
    const count = 8 + Math.floor(rng() * 5) // 8–12 hotels

    const offers: HotelOffer[] = []
    for (let i = 0; i < count; i++) {
      const stars = 2 + Math.floor(rng() * 4) // 2–5
      const rating = Math.round((6 + rng() * 4) * 10) / 10 // 6.0–10.0
      // Price scales with stars and rooms, plus per-hotel variance.
      const nightly = Math.round((45 + stars * 35 + rng() * 60) * Math.max(1, params.rooms))
      const distanceKm = Math.round((0.2 + rng() * 8) * 10) / 10

      const amenities: string[] = []
      for (const a of HOTEL_AMENITIES) if (rng() < 0.55) amenities.push(a)
      // Higher-star hotels almost always have Wi-Fi.
      if (stars >= 4 && !amenities.includes("Free Wi-Fi")) amenities.push("Free Wi-Fi")

      const name = `${NAME_PREFIX[Math.floor(rng() * NAME_PREFIX.length)]} ${
        NAME_SUFFIX[Math.floor(rng() * NAME_SUFFIX.length)]
      } ${params.destination}`
      const seed = hash(`${name}-${i}`)

      offers.push({
        id: "",
        provider: "mock",
        name,
        image: `https://picsum.photos/seed/${seed}/400/260`,
        rating,
        stars,
        nightlyPrice: nightly,
        currency: "USD",
        nights: stay,
        totalPrice: nightly * stay,
        distanceKm,
        amenities,
        cancellation: CANCELLATION[Math.floor(rng() * CANCELLATION.length)],
      })
    }
    return offers.sort((a, b) => a.totalPrice - b.totalPrice)
  },

  async priceHistory(destination, currency) {
    const offers = await this.searchHotels({
      destination,
      checkIn: new Date().toISOString().slice(0, 10),
      checkOut: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10),
      guests: 2,
      rooms: 1,
    })
    const current = offers.length ? Math.min(...offers.map((o) => o.nightlyPrice)) : 120
    return priceHistoryFor("hotel", destination.toLowerCase(), current, currency)
  },
}
