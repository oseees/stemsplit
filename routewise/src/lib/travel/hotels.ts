import type { HotelOffer } from "../providers/types"

export type HotelSort = "price" | "rating" | "distance" | "value"

export interface HotelFilters {
  maxPrice?: number // by total stay cost
  minStars?: number
  amenities?: string[] // ALL must be present
}

// Value = review quality per dollar, lightly penalised by distance to centre.
export function hotelValueScore(h: HotelOffer): number {
  return (h.rating * 1000) / h.nightlyPrice - h.distanceKm * 2
}

export function sortHotels(offers: HotelOffer[], sort: HotelSort): HotelOffer[] {
  const copy = [...offers]
  switch (sort) {
    case "rating":
      return copy.sort((a, b) => b.rating - a.rating)
    case "distance":
      return copy.sort((a, b) => a.distanceKm - b.distanceKm)
    case "value":
      return copy.sort((a, b) => hotelValueScore(b) - hotelValueScore(a))
    case "price":
    default:
      return copy.sort((a, b) => a.totalPrice - b.totalPrice)
  }
}

export function filterHotels(offers: HotelOffer[], f: HotelFilters): HotelOffer[] {
  return offers.filter((h) => {
    if (f.maxPrice != null && h.totalPrice > f.maxPrice) return false
    if (f.minStars != null && h.stars < f.minStars) return false
    if (f.amenities?.length && !f.amenities.every((a) => h.amenities.includes(a))) return false
    return true
  })
}

export function bestValueHotel(offers: HotelOffer[]): HotelOffer | undefined {
  if (offers.length === 0) return undefined
  return offers.reduce((best, h) => (hotelValueScore(h) > hotelValueScore(best) ? h : best))
}
