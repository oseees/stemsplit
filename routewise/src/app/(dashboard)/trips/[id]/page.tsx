import Link from "next/link"
import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import BudgetBar from "@/components/BudgetBar"
import CategoryChart from "@/components/CategoryChart"
import ExpenseManager from "@/components/ExpenseManager"
import TripDialog from "@/components/TripDialog"
import DeleteTripButton from "@/components/DeleteTripButton"
import { money, fmtDate } from "@/lib/utils"

export default async function TripDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const session = await auth()

  const trip = await prisma.trip.findFirst({
    where: { id, userId: session!.user.id },
    include: { expenses: { orderBy: { date: "desc" } } },
  })
  if (!trip) notFound()

  const spent = trip.expenses.reduce((a, e) => a + e.amount, 0)

  const byCategory = new Map<string, number>()
  for (const e of trip.expenses) {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount)
  }
  const categoryData = [...byCategory.entries()].map(([category, total]) => ({ category, total }))

  // Serialize dates for the client components.
  const expenses = trip.expenses.map((e) => ({
    id: e.id,
    amount: e.amount,
    category: e.category,
    date: e.date.toISOString(),
    notes: e.notes,
  }))

  return (
    <div className="space-y-8">
      <div>
        <Link href="/trips" className="text-sm text-slate-500 hover:text-brand-700">
          ← All trips
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {trip.departureCity} → {trip.destination}
            </h1>
            <p className="text-slate-500">
              {fmtDate(trip.startDate)} – {fmtDate(trip.endDate)} · {trip.travelers} traveler
              {trip.travelers > 1 ? "s" : ""} · {trip.currency}
            </p>
          </div>
          <div className="flex gap-2">
            <TripDialog trip={{ ...trip }} trigger="Edit trip" />
            <DeleteTripButton tripId={trip.id} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="card lg:col-span-2">
          <div className="mb-4 flex justify-between text-sm">
            <span className="text-slate-500">
              Spent {money(spent, trip.currency)} of {money(trip.budget, trip.currency)}
            </span>
            <span className={spent > trip.budget ? "font-semibold text-red-600" : "text-slate-500"}>
              {money(trip.budget - spent, trip.currency)} left
            </span>
          </div>
          <BudgetBar spent={spent} budget={trip.budget} />
        </div>
        <div className="card">
          <h2 className="mb-2 font-semibold">By category</h2>
          <CategoryChart data={categoryData} />
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-semibold">Expenses</h2>
        <ExpenseManager tripId={trip.id} currency={trip.currency} expenses={expenses} />
      </div>
    </div>
  )
}
