import { prisma } from "@/lib/prisma"
import { estimate, type BudgetEstimate } from "./budget"

export interface TripBudgetInfo {
  id: string
  label: string
  currency: string
  budget: number
  expensesTotal: number
  flightCost: number
  hotelCost: number
}

function toInfo(t: {
  id: string
  departureCity: string
  destination: string
  currency: string
  budget: number
  expenses: { amount: number }[]
  selectedFlight: { price: number } | null
  selectedHotel: { price: number } | null
}): TripBudgetInfo {
  return {
    id: t.id,
    label: `${t.departureCity} → ${t.destination}`,
    currency: t.currency,
    budget: t.budget,
    expensesTotal: t.expenses.reduce((a, e) => a + e.amount, 0),
    flightCost: t.selectedFlight?.price ?? 0,
    hotelCost: t.selectedHotel?.price ?? 0,
  }
}

const include = {
  expenses: { select: { amount: true } },
  selectedFlight: true,
  selectedHotel: true,
} as const

export async function getUserTripsBudget(userId: string): Promise<TripBudgetInfo[]> {
  const trips = await prisma.trip.findMany({
    where: { userId },
    orderBy: { startDate: "asc" },
    include,
  })
  return trips.map(toInfo)
}

export async function tripEstimate(tripId: string): Promise<BudgetEstimate | null> {
  const t = await prisma.trip.findUnique({ where: { id: tripId }, include })
  if (!t) return null
  const info = toInfo(t)
  return estimate({
    budget: info.budget,
    currency: info.currency,
    flight: info.flightCost,
    hotel: info.hotelCost,
    expenses: info.expensesTotal,
  })
}
