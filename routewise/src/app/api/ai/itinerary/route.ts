import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getAIProvider, checkRateLimit } from "@/lib/ai"
import { buildTripContext } from "@/lib/ai/context"

const schema = z.object({ tripId: z.string().min(1) })

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id

    const { tripId } = schema.parse(await req.json())
    const ctx = await buildTripContext(tripId, userId)
    if (!ctx) return NextResponse.json({ error: "Trip not found" }, { status: 404 })

    checkRateLimit(userId)
    const ai = getAIProvider()
    const stream = ai.itineraryStream(ctx)

    return new Response(stream, {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Itinerary generation failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
