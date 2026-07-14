import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import TripCard from "@/components/TripCard"
import TripDialog from "@/components/TripDialog"

export default async function TripsPage() {
  const session = await auth()
  const trips = await prisma.trip.findMany({
    where: { userId: session!.user.id },
    include: { expenses: { select: { amount: true } } },
    orderBy: { startDate: "asc" },
  })

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Your trips</h1>
        <TripDialog trigger="+ New trip" />
      </div>

      {trips.length === 0 ? (
        <div className="card text-center text-slate-500">
          You haven’t planned any trips yet. Create your first one above.
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {trips.map((t) => (
            <TripCard
              key={t.id}
              trip={{ ...t }}
              spent={t.expenses.reduce((a, e) => a + e.amount, 0)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
