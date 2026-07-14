import Link from "next/link"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import StatCard from "@/components/StatCard"
import BudgetBar from "@/components/BudgetBar"
import TripCard from "@/components/TripCard"
import CategoryChart from "@/components/CategoryChart"
import TimeChart from "@/components/TimeChart"
import { money, fmtDate } from "@/lib/utils"

export default async function DashboardPage() {
  const session = await auth()
  const userId = session!.user.id

  const trips = await prisma.trip.findMany({
    where: { userId },
    include: { expenses: true },
    orderBy: { startDate: "asc" },
  })

  const now = new Date()
  const totalBudget = trips.reduce((s, t) => s + t.budget, 0)
  const totalExpenses = trips.reduce(
    (s, t) => s + t.expenses.reduce((a, e) => a + e.amount, 0),
    0
  )
  const remaining = totalBudget - totalExpenses

  // ponytail: totals mix currencies — display in the most common trip currency. Fine until users go multi-currency per dashboard.
  const currency = trips[0]?.currency ?? "USD"

  const upcoming = trips.filter((t) => t.endDate >= now)

  // Spending by category
  const byCategory = new Map<string, number>()
  // Spending over time (by day)
  const byDay = new Map<string, number>()
  for (const t of trips) {
    for (const e of t.expenses) {
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount)
      const day = e.date.toISOString().slice(0, 10)
      byDay.set(day, (byDay.get(day) ?? 0) + e.amount)
    }
  }
  const categoryData = [...byCategory.entries()].map(([category, total]) => ({ category, total }))
  const timeData = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, total]) => ({ date: fmtDate(day), total }))

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-900">Dashboard</h1>
        <Link href="/trips" className="btn-primary">
          Manage trips
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Upcoming trips" value={String(upcoming.length)} />
        <StatCard label="Total budget" value={money(totalBudget, currency)} />
        <StatCard label="Total spent" value={money(totalExpenses, currency)} />
        <StatCard
          label="Remaining"
          value={money(remaining, currency)}
          accent
          hint={remaining < 0 ? "Over budget" : "Left to spend"}
        />
      </div>

      <div className="card">
        <BudgetBar spent={totalExpenses} budget={totalBudget} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card">
          <h2 className="mb-2 font-semibold">Spending by category</h2>
          <CategoryChart data={categoryData} />
        </div>
        <div className="card">
          <h2 className="mb-2 font-semibold">Spending over time</h2>
          <TimeChart data={timeData} />
        </div>
      </div>

      <div>
        <h2 className="mb-3 font-semibold">Upcoming trips</h2>
        {upcoming.length === 0 ? (
          <div className="card text-center text-sm text-slate-500">
            No upcoming trips.{" "}
            <Link href="/trips" className="font-medium text-brand-700">
              Plan one →
            </Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {upcoming.map((t) => (
              <TripCard
                key={t.id}
                trip={{ ...t }}
                spent={t.expenses.reduce((a, e) => a + e.amount, 0)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
