"use client"

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

export default function TimeChart({ data }: { data: { date: string; total: number }[] }) {
  if (data.length === 0)
    return <p className="py-12 text-center text-sm text-slate-400">No spending yet.</p>

  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
        <XAxis dataKey="date" fontSize={12} tickMargin={8} />
        <YAxis fontSize={12} />
        <Tooltip formatter={(v: number) => v.toLocaleString()} />
        <Line type="monotone" dataKey="total" stroke="#0ea5e9" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
