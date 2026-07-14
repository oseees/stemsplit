// Domain types + provider interfaces. Business logic and UI depend ONLY on
// these — never on a concrete provider (Amadeus/Duffel/etc.), so providers can
// be swapped without touching anything downstream.

export type Cabin = "economy" | "premium" | "business" | "first"
export const CABINS: Cabin[] = ["economy", "premium", "business", "first"]

export interface FlightSearchParams {
  origin: string // IATA code or city name
  destination: string
  departDate: string // yyyy-mm-dd
  returnDate?: string
  passengers: number
  cabin: Cabin
  roundTrip: boolean
}

export interface FlightOffer {
  id: string // stable per-search id (db id once persisted)
  provider: string
  airlineCode: string
  airlineName: string
  flightNumber: string
  origin: string
  destination: string
  departAt: string // ISO
  arriveAt: string // ISO
  durationMin: number
  stops: number
  layovers: string[] // airport codes
  price: number
  currency: string
  cabin: Cabin
  baggage: string
}

export interface HotelSearchParams {
  destination: string
  checkIn: string // yyyy-mm-dd
  checkOut: string
  guests: number
  rooms: number
}

// Amenity flags the UI filters on live inside `amenities`.
export const HOTEL_AMENITIES = [
  "Free breakfast",
  "Free Wi-Fi",
  "Pool",
  "Parking",
  "Pet friendly",
] as const

export interface HotelOffer {
  id: string
  provider: string
  name: string
  image: string
  rating: number // review score 0–10
  stars: number // 1–5
  nightlyPrice: number
  currency: string
  nights: number
  totalPrice: number
  distanceKm: number // from city centre
  amenities: string[]
  cancellation: string
}

export interface PricePoint {
  date: string // yyyy-mm-dd
  price: number
}

export interface PriceHistorySummary {
  currency: string
  current: number
  lowest: number
  average: number
  recommendation: "book" | "wait"
  reason: string
  points: PricePoint[]
}

export interface NearbyAirportSuggestion {
  requested: string
  alternative: string
  alternativeName: string
  distanceKm: number
  savings: number
  currency: string
}

export interface FlightProvider {
  readonly name: string
  searchFlights(params: FlightSearchParams): Promise<FlightOffer[]>
  priceHistory(origin: string, destination: string, currency: string): Promise<PriceHistorySummary>
  nearbyAirports(
    params: FlightSearchParams,
    offers: FlightOffer[]
  ): Promise<NearbyAirportSuggestion[]>
}

export interface HotelProvider {
  readonly name: string
  searchHotels(params: HotelSearchParams): Promise<HotelOffer[]>
  priceHistory(destination: string, currency: string): Promise<PriceHistorySummary>
}

export interface TravelProvider {
  flights: FlightProvider
  hotels: HotelProvider
}
