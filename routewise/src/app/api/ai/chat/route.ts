import { NextResponse } from "next/server"
import { z } from "zod"
import { auth } from "@/lib/auth"
import { prisma } from "@/lib/prisma"
import { getAIProvider, checkRateLimit } from "@/lib/ai"
import { buildTripContext } from "@/lib/ai/context"

const schema = z.object({
  message: z.string().min(1).max(2000),
  conversationId: z.string().optional(),
  tripId: z.string().optional(),
})

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id

    const body = await req.json()
    const { message, conversationId, tripId } = schema.parse(body)

    checkRateLimit(userId)

    // Get or create conversation
    let conv = conversationId
      ? await prisma.conversation.findFirst({ where: { id: conversationId, userId }, include: { messages: { orderBy: { createdAt: "asc" } } } })
      : null

    if (!conv) {
      conv = await prisma.conversation.create({
        data: { userId, tripId: tripId ?? null, title: message.slice(0, 60) },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      })
    }

    // Save user message
    await prisma.conversationMessage.create({
      data: { conversationId: conv.id, role: "user", content: message },
    })

    // Build history for AI (last 20 messages to stay within context)
    const history = conv.messages.slice(-20).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
    history.push({ role: "user", content: message })

    // Build trip context if linked
    const ctx = tripId ? await buildTripContext(tripId, userId) : null

    const ai = getAIProvider()
    const stream = ai.chatStream(history, ctx)

    // Collect full response to persist after streaming
    let fullResponse = ""
    const encoder = new TextEncoder()
    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        // Send conversationId first so the client can track it
        const meta = JSON.stringify({ conversationId: conv!.id }) + "\n\x00\n"
        controller.enqueue(encoder.encode(meta))

        const reader = stream.getReader()
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const text = new TextDecoder().decode(value)
          fullResponse += text
          controller.enqueue(value)
        }
        controller.close()

        // Persist assistant response
        await prisma.conversationMessage.create({
          data: { conversationId: conv!.id, role: "assistant", content: fullResponse },
        })
      },
    })

    return new Response(readable, {
      headers: { "Content-Type": "text/plain; charset=utf-8", "X-Conversation-Id": conv.id },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Chat failed"
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    const userId = session.user.id

    const url = new URL(req.url)
    const conversationId = url.searchParams.get("conversationId")

    if (conversationId) {
      const conv = await prisma.conversation.findFirst({
        where: { id: conversationId, userId },
        include: { messages: { orderBy: { createdAt: "asc" } } },
      })
      return NextResponse.json(conv ?? null)
    }

    const conversations = await prisma.conversation.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, title: true, tripId: true, createdAt: true },
    })
    return NextResponse.json(conversations)
  } catch {
    return NextResponse.json({ error: "Failed" }, { status: 500 })
  }
}
