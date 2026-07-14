"use client"

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts"
import { CATEGORY_COLORS } from "@/lib/utils"

export default function CategoryChart({
  data,
}: {
  data: { category: string; total: number }[]
}) {
  if (data.length === 0)
    return <p className="py-12 text-center text-sm text-slate-400">No spending yet.</p>

  return (
    <ResponsiveContainer width="100%" height={280}>
      <PieChart>
        <Pie data={data} dataKey="total" nameKey="category" innerRadius={55} outerRadius={95}>
          {data.map((d) => (
            <Cell key={d.category} fill={CATEGORY_COLORS[d.category] ?? "#64748b"} />
          ))}
        </Pie>
        <Tooltip formatter={(v: number) => v.toLocaleString()} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  )
}
