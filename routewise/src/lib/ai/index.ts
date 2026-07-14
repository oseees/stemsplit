import { anthropicProvider } from "./anthropic"
import type { AIProvider } from "./provider"

export function getAIProvider(): AIProvider {
  return anthropicProvider
}

// ponytail: in-memory rate limit — fine for single process dev; use DB counter or Redis for prod multi-instance
const rateMap = new Map<string, number[]>()
const LIMIT = 20
const WINDOW = 3_600_000 // 1 hour

export function checkRateLimit(userId: string): void {
  const now = Date.now()
  const calls = (rateMap.get(userId) ?? []).filter((t) => now - t < WINDOW)
  if (calls.length >= LIMIT) {
    throw new Error("Rate limit: 20 AI requests per hour. Please wait before trying again.")
  }
  rateMap.set(userId, [...calls, now])
}

export type { AIProvider }
export type { TripContext, TripAnalysisResult, ChatMessage, DestinationSuggestion } from "./types"
