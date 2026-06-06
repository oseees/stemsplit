import Link from "next/link";
import { ArrowRight, Music, Mic2, Drum, Waves, Zap, Shield, Clock, Check } from "lucide-react";

const stems = [
  { icon: Mic2, label: "Vocals", color: "from-purple-500 to-pink-500", desc: "Isolate lead vocals and harmonies" },
  { icon: Drum, label: "Drums", color: "from-orange-500 to-red-500", desc: "Extract drum patterns and percussion" },
  { icon: Waves, label: "Bass", color: "from-blue-500 to-cyan-500", desc: "Separate bass lines and low-end" },
  { icon: Music, label: "Other", color: "from-green-500 to-emerald-500", desc: "Guitars, keys, synths, and more" },
];

const features = [
  { icon: Zap, title: "Lightning Fast", desc: "Powered by Meta's Demucs model — professional grade separation in seconds." },
  { icon: Shield, title: "Private & Secure", desc: "Your files are processed securely and auto-deleted after 24 hours." },
  { icon: Clock, title: "Always Available", desc: "Process tracks anytime. No software to install, works in your browser." },
];

const plans = [
  {
    name: "Free",
    price: "₦0",
    period: "forever",
    features: ["3 stems per day", "Standard processing speed", "Vocals, Drums, Bass, Other", "24-hour file retention"],
    cta: "Get Started Free",
    highlight: false,
    href: "/upload",
  },
  {
    name: "Pro",
    price: "₦2,999",
    period: "per month",
    features: ["Unlimited stems", "Priority processing queue", "High-quality Demucs model", "7-day file retention", "Bulk upload support", "API access"],
    cta: "Go Pro",
    highlight: true,
    href: "/upgrade",
  },
];

const waveHeights = [20, 35, 50, 40, 60, 45, 55, 30, 50, 65, 40, 35, 55, 45, 60, 50, 35, 45, 55, 40, 60, 50, 35, 45, 55, 40, 60, 45, 35, 50, 40, 55, 45, 60, 35, 50, 40, 55, 35, 45];

export default function Home() {
  return (
    <div className="pt-16">
      {/* Hero */}
      <section className="relative min-h-screen flex items-center justify-center overflow-hidden px-6">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full bg-purple-600/10 blur-[120px]" />
          <div className="absolute top-1/3 left-1/3 w-[400px] h-[400px] rounded-full bg-blue-600/10 blur-[100px]" />
        </div>

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-card neon-border text-sm text-purple-300 mb-8">
            <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            Powered by Meta Demucs AI
          </div>

          <h1 className="text-5xl md:text-7xl font-black mb-6 leading-tight tracking-tight">
            Separate any song into{" "}
            <span className="gradient-text">professional stems</span>{" "}
            in seconds
          </h1>

          <p className="text-lg md:text-xl text-white/50 mb-10 max-w-2xl mx-auto">
            Upload any audio track. Our AI separates it into vocals, drums, bass, and more — studio-quality results, instantly.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-20">
            <Link
              href="/upload"
              className="flex items-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all font-semibold text-lg shadow-2xl shadow-purple-500/30 animate-pulse-glow"
            >
              Upload Your Track
              <ArrowRight size={20} />
            </Link>
            <Link href="#pricing" className="px-8 py-4 rounded-xl glass-card border border-white/10 hover:border-white/20 transition-all font-medium text-white/70 hover:text-white">
              View Pricing
            </Link>
          </div>

          {/* Waveform demo */}
          <div className="flex items-end justify-center gap-1 h-16">
            {waveHeights.map((h, i) => (
              <div
                key={i}
                className="w-1.5 rounded-full bg-gradient-to-t from-purple-600 to-blue-400 opacity-70"
                style={{ height: `${h}%` }}
              />
            ))}
          </div>
          <p className="text-xs text-white/30 mt-3">Sample waveform preview</p>
        </div>
      </section>

      {/* Stems showcase */}
      <section className="py-24 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">4 professional stems, every time</h2>
            <p className="text-white/50">Each stem is isolated with precision by our AI model</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {stems.map(({ icon: Icon, label, color, desc }) => (
              <div key={label} className="glass-card rounded-2xl p-6 hover:border-white/15 transition-all group">
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
                  <Icon size={22} className="text-white" />
                </div>
                <h3 className="font-semibold text-lg mb-2">{label}</h3>
                <p className="text-sm text-white/50">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-24 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-purple-600/20 to-blue-600/20 border border-purple-500/20 flex items-center justify-center mx-auto mb-5">
                  <Icon size={24} className="text-purple-400" />
                </div>
                <h3 className="font-semibold text-lg mb-3">{title}</h3>
                <p className="text-white/50 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 px-6 border-t border-white/5">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">Simple pricing</h2>
            <p className="text-white/50">Start free. Upgrade when you need more.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {plans.map((plan) => (
              <div
                key={plan.name}
                className={`rounded-2xl p-8 relative ${plan.highlight ? "neon-border bg-gradient-to-b from-purple-900/20 to-blue-900/10" : "glass-card"}`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 rounded-full bg-gradient-to-r from-purple-600 to-blue-600 text-xs font-semibold whitespace-nowrap">
                    Most Popular
                  </div>
                )}
                <div className="mb-6">
                  <h3 className="text-lg font-semibold mb-2">{plan.name}</h3>
                  <div className="flex items-end gap-1">
                    <span className="text-4xl font-black gradient-text">{plan.price}</span>
                    <span className="text-white/40 mb-1 text-sm">/{plan.period}</span>
                  </div>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-3 text-sm text-white/70">
                      <Check size={16} className="text-purple-400 shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.href}
                  className={`block text-center py-3 rounded-xl font-semibold transition-all ${plan.highlight ? "bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 shadow-lg shadow-purple-500/20" : "glass-card border border-white/10 hover:border-white/20 text-white/70 hover:text-white"}`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 border-t border-white/5">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4">Ready to split your first track?</h2>
          <p className="text-white/50 mb-8">No signup required. Upload and separate in seconds.</p>
          <Link
            href="/upload"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 transition-all font-semibold text-lg shadow-2xl shadow-purple-500/30"
          >
            Start for Free <ArrowRight size={20} />
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/5 py-8 px-6 text-center text-white/30 text-sm">
        © 2025 StemSplit AI · Powered by Meta Demucs
      </footer>
    </div>
  );
}
