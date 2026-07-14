import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { expenseSchema } from "@/lib/validations"

// GET /api/expenses?tripId=... — expenses for one owned trip
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const tripId = new URL(req.url).searchParams.get("tripId")
  if (!tripId) return NextResponse.json({ error: "tripId required" }, { status: 400 })

  const trip = await prisma.trip.findUnique({ where: { id: tripId } })
  if (!trip || trip.userId !== session.user.id)
    return NextResponse.json({ error: "Not found" }, { status: 404 })

  const expenses = await prisma.expense.findMany({
    where: { tripId },
    orderBy: { date: "desc" },
  })
  return NextResponse.json(expenses)
}

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json().catch(() => null)
  const tripId = body?.tripId as string | undefined
  if (!tripId) return NextResponse.json({ error: "tripId required" }, { status: 400 })

  const trip = await prisma.trip.findUnique({ where: { id: tripId } })
  if (!trip || trip.userId !== session.user.id)
    return NextResponse.json({ error: "Not found" }, { status: 404 })

  const parsed = expenseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { notes, ...rest } = parsed.data
  const expense = await prisma.expense.create({
    data: { ...rest, notes: notes || null, tripId },
  })
  return NextResponse.json(expense, { status: 201 })
}
