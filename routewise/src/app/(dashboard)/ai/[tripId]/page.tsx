import Link from "next/link"
import { notFound } from "next/navigation"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import TripAIClient from "@/components/ai/TripAIClient"
import type { TripAnalysisResult } from "@/lib/ai/types"

export default async function TripAIPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params
  const session = await auth()
  const userId = session!.user.id

  const trip = await prisma.trip.findFirst({
    where: { id: tripId, userId },
    include: { analysis: true },
  })
  if (!trip) notFound()

  const existingAnalysis = trip.analysis?.analysis as TripAnalysisResult | null

  return (
    <div className="space-y-6">
      <div>
        <Link href="/ai" className="text-sm text-slate-500 hover:text-brand-700">← AI Dashboard</Link>
        <div className="mt-2 flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {trip.departureCity} → {trip.destination}
            </h1>
            <p className="text-slate-500">
              {trip.startDate.toLocaleDateString()} – {trip.endDate.toLocaleDateString()} ·{" "}
              {trip.travelers} traveller{trip.travelers > 1 ? "s" : ""} · {trip.currency} {trip.budget.toLocaleString()}
            </p>
          </div>
          <Link href={`/ai/chat?tripId=${tripId}`} className="btn-ghost text-sm shrink-0">
            Chat about this trip
          </Link>
        </div>
      </div>

      <TripAIClient
        tripId={tripId}
        initialAnalysis={existingAnalysis}
        tripCurrency={trip.currency}
        tripBudget={trip.budget}
        tripTravelers={trip.travelers}
      />
    </div>
  )
}
