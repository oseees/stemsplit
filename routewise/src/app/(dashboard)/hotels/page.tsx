import { auth } from "@/lib/auth"
import { getUserTripsBudget } from "@/lib/travel/tripBudget"
import HotelSearchClient from "@/components/travel/HotelSearchClient"

export default async function HotelsPage() {
  const session = await auth()
  const trips = await getUserTripsBudget(session!.user.id)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Hotel search</h1>
        <p className="text-slate-500">Compare stays and track them against your remaining budget.</p>
      </div>
      <HotelSearchClient trips={trips} />
    </div>
  )
}
