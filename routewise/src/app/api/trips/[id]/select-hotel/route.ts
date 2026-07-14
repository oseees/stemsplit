import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { selectHotelSchema } from "@/lib/validations"
import { persistHotelOffers } from "@/lib/quotes"
import { tripEstimate } from "@/lib/travel/tripBudget"
import type { HotelOffer } from "@/lib/providers/types"

type Params = { params: Promise<{ id: string }> }

export async function POST(req: Request, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await params
  const trip = await prisma.trip.findFirst({ where: { id, userId: session.user.id } })
  if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = selectHotelSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }

  const { city, ...rest } = parsed.data
  const offer: HotelOffer = { ...rest, id: "" }
  const [saved] = await persistHotelOffers([offer], city || rest.name)
  await prisma.selectedHotel.upsert({
    where: { tripId: id },
    update: { quoteId: saved.id, price: saved.totalPrice, currency: saved.currency },
    create: { tripId: id, quoteId: saved.id, price: saved.totalPrice, currency: saved.currency },
  })

  return NextResponse.json({ ok: true, estimate: await tripEstimate(id) })
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const trip = await prisma.trip.findFirst({ where: { id, userId: session.user.id } })
  if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.selectedHotel.deleteMany({ where: { tripId: id } })
  return NextResponse.json({ ok: true, estimate: await tripEstimate(id) })
}
