"use client"

import { useState } from "react"

function parseMarkdown(text: string): string {
  return text
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-bold text-slate-800 mt-6 mb-2">$1</h2>')
    .replace(/^\*\*(.+?):\*\*/gm, '<strong class="text-slate-700">$1:</strong>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/^---$/gm, '<hr class="border-slate-200 my-4" />')
    .replace(/\n/g, "<br />")
}

export default function ItineraryStream({ tripId }: { tripId: string }) {
  const [text, setText] = useState("")
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState("")

  async function generate() {
    setText("")
    setDone(false)
    setError("")
    setLoading(true)

    try {
      const res = await fetch("/api/ai/itinerary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId }),
      })
      if (!res.ok) {
        const d = await res.json()
        throw new Error(d.error)
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done: streamDone, value } = await reader.read()
        if (streamDone) break
        setText((prev) => prev + decoder.decode(value))
      }
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate itinerary")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">AI Itinerary Generator</h3>
            <p className="text-sm text-slate-500 mt-0.5">Get a day-by-day plan with costs, restaurants, and transport.</p>
          </div>
          <button onClick={generate} disabled={loading} className="btn-primary">
            {loading ? "Generating…" : done ? "Regenerate" : "Generate itinerary"}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {(text || loading) && (
        <div className="card prose prose-sm max-w-none">
          {loading && !text && (
            <div className="space-y-3 animate-pulse">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-4 rounded bg-slate-100" style={{ width: `${70 + (i % 3) * 10}%` }} />
              ))}
            </div>
          )}
          <div
            className="text-sm leading-relaxed text-slate-700"
            dangerouslySetInnerHTML={{ __html: parseMarkdown(text) }}
          />
          {loading && text && (
            <span className="inline-block h-4 w-1 animate-pulse bg-brand-500 ml-0.5 align-middle" />
          )}
        </div>
      )}
    </div>
  )
}
