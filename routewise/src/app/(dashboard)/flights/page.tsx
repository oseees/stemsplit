import { auth } from "@/lib/auth"
import { getUserTripsBudget } from "@/lib/travel/tripBudget"
import FlightSearchClient from "@/components/travel/FlightSearchClient"

export default async function FlightsPage() {
  const session = await auth()
  const trips = await getUserTripsBudget(session!.user.id)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Flight search</h1>
        <p className="text-slate-500">Compare flights and see the impact on your trip budget.</p>
      </div>
      <FlightSearchClient trips={trips} />
    </div>
  )
}
