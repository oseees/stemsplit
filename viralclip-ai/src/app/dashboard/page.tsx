import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getUsage } from "@/lib/usage";
import { planFor } from "@/lib/plans";
import { StatCard } from "@/components/dashboard/stat-card";

export default async function DashboardHome() {
  const { userId, subscription } = await requireUser();
  const supabase = await createClient();
  const plan = planFor(subscription?.tier);

  const [uploads, clips, scores, usage] = await Promise.all([
    supabase.from("uploads").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("clips").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase.from("viral_scores").select("virality").eq("user_id", userId),
    getUsage(userId),
  ]);

  const scoreRows = (scores.data ?? []) as { virality: number }[];
  const avgVirality =
    scoreRows.length > 0
      ? Math.round(scoreRows.reduce((a, b) => a + b.virality, 0) / scoreRows.length)
      : 0;

  const uploadLimit = plan.uploadsPerMonth === Infinity ? "∞" : plan.uploadsPerMonth;

  return (
    <div className="mx-auto max-w-5xl animate-fade-up">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <Link href="/dashboard/upload" className="btn-primary">New upload</Link>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total uploads" value={uploads.count ?? 0} />
        <StatCard label="Clips created" value={clips.count ?? 0} />
        <StatCard
          label="Avg virality score"
          value={avgVirality || "—"}
          hint="Predicted, not guaranteed"
        />
        <StatCard
          label="Uploads this month"
          value={`${usage?.uploads ?? 0} / ${uploadLimit}`}
          hint={`${plan.name} plan`}
        />
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="font-semibold">Subscription</h2>
          <p className="mt-2 text-sm text-white/55">
            You're on the <strong className="text-white">{plan.name}</strong> plan.
          </p>
          <ul className="mt-3 space-y-1 text-sm text-white/50">
            {plan.features.map((f) => (
              <li key={f} className="flex gap-2">
                <span className="text-accent">✓</span> {f}
              </li>
            ))}
          </ul>
          <Link href="/dashboard/billing" className="btn-ghost mt-4">
            Manage billing
          </Link>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold">Get started</h2>
          <ol className="mt-3 space-y-2 text-sm text-white/55">
            <li>1. Upload a long-form video (MP4, MOV, AVI).</li>
            <li>2. Run AI analysis to detect your best moments.</li>
            <li>3. Review predicted scores and auto-cut clips.</li>
            <li>4. Generate hooks, titles, captions and narration.</li>
          </ol>
          <Link href="/dashboard/upload" className="btn-primary mt-4">
            Upload a video
          </Link>
        </div>
      </div>
    </div>
  );
}
