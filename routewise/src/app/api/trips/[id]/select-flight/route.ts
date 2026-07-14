import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { selectFlightSchema } from "@/lib/validations"
import { persistFlightOffers } from "@/lib/quotes"
import { tripEstimate } from "@/lib/travel/tripBudget"
import type { Cabin, FlightOffer } from "@/lib/providers/types"

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const trip = await prisma.trip.findFirst({ where: { id, userId: session.user.id } })
  if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = selectFlightSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const offer: FlightOffer = { ...parsed.data, id: "", cabin: parsed.data.cabin as Cabin }
  const [saved] = await persistFlightOffers([offer])
  await prisma.selectedFlight.upsert({
    where: { tripId: id },
    update: { quoteId: saved.id, price: saved.price, currency: saved.currency },
    create: { tripId: id, quoteId: saved.id, price: saved.price, currency: saved.currency },
  })

  return NextResponse.json({ ok: true, estimate: await tripEstimate(id) })
}

// Remove the selected flight (frees its budget).
export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const trip = await prisma.trip.findFirst({ where: { id, userId: session.user.id } })
  if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.selectedFlight.deleteMany({ where: { tripId: id } })
  return NextResponse.json({ ok: true, estimate: await tripEstimate(id) })
}
