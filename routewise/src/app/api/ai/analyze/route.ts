import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getAIProvider, checkRateLimit } from "@/lib/ai"
import { buildTripContext } from "@/lib/ai/context"

const schema = z.object({
  tripId: z.string().min(1),
  // Optional simulator overrides — if provided, result is not persisted
  budgetOverride: z.coerce.number().positive().optional(),
  travelersOverride: z.coerce.number().int().positive().optional(),
  simulate: z.coerce.boolean().optional(),
})

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id

    const body = await req.json()
    const { tripId, budgetOverride, travelersOverride, simulate } = schema.parse(body)

    const ctx = await buildTripContext(tripId, userId)
    if (!ctx) return NextResponse.json({ error: "Trip not found" }, { status: 404 })

    if (budgetOverride) ctx.budget = budgetOverride
    if (travelersOverride) ctx.travelers = travelersOverride

    checkRateLimit(userId)
    const ai = getAIProvider()
    const result = await ai.analyze(ctx)

    if (!simulate) {
      // Persist analysis + upsert recommendations
      await prisma.tripAnalysis.upsert({
        where: { tripId },
        create: { tripId, score: result.score, health: result.health, analysis: result as object },
        update: { score: result.score, health: result.health, analysis: result as object },
      })

      // Replace recommendations
      await prisma.aIRecommendation.deleteMany({ where: { tripId } })
      if (result.recommendations.length > 0) {
        await prisma.aIRecommendation.createMany({
          data: result.recommendations.map((r) => ({
            tripId,
            type: r.type,
            title: r.title,
            savings: r.savings,
            confidence: r.confidence,
            reasoning: r.reasoning,
            priority: r.priority,
          })),
        })
      }
    }

    return NextResponse.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : "AI analysis failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
