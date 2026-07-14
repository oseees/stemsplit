"use client"

import { useState } from "react"
import type { DestinationSuggestion } from "@/lib/ai/types"
import { money } from "@/lib/utils"

const EXAMPLES = [
  "Beach vacation under $1500",
  "Romantic Europe trip for $3000",
  "Cheap Asian destinations",
  "Family trip in December",
  "Luxury vacation for $5000",
]

export default function DestinationSearch() {
  const [prompt, setPrompt] = useState("")
  const [budget, setBudget] = useState(2000)
  const [currency, setCurrency] = useState("USD")
  const [results, setResults] = useState<DestinationSuggestion[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  async function search() {
    if (!prompt.trim()) return
    setLoading(true)
    setError("")
    try {
      const res = await fetch("/api/ai/destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, budget, currency }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setResults(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed")
    } finally {
      setLoading(false)
    }
  }

  const popularityColor = { low: "text-emerald-600", medium: "text-amber-600", high: "text-red-600" }

  return (
    <div className="space-y-6">
      <div className="card space-y-4">
        <div>
          <label className="label">Describe your ideal trip</label>
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="e.g. Beach vacation under $2000, romantic Europe trip…"
            className="field"
          />
        </div>
        <div className="flex gap-3">
          <div className="flex-1">
            <label className="label">Budget</label>
            <input type="number" value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="field" min={100} step={100} />
          </div>
          <div className="w-28">
            <label className="label">Currency</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="field">
              {["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "NGN"].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Quick examples */}
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => setPrompt(ex)}
              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-brand-300 hover:text-brand-700 transition"
            >
              {ex}
            </button>
          ))}
        </div>

        <button onClick={search} disabled={loading || !prompt.trim()} className="btn-primary">
          {loading ? "Searching…" : "Find destinations"}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>

      {loading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card animate-pulse space-y-3">
              <div className="h-5 w-2/3 rounded bg-slate-100" />
              <div className="h-3 w-1/2 rounded bg-slate-100" />
              <div className="h-6 w-1/3 rounded bg-slate-100" />
            </div>
          ))}
        </div>
      )}

      {results.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.map((d, i) => (
            <div key={i} className="card hover:border-brand-200 transition">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="font-semibold text-slate-800">{d.name}</p>
                  <p className="text-sm text-slate-500">{d.country}</p>
                </div>
                <span className={`text-xs font-medium capitalize ${popularityColor[d.popularity]}`}>
                  {d.popularity}
                </span>
              </div>
              <p className="text-xl font-bold text-slate-800 mb-1">{money(d.estimatedCost, d.currency)}</p>
              {d.savings > 0 && (
                <p className="text-sm text-emerald-600 mb-2">Save {money(d.savings, d.currency)} vs your budget</p>
              )}
              <p className="text-xs text-slate-500 mb-2">🌤 {d.weather}</p>
              <div className="flex flex-wrap gap-1">
                {d.highlights.map((h, j) => (
                  <span key={j} className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">{h}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
