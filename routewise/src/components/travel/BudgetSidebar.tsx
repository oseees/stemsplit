"use client"

import { estimate, budgetWarning } from "@/lib/travel/budget"
import { money } from "@/lib/utils"
import type { TripBudgetInfo } from "@/lib/travel/tripBudget"

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex justify-between text-sm">
      <span className={muted ? "text-slate-400" : "text-slate-500"}>{label}</span>
      <span className={muted ? "text-slate-400" : "font-medium text-slate-700"}>{value}</span>
    </div>
  )
}

export default function BudgetSidebar({
  trip,
  preview,
  kind,
}: {
  trip: TripBudgetInfo
  preview?: { flight?: number; hotel?: number }
  kind: "flight" | "hotel"
}) {
  const flight = preview?.flight ?? trip.flightCost
  const hotel = preview?.hotel ?? trip.hotelCost
  const est = estimate({
    budget: trip.budget,
    currency: trip.currency,
    flight,
    hotel,
    expenses: trip.expensesTotal,
  })
  const warn = budgetWarning(est.remaining, trip.currency, kind)
  const previewing = preview?.flight != null || preview?.hotel != null
  const over = est.remaining < 0

  return (
    <div className="card sticky top-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Budget</h3>
        {previewing && (
          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-700">preview</span>
        )}
      </div>
      <p className="text-xs text-slate-400">{trip.label}</p>

      <Row label="Total budget" value={money(est.budget, trip.currency)} />
      <Row
        label="Flight"
        value={money(est.flight, trip.currency)}
        muted={kind === "flight" && preview?.flight == null && trip.flightCost === 0}
      />
      <Row
        label="Hotel"
        value={money(est.hotel, trip.currency)}
        muted={kind === "hotel" && preview?.hotel == null && trip.hotelCost === 0}
      />
      <Row label="Other expenses" value={money(est.expenses, trip.currency)} />

      <div className="border-t border-slate-100 pt-3">
        <div className="mb-1 flex justify-between">
          <span className="text-sm font-medium text-slate-600">Remaining</span>
          <span className={`text-lg font-bold ${over ? "text-red-600" : "text-brand-700"}`}>
            {money(est.remaining, trip.currency)}
          </span>
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className={`h-full rounded-full transition-all ${over ? "bg-red-500" : "bg-brand-500"}`}
            style={{ width: `${est.usedPct}%` }}
          />
        </div>
      </div>

      {warn && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-700">{warn.message}</p>
          <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-red-600">
            {warn.suggestions.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
