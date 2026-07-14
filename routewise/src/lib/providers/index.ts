import type { TravelProvider } from "./types"
import { mockFlightProvider } from "./mock/mockFlightProvider"
import { mockHotelProvider } from "./mock/mockHotelProvider"

// Single place that decides which concrete provider is live. Swap these for
// Amadeus/Duffel implementations (same interfaces) without touching routes/UI.
// Selection could later key off process.env.TRAVEL_PROVIDER.
const mockProvider: TravelProvider = {
  flights: mockFlightProvider,
  hotels: mockHotelProvider,
}

export function getTravelProvider(): TravelProvider {
  return mockProvider
}

export * from "./types"
