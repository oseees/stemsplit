import { NextResponse } from "next/server"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { flightQuoteToOffer } from "@/lib/quotes"

// GET /api/flights/compare?ids=a,b,c — up to 3 previously-searched flight quotes.
export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const ids = (new URL(req.url).searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 3)
  if (ids.length < 2) {
    return NextResponse.json({ error: "Select 2–3 flights to compare" }, { status: 400 })
  }

  const quotes = await prisma.flightQuote.findMany({ where: { id: { in: ids } } })
  // Preserve the requested order.
  const offers = ids
    .map((id) => quotes.find((q) => q.id === id))
    .filter((q): q is (typeof quotes)[number] => Boolean(q))
    .map(flightQuoteToOffer)
  return NextResponse.json({ offers })
}
