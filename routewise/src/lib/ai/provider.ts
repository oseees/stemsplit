import type { TripContext, TripAnalysisResult, ChatMessage, DestinationSuggestion } from "./types"

export interface AIProvider {
  readonly name: string
  analyze(ctx: TripContext): Promise<TripAnalysisResult>
  chatStream(messages: ChatMessage[], ctx: TripContext | null): ReadableStream<Uint8Array>
  itineraryStream(ctx: TripContext): ReadableStream<Uint8Array>
  destinations(prompt: string, budget: number, currency: string): Promise<DestinationSuggestion[]>
}
