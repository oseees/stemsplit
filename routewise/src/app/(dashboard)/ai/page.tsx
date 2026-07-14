import Link from "next/link"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { money } from "@/lib/utils"

const HEALTH_BADGE: Record<string, string> = {
  excellent: "bg-emerald-100 text-emerald-700",
  good: "bg-blue-100 text-blue-700",
  fair: "bg-amber-100 text-amber-700",
  poor: "bg-red-100 text-red-700",
}

export default async function AIDashboardPage() {
  const session = await auth()
  const userId = session!.user.id

  const trips = await prisma.trip.findMany({
    where: { userId },
    include: {
      analysis: true,
      expenses: { select: { amount: true } },
    },
    orderBy: { startDate: "asc" },
  })

  const analysed = trips.filter((t) => t.analysis)
  const avgScore = analysed.length
    ? Math.round(analysed.reduce((s, t) => s + t.analysis!.score, 0) / analysed.length)
    : null

  const totalPotentialSavings = analysed.reduce((s, t) => {
    const a = t.analysis?.analysis as Record<string, number> | null
    return s + (a?.potentialSavings ?? 0)
  }, 0)

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">AI Travel Intelligence</h1>
          <p className="text-slate-500 mt-0.5">Budget health, recommendations, and AI-powered insights for your trips.</p>
        </div>
        <Link href="/ai/chat" className="btn-primary">Open AI Chat</Link>
      </div>

      {/* Summary stats */}
      {analysed.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="card text-center">
            <p className="text-3xl font-bold text-slate-800">{avgScore}</p>
            <p className="text-sm text-slate-500 mt-1">Avg budget score</p>
          </div>
          <div className="card text-center">
            <p className="text-3xl font-bold text-emerald-600">{money(totalPotentialSavings, trips[0]?.currency ?? "USD")}</p>
            <p className="text-sm text-slate-500 mt-1">Potential savings</p>
          </div>
          <div className="card text-center">
            <p className="text-3xl font-bold text-slate-800">{analysed.length}/{trips.length}</p>
            <p className="text-sm text-slate-500 mt-1">Trips analysed</p>
          </div>
        </div>
      )}

      {/* Trip cards */}
      <div>
        <h2 className="mb-3 font-semibold text-slate-700">Your trips</h2>
        {trips.length === 0 ? (
          <div className="card text-center text-slate-500 py-10">
            No trips yet.{" "}
            <Link href="/trips" className="font-medium text-brand-700">Create one →</Link>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {trips.map((trip) => {
              const spent = trip.expenses.reduce((s, e) => s + e.amount, 0)
              const analysis = trip.analysis
              const fullData = analysis?.analysis as { potentialSavings?: number } | null
              return (
                <div key={trip.id} className="card hover:border-brand-200 transition">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-slate-800">
                        {trip.departureCity} → {trip.destination}
                      </p>
                      <p className="text-sm text-slate-500">
                        Budget: {money(trip.budget, trip.currency)} · Spent: {money(spent, trip.currency)}
                      </p>
                    </div>
                    {analysis && (
                      <div className="text-right shrink-0">
                        <p className="text-2xl font-bold text-slate-800">{analysis.score}</p>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium capitalize ${HEALTH_BADGE[analysis.health] ?? "bg-slate-100 text-slate-600"}`}>
                          {analysis.health}
                        </span>
                      </div>
                    )}
                  </div>

                  {analysis && fullData?.potentialSavings ? (
                    <p className="mt-2 text-xs text-emerald-600">
                      💡 Potential savings: {money(fullData.potentialSavings, trip.currency)}
                    </p>
                  ) : null}

                  <div className="mt-3 flex gap-2">
                    <Link href={`/ai/${trip.id}`} className="btn-primary text-sm">
                      {analysis ? "View analysis" : "Analyse trip"}
                    </Link>
                    <Link href={`/ai/chat?tripId=${trip.id}`} className="btn-ghost text-sm">
                      Chat
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Quick links */}
      <div>
        <h2 className="mb-3 font-semibold text-slate-700">Explore</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/ai/destinations" className="card hover:border-brand-200 transition group">
            <p className="font-semibold text-slate-800 group-hover:text-brand-700">🌍 Destination Explorer</p>
            <p className="text-sm text-slate-500 mt-0.5">Search destinations with natural language. &quot;Beach vacation under $1500&quot;</p>
          </Link>
          <Link href="/ai/chat" className="card hover:border-brand-200 transition group">
            <p className="font-semibold text-slate-800 group-hover:text-brand-700">💬 AI Travel Chat</p>
            <p className="text-sm text-slate-500 mt-0.5">Ask anything — budget advice, itinerary ideas, cost estimates.</p>
          </Link>
        </div>
      </div>
    </div>
  )
}
