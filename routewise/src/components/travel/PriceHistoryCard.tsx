"use client"

import { ResponsiveContainer, LineChart, Line, YAxis, Tooltip } from "recharts"
import type { PriceHistorySummary } from "@/lib/providers/types"
import { money } from "@/lib/utils"

export default function PriceHistoryCard({ history }: { history: PriceHistorySummary }) {
  const book = history.recommendation === "book"
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Price history</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            book ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          {book ? "Book now" : "Wait"}
        </span>
      </div>

      <div className="h-16">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history.points}>
            <YAxis hide domain={["dataMin", "dataMax"]} />
            <Tooltip
              formatter={(v: number) => money(v, history.currency)}
              labelFormatter={() => ""}
            />
            <Line
              type="monotone"
              dataKey="price"
              stroke={book ? "#10b981" : "#f59e0b"}
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-sm">
        <div>
          <p className="text-xs text-slate-400">Lowest</p>
          <p className="font-semibold">{money(history.lowest, history.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Average</p>
          <p className="font-semibold">{money(history.average, history.currency)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Current</p>
          <p className="font-semibold text-brand-700">{money(history.current, history.currency)}</p>
        </div>
      </div>
      <p className="text-xs text-slate-500">{history.reason}</p>
    </div>
  )
}
