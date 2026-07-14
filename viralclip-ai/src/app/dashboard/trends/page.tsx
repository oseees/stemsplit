import { getTrendCenter } from "@/lib/ai/trends";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TrendsPage() {
  await requireUser();
  let data;
  try {
    data = await getTrendCenter();
  } catch {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Trend Center</h1>
        <p className="mt-4 text-sm text-white/50">
          Couldn't load trends — check that AI_API_KEY is configured.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl animate-fade-up">
      <h1 className="text-2xl font-semibold tracking-tight">Trend Center</h1>
      <p className="mt-1 text-xs text-white/40">{data.disclaimer}</p>

      <section className="mt-6">
        <h2 className="mb-3 font-semibold">Content trends</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.trends.map((t, i) => (
            <div key={i} className="card p-4">
              <p className="font-medium">{t.title}</p>
              <p className="mt-1 text-sm text-white/55">{t.description}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mt-8 grid gap-6 sm:grid-cols-2">
        <div>
          <h2 className="mb-3 font-semibold">Popular hooks</h2>
          <ul className="space-y-1 text-sm text-white/60">
            {data.hooks.map((h, i) => <li key={i}>• {h}</li>)}
          </ul>
        </div>
        <div>
          <h2 className="mb-3 font-semibold">Viral title formulas</h2>
          <ul className="space-y-1 text-sm text-white/60">
            {data.titleFormulas.map((t, i) => <li key={i}>• {t}</li>)}
          </ul>
        </div>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 font-semibold">Trending content structures</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {data.structures.map((s, i) => (
            <div key={i} className="card p-4">
              <p className="font-medium">{s.name}</p>
              <ol className="mt-2 space-y-1 text-sm text-white/55">
                {s.steps.map((step, j) => <li key={j}>{j + 1}. {step}</li>)}
              </ol>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
