export default function BudgetBar({ spent, budget }: { spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : 0
  const over = spent > budget
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm text-slate-600">
        <span>Budget used</span>
        <span className={over ? "font-semibold text-red-600" : ""}>{pct.toFixed(0)}%</span>
      </div>
      <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${over ? "bg-red-500" : "bg-brand-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
