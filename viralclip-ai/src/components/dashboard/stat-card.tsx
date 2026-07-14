export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="card p-5">
      <p className="text-sm text-white/50">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight">{value}</p>
      {hint && <p className="mt-1 text-xs text-white/40">{hint}</p>}
    </div>
  );
}

export function ScoreRing({
  value,
  label,
}: {
  value: number;
  label: string;
}) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const dash = (value / 100) * c;
  const color = value >= 70 ? "#19d3a2" : value >= 40 ? "#f5a623" : "#ff5d5d";
  return (
    <div className="flex flex-col items-center">
      <svg width="72" height="72" className="-rotate-90">
        <circle cx="36" cy="36" r={r} fill="none" stroke="#23232f" strokeWidth="6" />
        <circle
          cx="36"
          cy="36"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
        />
      </svg>
      <span className="-mt-12 text-lg font-semibold">{value}</span>
      <span className="mt-6 text-xs text-white/50">{label}</span>
    </div>
  );
}
