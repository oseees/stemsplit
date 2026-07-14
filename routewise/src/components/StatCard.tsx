export default function StatCard({
  label,
  value,
  hint,
  accent,
}: {
  label: string
  value: string
  hint?: string
  accent?: boolean
}) {
  return (
    <div className={`card ${accent ? "bg-brand-600 text-white" : ""}`}>
      <p className={`text-sm ${accent ? "text-brand-100" : "text-slate-500"}`}>{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
      {hint && (
        <p className={`mt-1 text-xs ${accent ? "text-brand-100" : "text-slate-400"}`}>{hint}</p>
      )}
    </div>
  )
}
