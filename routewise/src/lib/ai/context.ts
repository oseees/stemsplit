import { prisma } from "@/lib/prisma"
import type { TripContext } from "./types"

export async function buildTripContext(tripId: string, userId: string): Promise<TripContext | null> {
  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    include: {
      expenses: { orderBy: { date: "asc" } },
      selectedFlight: { include: { quote: true } },
      selectedHotel: { include: { quote: true } },
    },
  })
  if (!trip) return null

  const nights = Math.max(
    1,
    Math.round((trip.endDate.getTime() - trip.startDate.getTime()) / 86_400_000)
  )

  return {
    id: trip.id,
    destination: trip.destination,
    departureCity: trip.departureCity,
    startDate: trip.startDate.toISOString().slice(0, 10),
    endDate: trip.endDate.toISOString().slice(0, 10),
    currency: trip.currency,
    budget: trip.budget,
    travelers: trip.travelers,
    nightsCount: nights,
    expenses: trip.expenses.map((e) => ({
      category: e.category,
      amount: e.amount,
      date: e.date.toISOString().slice(0, 10),
      notes: e.notes,
    })),
    selectedFlight: trip.selectedFlight
      ? {
          price: trip.selectedFlight.price,
          currency: trip.selectedFlight.currency,
          airline: trip.selectedFlight.quote.airlineName,
          durationMin: trip.selectedFlight.quote.durationMin,
        }
      : null,
    selectedHotel: trip.selectedHotel
      ? {
          price: trip.selectedHotel.price,
          currency: trip.selectedHotel.currency,
          name: trip.selectedHotel.quote.name,
          nights: trip.selectedHotel.quote.nights,
        }
      : null,
  }
}
