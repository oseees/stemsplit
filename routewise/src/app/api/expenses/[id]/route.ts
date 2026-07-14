import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { expenseSchema } from "@/lib/validations"

type Params = { params: Promise<{ id: string }> }

// Returns the expense only if it belongs to a trip owned by the user.
async function owned(userId: string, id: string) {
  const expense = await prisma.expense.findUnique({ where: { id }, include: { trip: true } })
  return expense && expense.trip.userId === userId ? expense : null
}

export async function PATCH(req: Request, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  if (!(await owned(session.user.id, id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 })

  const body = await req.json().catch(() => null)
  const parsed = expenseSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
  }
  const { notes, ...rest } = parsed.data
  const expense = await prisma.expense.update({
    where: { id },
    data: { ...rest, notes: notes || null },
  })
  return NextResponse.json(expense)
}

export async function DELETE(_req: Request, { params }: Params) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  const { id } = await params
  if (!(await owned(session.user.id, id)))
    return NextResponse.json({ error: "Not found" }, { status: 404 })

  await prisma.expense.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
