import Anthropic from "@anthropic-ai/sdk"
import type { AIProvider } from "./provider"
import type { TripContext, TripAnalysisResult, ChatMessage, DestinationSuggestion } from "./types"
import { ANALYZE_PROMPT, CHAT_SYSTEM_PROMPT, ITINERARY_PROMPT, DESTINATIONS_PROMPT } from "./prompts"

const MODEL = "claude-opus-4-8"

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
}

function formatCtx(ctx: TripContext): string {
  const nights = ctx.nightsCount
  const spent = ctx.expenses.reduce((s, e) => s + e.amount, 0)
  const flight = ctx.selectedFlight
    ? `${ctx.selectedFlight.airline} — ${ctx.selectedFlight.price} ${ctx.selectedFlight.currency}`
    : "not selected"
  const hotel = ctx.selectedHotel
    ? `${ctx.selectedHotel.name} — ${ctx.selectedHotel.price} ${ctx.selectedHotel.currency} (${ctx.selectedHotel.nights} nights)`
    : "not selected"
  const expenseList = ctx.expenses.length
    ? ctx.expenses.map((e) => `${e.category}: ${e.amount} ${ctx.currency}`).join(", ")
    : "none logged yet"
  return [
    `${ctx.departureCity} → ${ctx.destination}`,
    `${ctx.startDate} to ${ctx.endDate} (${nights} night${nights !== 1 ? "s" : ""})`,
    `${ctx.travelers} traveller(s)`,
    `Budget: ${ctx.budget} ${ctx.currency}`,
    `Spent so far: ${spent} ${ctx.currency}`,
    `Flight: ${flight}`,
    `Hotel: ${hotel}`,
    `Expenses: ${expenseList}`,
  ].join(" | ")
}

export const anthropicProvider: AIProvider = {
  name: "anthropic",

  async analyze(ctx) {
    const client = getClient()
    const prompt = ANALYZE_PROMPT.replace("{context}", formatCtx(ctx))
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{ role: "user", content: prompt }],
    })
    const text = (msg.content[0] as { text: string }).text
    // Strip any accidental markdown fences the model might add
    const json = text.replace(/^```[\w]*\n?/m, "").replace(/\n?```$/m, "").trim()
    return JSON.parse(json) as TripAnalysisResult
  },

  chatStream(messages, ctx) {
    const client = getClient()
    const system = ctx
      ? CHAT_SYSTEM_PROMPT.replace("{context}", formatCtx(ctx))
      : "You are RouteWise AI, a helpful travel budget assistant. Be concise and practical."

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 1024,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    })

    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(chunk.delta.text))
          }
        }
        controller.close()
      },
    })
  },

  itineraryStream(ctx) {
    const client = getClient()
    const prompt = ITINERARY_PROMPT.replace("{destination}", ctx.destination)
      .replace("{nights}", String(ctx.nightsCount))
      .replace("{startDate}", ctx.startDate)
      .replace("{travelers}", String(ctx.travelers))
      .replace("{budget}", `${ctx.budget} ${ctx.currency}`)

    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    })

    const encoder = new TextEncoder()
    return new ReadableStream<Uint8Array>({
      async start(controller) {
        for await (const chunk of stream) {
          if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(chunk.delta.text))
          }
        }
        controller.close()
      },
    })
  },

  async destinations(prompt, budget, currency) {
    const client = getClient()
    const content = DESTINATIONS_PROMPT.replace("{prompt}", prompt).replace(
      "{budget}",
      `${budget} ${currency}`
    )
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      messages: [{ role: "user", content }],
    })
    const text = (msg.content[0] as { text: string }).text
    const json = text.replace(/^```[\w]*\n?/m, "").replace(/\n?```$/m, "").trim()
    return JSON.parse(json) as DestinationSuggestion[]
  },
}
