"use client"

import { useState } from "react"
import type { TripAnalysisResult } from "@/lib/ai/types"
import { money } from "@/lib/utils"
import ItineraryStream from "./ItineraryStream"

type Tab = "overview" | "budget" | "recommendations" | "predictions" | "alternatives" | "itinerary" | "simulator"

const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "budget", label: "Budget" },
  { id: "recommendations", label: "Recommendations" },
  { id: "predictions", label: "Predictions" },
  { id: "alternatives", label: "Alternatives" },
  { id: "itinerary", label: "Itinerary" },
  { id: "simulator", label: "Simulator" },
]

const HEALTH_COLORS: Record<string, string> = {
  excellent: "bg-emerald-100 text-emerald-800",
  good: "bg-blue-100 text-blue-800",
  fair: "bg-amber-100 text-amber-800",
  poor: "bg-red-100 text-red-800",
}

const STATUS_COLOR: Record<string, string> = {
  under: "text-emerald-600",
  on_track: "text-blue-600",
  over: "text-red-600",
}

function ScoreDial({ score }: { score: number }) {
  const color = score >= 75 ? "#10b981" : score >= 50 ? "#3b82f6" : score >= 25 ? "#f59e0b" : "#ef4444"
  const circ = 2 * Math.PI * 40
  const dash = (score / 100) * circ
  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="40" fill="none" stroke="#e2e8f0" strokeWidth="10" />
        <circle
          cx="50" cy="50" r="40" fill="none"
          stroke={color} strokeWidth="10"
          strokeDasharray={`${dash} ${circ}`}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
      </svg>
      <span className="absolute text-2xl font-bold text-slate-800">{score}</span>
    </div>
  )
}

export default function TripAIClient({
  tripId,
  initialAnalysis,
  tripCurrency,
  tripBudget,
  tripTravelers,
}: {
  tripId: string
  initialAnalysis: TripAnalysisResult | null
  tripCurrency: string
  tripBudget: number
  tripTravelers: number
}) {
  const [tab, setTab] = useState<Tab>("overview")
  const [analysis, setAnalysis] = useState<TripAnalysisResult | null>(initialAnalysis)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // Simulator state
  const [simBudget, setSimBudget] = useState(tripBudget)
  const [simTravelers, setSimTravelers] = useState(tripTravelers)
  const [simResult, setSimResult] = useState<TripAnalysisResult | null>(null)
  const [simLoading, setSimLoading] = useState(false)

  async function analyze(opts?: { simulate?: boolean; budgetOverride?: number; travelersOverride?: number }) {
    const isSimulate = opts?.simulate ?? false
    if (isSimulate) setSimLoading(true)
    else { setLoading(true); setError("") }

    try {
      const res = await fetch("/api/ai/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tripId,
          simulate: isSimulate,
          budgetOverride: opts?.budgetOverride,
          travelersOverride: opts?.travelersOverride,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      if (isSimulate) setSimResult(data)
      else setAnalysis(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed")
    } finally {
      if (isSimulate) setSimLoading(false)
      else setLoading(false)
    }
  }

  return (
    <div>
      {/* Tabs */}
      <div className="mb-6 flex flex-wrap gap-1 border-b border-slate-200 pb-0">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg -mb-px transition ${
              tab === t.id
                ? "bg-white border border-b-white border-slate-200 text-brand-700"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === "overview" && (
        <div className="space-y-4">
          {!analysis ? (
            <div className="card flex flex-col items-center gap-4 py-10 text-center">
              <div className="text-4xl">🧠</div>
              <p className="text-slate-600">No analysis yet. Run AI analysis to get budget health, recommendations, and predictions.</p>
              <button onClick={() => analyze()} disabled={loading} className="btn-primary">
                {loading ? "Analysing…" : "Analyse my trip"}
              </button>
              {error && <p className="text-sm text-red-600">{error}</p>}
            </div>
          ) : (
            <>
              <div className="card flex flex-wrap items-center gap-6">
                <ScoreDial score={analysis.score} />
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className={`rounded-full px-3 py-0.5 text-sm font-medium capitalize ${HEALTH_COLORS[analysis.health] ?? "bg-slate-100 text-slate-700"}`}>
                      {analysis.health}
                    </span>
                    <span className="text-sm text-slate-500">Budget health score</span>
                  </div>
                  <p className="text-slate-700">{analysis.summary}</p>
                  <div className="mt-3 flex flex-wrap gap-4 text-sm">
                    <span className="text-slate-500">Projected total: <strong className="text-slate-800">{money(analysis.projectedTotal, tripCurrency)}</strong></span>
                    <span className="text-emerald-700">Potential savings: <strong>{money(analysis.potentialSavings, tripCurrency)}</strong></span>
                  </div>
                </div>
                <button onClick={() => analyze()} disabled={loading} className="btn-ghost text-sm">
                  {loading ? "…" : "Refresh"}
                </button>
              </div>

              {analysis.notifications.length > 0 && (
                <div className="space-y-2">
                  {analysis.notifications.map((n, i) => (
                    <div key={i} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                      ⚠️ {n}
                    </div>
                  ))}
                </div>
              )}
              {error && <p className="text-sm text-red-600">{error}</p>}
            </>
          )}
        </div>
      )}

      {/* Budget */}
      {tab === "budget" && (
        <div className="space-y-3">
          {!analysis ? (
            <div className="card text-center text-slate-500 py-8">
              <button onClick={() => { setTab("overview"); }} className="btn-primary">Run analysis first</button>
            </div>
          ) : analysis.categories.map((c, i) => (
            <div key={i} className="card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className="font-medium text-slate-800">{c.category}</span>
                  {c.note && <p className="text-xs text-slate-500 mt-0.5">{c.note}</p>}
                </div>
                <span className={`text-sm font-medium capitalize ${STATUS_COLOR[c.status]}`}>{c.status.replace("_", " ")}</span>
              </div>
              <div className="mt-2 flex gap-4 text-sm text-slate-600">
                <span>Estimated: {money(c.estimated, tripCurrency)}</span>
                <span>Actual: {money(c.actual, tripCurrency)}</span>
              </div>
              <div className="mt-2 h-2 rounded-full bg-slate-100">
                <div
                  className={`h-2 rounded-full transition-all ${c.status === "over" ? "bg-red-400" : c.status === "on_track" ? "bg-blue-400" : "bg-emerald-400"}`}
                  style={{ width: `${Math.min(c.percentage, 100)}%` }}
                />
              </div>
              <p className="mt-1 text-xs text-slate-400">{c.percentage}% of budget</p>
            </div>
          ))}
        </div>
      )}

      {/* Recommendations */}
      {tab === "recommendations" && (
        <div className="space-y-3">
          {!analysis ? (
            <div className="card text-center py-8"><button onClick={() => setTab("overview")} className="btn-primary">Run analysis first</button></div>
          ) : analysis.recommendations.length === 0 ? (
            <div className="card text-center text-slate-500 py-8">No recommendations — your budget looks great!</div>
          ) : analysis.recommendations.sort((a, b) => b.priority - a.priority).map((r, i) => (
            <div key={i} className="card">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700 capitalize">{r.type}</span>
                    <span className="text-xs text-slate-400">Priority {r.priority}/5</span>
                  </div>
                  <p className="font-medium text-slate-800">{r.title}</p>
                  <p className="mt-1 text-sm text-slate-600">{r.reasoning}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-bold text-emerald-600">+{money(r.savings, tripCurrency)}</p>
                  <p className="text-xs text-slate-400">{Math.round(r.confidence * 100)}% confident</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Predictions */}
      {tab === "predictions" && (
        <div className="space-y-3">
          {!analysis ? (
            <div className="card text-center py-8"><button onClick={() => setTab("overview")} className="btn-primary">Run analysis first</button></div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                {(["food", "transport", "activities", "shopping", "emergency"] as const).map((k) => (
                  <div key={k} className="card">
                    <p className="text-sm text-slate-500 capitalize">{k}</p>
                    <p className="text-xl font-bold text-slate-800">{money(analysis.predictions[k], analysis.predictions.currency)}</p>
                  </div>
                ))}
              </div>
              <div className="card border-brand-200 bg-brand-50">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-brand-800">Predicted total spend</span>
                  <span className="text-xl font-bold text-brand-700">{money(analysis.predictions.total, analysis.predictions.currency)}</span>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Alternatives */}
      {tab === "alternatives" && (
        <div className="space-y-3">
          {!analysis ? (
            <div className="card text-center py-8"><button onClick={() => setTab("overview")} className="btn-primary">Run analysis first</button></div>
          ) : analysis.alternativeDestinations.length === 0 ? (
            <div className="card text-center text-slate-500 py-8">No alternatives suggested — your destination fits the budget well!</div>
          ) : analysis.alternativeDestinations.map((d, i) => (
            <div key={i} className="card">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-slate-800">{d.name}, {d.country}</p>
                  <p className="text-sm text-slate-500">{d.weather}</p>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {d.highlights.map((h, j) => (
                      <span key={j} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{h}</span>
                    ))}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-bold text-slate-800">{money(d.estimatedCost, d.currency)}</p>
                  {d.savings > 0 && <p className="text-sm text-emerald-600">Save {money(d.savings, d.currency)}</p>}
                  <span className={`text-xs capitalize ${d.popularity === "high" ? "text-red-500" : d.popularity === "medium" ? "text-amber-500" : "text-emerald-500"}`}>
                    {d.popularity} popularity
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Itinerary */}
      {tab === "itinerary" && (
        <ItineraryStream tripId={tripId} />
      )}

      {/* Simulator */}
      {tab === "simulator" && (
        <div className="space-y-4">
          <div className="card">
            <h3 className="font-semibold text-slate-800 mb-4">Budget Simulator</h3>
            <p className="text-sm text-slate-500 mb-6">Adjust parameters and see how your budget health changes without saving.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="label">Budget ({tripCurrency})</label>
                <input type="number" value={simBudget} onChange={(e) => setSimBudget(Number(e.target.value))} className="field" min={100} step={100} />
              </div>
              <div>
                <label className="label">Travellers</label>
                <input type="number" value={simTravelers} onChange={(e) => setSimTravelers(Number(e.target.value))} className="field" min={1} max={20} />
              </div>
            </div>
            <button
              onClick={() => analyze({ simulate: true, budgetOverride: simBudget, travelersOverride: simTravelers })}
              disabled={simLoading}
              className="btn-primary mt-4"
            >
              {simLoading ? "Simulating…" : "Run simulation"}
            </button>
          </div>

          {simResult && (
            <div className="card space-y-4">
              <h4 className="font-semibold text-slate-700">Simulation result</h4>
              <div className="flex items-center gap-6">
                <ScoreDial score={simResult.score} />
                <div>
                  <span className={`rounded-full px-3 py-0.5 text-sm font-medium capitalize ${HEALTH_COLORS[simResult.health] ?? "bg-slate-100 text-slate-700"}`}>
                    {simResult.health}
                  </span>
                  <p className="mt-2 text-slate-600 text-sm">{simResult.summary}</p>
                  <p className="mt-1 text-sm">
                    Projected: <strong>{money(simResult.projectedTotal, tripCurrency)}</strong>
                    {" · "}Savings potential: <strong className="text-emerald-600">{money(simResult.potentialSavings, tripCurrency)}</strong>
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
