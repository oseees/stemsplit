import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { getAIProvider, checkRateLimit } from "@/lib/ai"

const schema = z.object({
  prompt: z.string().min(3).max(500),
  budget: z.coerce.number().positive(),
  currency: z.string().default("USD"),
})

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id

    const { prompt, budget, currency } = schema.parse(await req.json())

    checkRateLimit(userId)
    const ai = getAIProvider()
    const destinations = await ai.destinations(prompt, budget, currency)

    return NextResponse.json(destinations)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Destination search failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
