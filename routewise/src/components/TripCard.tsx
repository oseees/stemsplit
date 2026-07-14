import Link from "next/link"
import { money, fmtDate } from "@/lib/utils"
import BudgetBar from "./BudgetBar"

export default function TripCard({
  trip,
  spent,
}: {
  trip: {
    id: string
    departureCity: string
    destination: string
    startDate: string | Date
    endDate: string | Date
    currency: string
    budget: number
    travelers: number
  }
  spent: number
}) {
  return (
    <Link href={`/trips/${trip.id}`} className="card block transition hover:shadow-md">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-lg font-semibold text-slate-900">
            {trip.departureCity} → {trip.destination}
          </p>
          <p className="text-sm text-slate-500">
            {fmtDate(trip.startDate)} – {fmtDate(trip.endDate)} · {trip.travelers} traveler
            {trip.travelers > 1 ? "s" : ""}
          </p>
        </div>
        <span className="rounded-full bg-brand-50 px-2 py-1 text-xs font-medium text-brand-700">
          {trip.currency}
        </span>
      </div>
      <div className="mt-4">
        <BudgetBar spent={spent} budget={trip.budget} />
        <p className="mt-2 text-sm text-slate-600">
          {money(spent, trip.currency)} of {money(trip.budget, trip.currency)}
        </p>
      </div>
    </Link>
  )
}
