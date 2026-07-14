import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { tripSchema } from "@/lib/validations"

type Params = { params: Promise<{ id: string }> }

async function owned(userId: string, id: string) {
  const trip = await prisma.trip.findUnique({ where: { id } })
  return trip && trip.userId === userId ? trip : null
}

export async function GET(_req: Request, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  const trip = await owned(session.user.id, id)
  if (!trip) return NextResponse.json({ error: "Not found" }, { status: 404 })
  return NextResponse.json(trip)
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  if (!(await owned(session.user.id, id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json().catch(() => null)
  const parsed = tripSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const trip = await prisma.trip.update({ where: { id }, data: parsed.data })
  return NextResponse.json(trip)
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  if (!(await owned(session.user.id, id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.trip.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
