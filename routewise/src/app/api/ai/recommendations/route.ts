import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"

export async function GET(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id

    const url = new URL(req.url)
    const tripId = url.searchParams.get("tripId")

    const where = tripId
      ? { tripId, trip: { userId } }
      : { trip: { userId } }

    const recs = await prisma.aIRecommendation.findMany({
      where,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
    })
    return NextResponse.json(recs)
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id

    const { id, dismissed } = await req.json()
    const rec = await prisma.aIRecommendation.findFirst({ where: { id, trip: { userId } } })
    if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const updated = await prisma.aIRecommendation.update({ where: { id }, data: { dismissed } })
    return NextResponse.json(updated)
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
