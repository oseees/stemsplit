import Link from "next/link";
import { PLANS } from "@/lib/plans";

const FEATURES = [
  { title: "AI clip detection", body: "Finds hook, emotional, high-energy, suspense, funny and educational moments — then cuts 15/30/60s clips." },
  { title: "Viral intelligence", body: "10 hooks, 20 titles, 5 caption styles, platform descriptions and hashtag groups per clip." },
  { title: "Predicted scores", body: "Virality, retention and engagement predictions with reasons and concrete improvements." },
  { title: "Retention analyzer", body: "Predicted drop-off points, weak/strong sections, and timeline recommendations." },
  { title: "AI narration", body: "Storytelling, documentary, educational, motivational and news scripts — editable, with optional TTS." },
  { title: "Competitor analyzer", body: "Paste a TikTok / Shorts / Reel URL to learn transferable, original strategies." },
];

export default function Landing() {
  return (
    <main className="mx-auto max-w-6xl px-5">
      <nav className="flex items-center justify-between py-5">
        <span className="text-lg font-semibold tracking-tight">
          ViralClip<span className="text-brand">AI</span>
        </span>
        <div className="flex items-center gap-3 text-sm">
          <Link href="/login" className="text-white/70 hover:text-white">Sign in</Link>
          <Link href="/signup" className="btn-primary">Get started</Link>
        </div>
      </nav>

      <section className="py-20 text-center animate-fade-up">
        <span className="rounded-full border border-bg-border bg-bg-card px-3 py-1 text-xs text-white/60">
          AI-powered short-form workflow
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-6xl">
          Turn long videos into{" "}
          <span className="bg-gradient-to-r from-brand to-accent bg-clip-text text-transparent">
            scroll-stopping shorts
          </span>
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-white/60">
          Upload once. ViralClip AI finds your best moments, scores their predicted
          performance, and writes the hooks, titles and captions to ship them.
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link href="/signup" className="btn-primary px-6 py-3">Start free</Link>
          <Link href="#pricing" className="btn-ghost px-6 py-3">See pricing</Link>
        </div>
        <p className="mt-4 text-xs text-white/40">
          Scores are predictions, not guarantees. Built for original, transformative content.
        </p>
      </section>

      <section className="grid gap-4 pb-20 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="card p-5">
            <h3 className="font-semibold">{f.title}</h3>
            <p className="mt-2 text-sm text-white/55">{f.body}</p>
          </div>
        ))}
      </section>

      <section id="pricing" className="pb-24">
        <h2 className="text-center text-2xl font-semibold">Simple pricing</h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {Object.values(PLANS).map((p) => (
            <div
              key={p.tier}
              className={`card p-6 ${p.tier === "pro" ? "ring-1 ring-brand" : ""}`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="text-lg font-semibold">{p.name}</h3>
                {p.tier === "pro" && (
                  <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs text-brand">
                    Popular
                  </span>
                )}
              </div>
              <p className="mt-2 text-3xl font-bold">{p.price}</p>
              <ul className="mt-5 space-y-2 text-sm text-white/60">
                {p.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span className="text-accent">✓</span> {f}
                  </li>
                ))}
              </ul>
              <Link href="/signup" className="btn-primary mt-6 w-full">
                {p.tier === "free" ? "Start free" : `Choose ${p.name}`}
              </Link>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-bg-border py-8 text-center text-xs text-white/40">
        © {new Date().getFullYear()} ViralClip AI. Predictions only — no guaranteed virality.
      </footer>
    </main>
  );
}
