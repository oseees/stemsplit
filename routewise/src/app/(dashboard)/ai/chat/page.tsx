import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import Link from "next/link"
import ChatInterface from "@/components/ai/ChatInterface"

export default async function AIChatPage({
  searchParams,
}: {
  searchParams: Promise<{ tripId?: string }>
}) {
  const { tripId } = await searchParams
  const session = await auth()
  const userId = session!.user.id

  let tripLabel: string | undefined
  if (tripId) {
    const trip = await prisma.trip.findFirst({
      where: { id: tripId, userId },
      select: { departureCity: true, destination: true },
    })
    if (trip) tripLabel = `${trip.departureCity} → ${trip.destination}`
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/ai" className="text-sm text-slate-500 hover:text-brand-700">← AI Dashboard</Link>
          <h1 className="text-2xl font-bold text-slate-900 mt-1">AI Travel Chat</h1>
        </div>
      </div>

      <div className="card">
        <ChatInterface tripId={tripId} tripLabel={tripLabel} />
      </div>
    </div>
  )
}
