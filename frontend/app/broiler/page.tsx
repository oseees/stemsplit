"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bird, Thermometer, Wind, Droplets, Compass, Sun, Moon, Gauge,
  AlertTriangle, CheckCircle2, Info, XCircle, Utensils, Ruler, Flame, Navigation,
} from "lucide-react";
import {
  simulate, DEFAULT_INPUTS, bearingToCardinal,
  type BroilerInputs, type BroilerResult, type Severity,
} from "@/lib/broiler";

// ---------------------------- UI helpers ----------------------------------

const sevColor: Record<Severity, string> = {
  ok: "text-emerald-300 border-emerald-500/30 bg-emerald-500/10",
  info: "text-sky-300 border-sky-500/30 bg-sky-500/10",
  warn: "text-amber-300 border-amber-500/30 bg-amber-500/10",
  danger: "text-rose-300 border-rose-500/30 bg-rose-500/10",
};

const sevIcon: Record<Severity, React.ReactNode> = {
  ok: <CheckCircle2 size={16} />,
  info: <Info size={16} />,
  warn: <AlertTriangle size={16} />,
  danger: <XCircle size={16} />,
};

function Field({
  label, hint, children,
}: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-white/60">{label}</span>
      {hint && <span className="ml-1 text-[10px] text-white/30">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

const inputCls =
  "w-full rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-white " +
  "focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/40";

function NumberField({
  label, hint, value, min, max, step, onChange,
}: {
  label: string; hint?: string; value: number; min?: number; max?: number; step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number" className={inputCls} value={value}
        min={min} max={max} step={step ?? 1}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      />
    </Field>
  );
}

function Stat({
  icon, label, value, sub, status,
}: {
  icon: React.ReactNode; label: string; value: string; sub?: string; status?: Severity;
}) {
  return (
    <div className={`glass-card rounded-xl p-4 border ${status ? sevColor[status] : "border-white/8"}`}>
      <div className="flex items-center gap-2 text-white/50 text-xs">
        {icon}<span>{label}</span>
      </div>
      <div className="mt-1.5 text-2xl font-bold tracking-tight">{value}</div>
      {sub && <div className="text-xs text-white/40 mt-0.5">{sub}</div>}
    </div>
  );
}

// Compass dial showing house long-axis, prevailing wind, and warm side.
function CompassDial({ orientation, wind }: { orientation: number; wind: number }) {
  const size = 150;
  const c = size / 2;
  const r = c - 14;
  const rad = (d: number) => ((d - 90) * Math.PI) / 180;
  const pt = (deg: number, radius: number) => ({
    x: c + radius * Math.cos(rad(deg)),
    y: c + radius * Math.sin(rad(deg)),
  });
  // House long axis is a double-ended line.
  const a1 = pt(orientation, r - 6);
  const a2 = pt(orientation + 180, r - 6);
  const w = pt(wind, r);
  const wTail = pt(wind + 180, r - 30);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
      <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.12)" />
      {["N", "E", "S", "W"].map((lbl, i) => {
        const p = pt(i * 90, r + 8);
        return (
          <text key={lbl} x={p.x} y={p.y} fontSize="10" fill="rgba(255,255,255,0.5)"
            textAnchor="middle" dominantBaseline="middle">{lbl}</text>
        );
      })}
      {/* House long axis */}
      <line x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} stroke="#a855f7" strokeWidth={6} strokeLinecap="round" />
      {/* Prevailing wind arrow (from -> centre) */}
      <line x1={wTail.x} y1={wTail.y} x2={w.x} y2={w.y} stroke="#38bdf8" strokeWidth={2.5} />
      <circle cx={w.x} cy={w.y} r={4} fill="#38bdf8" />
      <circle cx={c} cy={c} r={3} fill="rgba(255,255,255,0.4)" />
    </svg>
  );
}

// Top-down, to-scale plan of the house: orientation, sun side, wind, vents, density.
function PenPlan({ inp, r }: { inp: BroilerInputs; r: BroilerResult }) {
  const cx = 170, cy = 120, R = 92;
  const D2R = Math.PI / 180;
  const onCircle = (deg: number, rr: number): [number, number] =>
    [cx + rr * Math.sin(deg * D2R), cy - rr * Math.cos(deg * D2R)];

  const densColor = r.densityStatus === "danger" ? "#f43f5e" : r.densityStatus === "ok" ? "#10b981" : "#f59e0b";
  const sunBearing = inp.hemisphere === "N" ? 180 : 0; // sun sits equator-ward
  const sunOn = inp.timeOfDay === "day" && inp.sky !== "overcast";
  const sunAlpha = sunOn ? (0.1 + 0.28 * r.compass.solarLoadIndex) * (inp.sky === "partly" ? 0.6 : 1) : 0;

  const Lpx = 150;
  const Wpx = Math.min(78, Math.max(13, Lpx * (inp.houseWidthM / Math.max(1, inp.houseLengthM))));
  const hx = cx - Lpx / 2, hy = cy - Wpx / 2, midY = cy;
  const rot = inp.houseOrientationDeg - 90; // rotate so length runs along the bearing

  const [sx, sy] = onCircle(sunBearing, R - 8);
  const [sgx, sgy] = onCircle(sunBearing, R - 18);

  // Ventilation schematic (inside the rotated house group).
  const vents: React.ReactNode[] = [];
  if (inp.ventilation === "tunnel") {
    for (let t = 0; t < 3; t++) {
      const ax = hx + 34 + t * 40;
      vents.push(<line key={`a${t}`} x1={ax} y1={midY} x2={ax + 22} y2={midY} stroke="#38bdf8" strokeWidth={1.6} />);
      vents.push(<path key={`ah${t}`} d={`M ${ax + 22} ${midY} l -5 -3 v 6 z`} fill="#38bdf8" />);
    }
    for (let f = -1; f <= 1; f++)
      vents.push(<circle key={`fan${f}`} cx={hx + Lpx - 5} cy={midY + f * (Wpx / 3.2)} r={3.4} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1.4} />);
    for (let f = -1; f <= 1; f++)
      vents.push(<line key={`in${f}`} x1={hx + 2} y1={midY + f * (Wpx / 3.2) - 3} x2={hx + 2} y2={midY + f * (Wpx / 3.2) + 3} stroke="#34d399" strokeWidth={2} />);
  } else if (inp.ventilation === "mechanical") {
    for (let f = -1; f <= 1; f++)
      vents.push(<circle key={`mf${f}`} cx={cx + f * 34} cy={hy + Wpx - 3} r={3.4} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth={1.4} />);
  } else {
    for (let t = 0; t < 5; t++) {
      const ox = hx + 18 + t * 28;
      vents.push(<line key={`ot${t}`} x1={ox} y1={hy} x2={ox + 12} y2={hy} stroke="#34d399" strokeWidth={3} />);
      vents.push(<line key={`ob${t}`} x1={ox} y1={hy + Wpx} x2={ox + 12} y2={hy + Wpx} stroke="#34d399" strokeWidth={3} />);
    }
  }

  // Wind arrow (geographic — blows from the wind bearing toward the house).
  const [wpx, wpy] = onCircle(inp.prevailingWindDeg, R + 16);
  const [wex, wey] = onCircle(inp.prevailingWindDeg, R - 24);
  const wa = Math.atan2(wey - wpy, wex - wpx);
  const [wlx, wly] = onCircle(inp.prevailingWindDeg, R + 27);

  return (
    <svg viewBox="0 0 340 250" className="w-full max-w-[420px] mx-auto block" role="img"
      aria-label="Scaled top-down plan of the broiler house">
      <defs>
        <radialGradient id="penSun" cx={sx} cy={sy} r={R * 1.4} gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fbbf24" stopOpacity={sunAlpha} />
          <stop offset="1" stopColor="#fbbf24" stopOpacity={0} />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={R} fill="rgba(255,255,255,0.03)" stroke="rgba(255,255,255,0.12)" />
      {sunAlpha > 0 && <circle cx={cx} cy={cy} r={R - 1} fill="url(#penSun)" />}

      {["N", "E", "S", "W"].map((lbl, k) => {
        const [x1, y1] = onCircle(k * 90, R);
        const [x2, y2] = onCircle(k * 90, R - 7);
        const [lx, ly] = onCircle(k * 90, R + 11);
        return (
          <g key={lbl}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.35)" strokeWidth={1.5} />
            <text x={lx} y={ly} fontSize={11} fontWeight={600} textAnchor="middle" dominantBaseline="middle"
              fill={lbl === "N" ? "#fb7185" : "rgba(255,255,255,0.45)"}>{lbl}</text>
          </g>
        );
      })}

      {sunOn && (
        <g>
          {Array.from({ length: 8 }, (_, k) => {
            const a = k * 45 * D2R;
            return <line key={k} x1={sgx + 7 * Math.cos(a)} y1={sgy + 7 * Math.sin(a)}
              x2={sgx + 11 * Math.cos(a)} y2={sgy + 11 * Math.sin(a)} stroke="#f59e0b" strokeWidth={1.6} strokeLinecap="round" />;
          })}
          <circle cx={sgx} cy={sgy} r={5.5} fill="#fbbf24" stroke="#f59e0b" />
        </g>
      )}

      <g transform={`rotate(${rot} ${cx} ${cy})`}>
        <rect x={hx} y={hy} width={Lpx} height={Wpx} rx={3} fill={densColor} fillOpacity={0.22} stroke={densColor} strokeWidth={2} />
        {vents}
      </g>

      <text x={cx} y={cy - 4} fontSize={11} fontWeight={700} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontFamily="var(--font-mono)">
        {Math.round(inp.houseLengthM)}×{Math.round(inp.houseWidthM)} m
      </text>
      <text x={cx} y={cy + 9} fontSize={9.5} textAnchor="middle" fill="rgba(255,255,255,0.55)" fontFamily="var(--font-mono)">
        {r.densityKgM2.toFixed(1)} kg/m²
      </text>

      <line x1={wpx} y1={wpy} x2={wex} y2={wey} stroke="#38bdf8" strokeWidth={2.4} />
      <path fill="#38bdf8"
        d={`M ${wex} ${wey} l ${-9 * Math.cos(wa - 0.4)} ${-9 * Math.sin(wa - 0.4)} l ${9 * (Math.cos(wa - 0.4) - Math.cos(wa + 0.4))} ${9 * (Math.sin(wa - 0.4) - Math.sin(wa + 0.4))} z`} />
      <text x={wlx} y={wly} fontSize={9} textAnchor="middle" dominantBaseline="middle" fill="#7dd3fc">wind</text>
    </svg>
  );
}

// Reads the device magnetometer so the farmer can capture true bearings on-site.
type DeviceOrientationEventiOS = { requestPermission?: () => Promise<"granted" | "denied"> };
type OrientationWithHeading = DeviceOrientationEvent & { webkitCompassHeading?: number };

function PhoneCompass({
  onSet,
}: { onSet: (target: "houseOrientationDeg" | "prevailingWindDeg", deg: number) => void }) {
  const [active, setActive] = useState(false);
  const [heading, setHeading] = useState<number | null>(null);
  const [note, setNote] = useState("Point your phone along the pen's long wall, then tap “Set house axis”.");
  const headingRef = useRef<number | null>(null);

  useEffect(() => {
    if (!active) return;
    const onOrient = (ev: Event) => {
      const e = ev as OrientationWithHeading;
      let h: number | null = null;
      if (typeof e.webkitCompassHeading === "number" && !Number.isNaN(e.webkitCompassHeading)) h = e.webkitCompassHeading;
      else if (e.absolute && typeof e.alpha === "number") h = (360 - e.alpha) % 360;
      else if (typeof e.alpha === "number") h = (360 - e.alpha) % 360;
      if (h == null) return;
      const hh = (h + 360) % 360;
      headingRef.current = hh;
      setHeading(hh);
      setNote("Aim the phone down a wall or into the wind, then capture it below.");
    };
    window.addEventListener("deviceorientationabsolute", onOrient, true);
    window.addEventListener("deviceorientation", onOrient, true);
    const t = window.setTimeout(() => {
      if (headingRef.current == null)
        setNote("No compass reading yet — this device may lack a magnetometer, or the browser blocks it. Use the sliders above.");
    }, 2500);
    return () => {
      window.removeEventListener("deviceorientationabsolute", onOrient, true);
      window.removeEventListener("deviceorientation", onOrient, true);
      window.clearTimeout(t);
    };
  }, [active]);

  const start = async () => {
    setActive(true);
    try {
      const DOE = (window as unknown as { DeviceOrientationEvent?: DeviceOrientationEventiOS }).DeviceOrientationEvent;
      if (DOE && typeof DOE.requestPermission === "function") {
        const res = await DOE.requestPermission();
        if (res !== "granted") {
          setNote("Compass permission denied. Enable Motion & Orientation access in Settings, or use the sliders.");
          setActive(false);
        }
      }
    } catch {
      setNote("Couldn't start the compass on this device — use the sliders above.");
    }
  };

  const capture = (target: "houseOrientationDeg" | "prevailingWindDeg") => {
    if (headingRef.current != null) onSet(target, Math.round(headingRef.current));
  };

  return (
    <div className="mt-3 pt-3 border-t border-dashed border-white/10">
      {!active ? (
        <button onClick={start}
          className="w-full flex items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium
            bg-purple-500/15 text-purple-200 border border-purple-500/40 hover:bg-purple-500/25 transition-colors">
          <Navigation size={14} /> Use my phone&apos;s compass
        </button>
      ) : (
        <div className="text-center">
          <div className="text-3xl font-bold tracking-tight tabular-nums">
            {heading == null ? "—" : `${Math.round(heading)}°`}
            {heading != null && <span className="text-sm text-white/40 font-normal ml-1">{bearingToCardinal(heading)}</span>}
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={() => capture("houseOrientationDeg")} disabled={heading == null}
              className="flex-1 rounded-lg py-2 text-xs border border-white/15 text-white/90 bg-white/5 hover:bg-white/10 disabled:opacity-40 transition-colors">
              Set house axis
            </button>
            <button onClick={() => capture("prevailingWindDeg")} disabled={heading == null}
              className="flex-1 rounded-lg py-2 text-xs border border-white/15 text-white/90 bg-white/5 hover:bg-white/10 disabled:opacity-40 transition-colors">
              Set wind from
            </button>
          </div>
        </div>
      )}
      <p className="mt-2 text-[11px] text-white/40 leading-snug">{note}</p>
    </div>
  );
}

// ------------------------------ Page --------------------------------------

export default function BroilerSimulatorPage() {
  const [inp, setInp] = useState<BroilerInputs>(DEFAULT_INPUTS);
  const set = <K extends keyof BroilerInputs>(k: K, v: BroilerInputs[K]) =>
    setInp((p) => ({ ...p, [k]: v }));

  const r: BroilerResult = useMemo(() => simulate(inp), [inp]);

  return (
    <div className="pt-16 min-h-screen">
      {/* Header */}
      <section className="px-6 pt-10 pb-6 border-b border-white/5">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500 to-emerald-600 flex items-center justify-center">
              <Bird size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold gradient-text">Broiler House Simulator</h1>
              <p className="text-sm text-white/50">
                Model your flock&apos;s climate from the weather, house siting and your own inputs.
              </p>
            </div>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-6 py-8 grid lg:grid-cols-[380px_1fr] gap-8">
        {/* ---------------- Inputs ---------------- */}
        <div className="space-y-6">
          {/* Flock */}
          <div className="glass-card rounded-2xl p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white/80 mb-4">
              <Bird size={15} /> Flock
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Age" hint="days" value={inp.birdAgeDays} min={0} max={70}
                onChange={(v) => set("birdAgeDays", v)} />
              <NumberField label="Bird count" value={inp.birdCount} min={0} step={100}
                onChange={(v) => set("birdCount", v)} />
              <Field label="Breed">
                <select className={inputCls} value={inp.breed}
                  onChange={(e) => set("breed", e.target.value as BroilerInputs["breed"])}>
                  <option value="ross308">Ross 308</option>
                  <option value="cobb500">Cobb 500</option>
                  <option value="generic">Generic</option>
                </select>
              </Field>
            </div>
          </div>

          {/* House */}
          <div className="glass-card rounded-2xl p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white/80 mb-4">
              <Ruler size={15} /> House
            </h2>
            <div className="grid grid-cols-3 gap-3">
              <NumberField label="Length" hint="m" value={inp.houseLengthM} min={1}
                onChange={(v) => set("houseLengthM", v)} />
              <NumberField label="Width" hint="m" value={inp.houseWidthM} min={1}
                onChange={(v) => set("houseWidthM", v)} />
              <NumberField label="Height" hint="m" value={inp.houseHeightM} min={1} step={0.1}
                onChange={(v) => set("houseHeightM", v)} />
            </div>
            <div className="mt-3">
              <Field label="Insulation">
                <select className={inputCls} value={inp.insulation}
                  onChange={(e) => set("insulation", e.target.value as BroilerInputs["insulation"])}>
                  <option value="poor">Poor</option>
                  <option value="average">Average</option>
                  <option value="good">Good</option>
                </select>
              </Field>
            </div>
          </div>

          {/* Siting / compass */}
          <div className="glass-card rounded-2xl p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white/80 mb-4">
              <Compass size={15} /> Siting &amp; compass
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Long-axis bearing" hint={`${bearingToCardinal(inp.houseOrientationDeg)}`}>
                <input type="range" min={0} max={359} value={inp.houseOrientationDeg}
                  className="w-full accent-purple-500"
                  onChange={(e) => set("houseOrientationDeg", Number(e.target.value))} />
                <div className="text-xs text-white/50 mt-1">{inp.houseOrientationDeg}°</div>
              </Field>
              <Field label="Wind from" hint={`${bearingToCardinal(inp.prevailingWindDeg)}`}>
                <input type="range" min={0} max={359} value={inp.prevailingWindDeg}
                  className="w-full accent-sky-500"
                  onChange={(e) => set("prevailingWindDeg", Number(e.target.value))} />
                <div className="text-xs text-white/50 mt-1">{inp.prevailingWindDeg}°</div>
              </Field>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 items-center">
              <div>
                <NumberField label="Latitude" hint="°" value={inp.latitudeDeg} min={-90} max={90}
                  onChange={(v) => set("latitudeDeg", v)} />
                <div className="mt-3">
                  <Field label="Hemisphere">
                    <select className={inputCls} value={inp.hemisphere}
                      onChange={(e) => set("hemisphere", e.target.value as BroilerInputs["hemisphere"])}>
                      <option value="N">Northern</option>
                      <option value="S">Southern</option>
                    </select>
                  </Field>
                </div>
              </div>
              <CompassDial orientation={inp.houseOrientationDeg} wind={inp.prevailingWindDeg} />
            </div>
            <div className="mt-2 flex items-center justify-center gap-4 text-[10px] text-white/40">
              <span className="flex items-center gap-1"><span className="w-3 h-1 rounded bg-purple-500 inline-block" /> house axis</span>
              <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-sky-400 inline-block" /> wind</span>
            </div>
            <PhoneCompass onSet={(t, deg) => set(t, deg)} />
          </div>

          {/* Environment */}
          <div className="glass-card rounded-2xl p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white/80 mb-4">
              <Thermometer size={15} /> Environment
            </h2>
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Outside temp" hint="°C" value={inp.outsideTempC} min={-20} max={55} step={0.5}
                onChange={(v) => set("outsideTempC", v)} />
              <NumberField label="Humidity" hint="%" value={inp.relativeHumidity} min={0} max={100}
                onChange={(v) => set("relativeHumidity", v)} />
              <NumberField label="Wind speed" hint="m/s" value={inp.windSpeedMs} min={0} max={30} step={0.5}
                onChange={(v) => set("windSpeedMs", v)} />
              <Field label="Sky">
                <select className={inputCls} value={inp.sky}
                  onChange={(e) => set("sky", e.target.value as BroilerInputs["sky"])}>
                  <option value="clear">Clear</option>
                  <option value="partly">Partly cloudy</option>
                  <option value="overcast">Overcast</option>
                </select>
              </Field>
            </div>
            <div className="mt-3 flex gap-2">
              {(["day", "night"] as const).map((t) => (
                <button key={t} onClick={() => set("timeOfDay", t)}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-sm border transition-colors ${
                    inp.timeOfDay === t
                      ? "border-purple-500/60 bg-purple-500/15 text-white"
                      : "border-white/10 text-white/50 hover:text-white"
                  }`}>
                  {t === "day" ? <Sun size={14} /> : <Moon size={14} />}
                  {t === "day" ? "Day" : "Night"}
                </button>
              ))}
            </div>
          </div>

          {/* Equipment */}
          <div className="glass-card rounded-2xl p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white/80 mb-4">
              <Wind size={15} /> Ventilation &amp; equipment
            </h2>
            <Field label="Ventilation type">
              <select className={inputCls} value={inp.ventilation}
                onChange={(e) => set("ventilation", e.target.value as BroilerInputs["ventilation"])}>
                <option value="natural">Natural (sidewall)</option>
                <option value="mechanical">Mechanical minimum</option>
                <option value="tunnel">Tunnel</option>
              </select>
            </Field>
            {inp.ventilation === "tunnel" && (
              <div className="mt-3">
                <NumberField label="Tunnel air speed" hint="m/s" value={inp.tunnelAirSpeedMs}
                  min={0} max={5} step={0.1} onChange={(v) => set("tunnelAirSpeedMs", v)} />
              </div>
            )}
            <div className="mt-3 space-y-2">
              <label className="flex items-center gap-2 text-sm text-white/70">
                <input type="checkbox" checked={inp.heatingAvailable} className="accent-purple-500"
                  onChange={(e) => set("heatingAvailable", e.target.checked)} />
                Supplemental heating available
              </label>
              <label className="flex items-center gap-2 text-sm text-white/70">
                <input type="checkbox" checked={inp.evaporativeCooling} className="accent-purple-500"
                  onChange={(e) => set("evaporativeCooling", e.target.checked)} />
                Evaporative cooling (pads/fogging)
              </label>
            </div>
          </div>
        </div>

        {/* ---------------- Results ---------------- */}
        <div className="space-y-6">
          {/* Headline banner */}
          <div className={`rounded-2xl border p-5 ${sevColor[r.climateStatus]}`}>
            <div className="flex items-center gap-2 text-sm font-semibold">
              {sevIcon[r.climateStatus]}
              <span>
                {r.climateStatus === "ok" ? "Climate on target"
                  : r.climateStatus === "warn" ? "Climate needs attention"
                  : "Climate is a risk to the flock"}
              </span>
            </div>
            <p className="mt-1 text-sm text-white/70">
              Birds are {r.ageWeeks.toFixed(1)} weeks old (~{(r.bodyWeightKg * 1000).toFixed(0)} g).
              They feel about <strong>{r.effectiveTempC.toFixed(1)}°C</strong> against a target of{" "}
              <strong>{r.targetTempC.toFixed(0)}°C</strong> ({r.comfortLowC.toFixed(1)}–{r.comfortHighC.toFixed(1)}°C comfort band).
            </p>
          </div>

          {/* Pen layout */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="flex items-center gap-2 text-xs uppercase tracking-wider text-white/40 mb-2">
              <Bird size={13} /> Pen layout — top-down, to scale
            </h3>
            <PenPlan inp={inp} r={r} />
            <div className="mt-2 text-center text-xs text-white/50">
              Long axis {inp.houseOrientationDeg}° {bearingToCardinal(inp.houseOrientationDeg)} · wind from{" "}
              {inp.prevailingWindDeg}° {bearingToCardinal(inp.prevailingWindDeg)} · {inp.timeOfDay}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-[10px] text-white/40">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-500/60 inline-block" /> flock density</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-emerald-400 inline-block" /> air inlets</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-sky-400 inline-block" /> airflow / wind</span>
              {inp.timeOfDay === "day" && inp.sky !== "overcast" && (
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-amber-400 inline-block" /> sun side</span>
              )}
            </div>
          </div>

          {/* Climate stats */}
          <div>
            <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3">Climate</h3>
            <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <Stat icon={<Thermometer size={14} />} label="Target temp"
                value={`${r.targetTempC.toFixed(0)}°C`} sub={`band ${r.comfortLowC.toFixed(0)}–${r.comfortHighC.toFixed(0)}°C`} />
              <Stat icon={<Thermometer size={14} />} label="Est. inside temp"
                value={`${r.estimatedInsideTempC.toFixed(1)}°C`}
                sub={`${r.tempDeltaC >= 0 ? "+" : ""}${r.tempDeltaC.toFixed(1)}°C vs target`}
                status={Math.abs(r.tempDeltaC) > 3 ? "danger" : Math.abs(r.tempDeltaC) > 1.5 ? "warn" : "ok"} />
              <Stat icon={<Gauge size={14} />} label="Felt temp"
                value={`${r.effectiveTempC.toFixed(1)}°C`}
                sub={`THI ${r.thi.toFixed(1)}`} />
              <Stat icon={<Flame size={14} />} label="Heat stress"
                value={r.heatStress.level.split(" ")[0]} sub={r.heatStress.level}
                status={r.heatStress.severity} />
            </div>
          </div>

          {/* Effect breakdown */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3">What&apos;s moving the temperature</h3>
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-2 text-sm">
              <Row label="Solar heat gain" value={`+${r.solarLiftC.toFixed(1)}°C`} muted={r.solarLiftC < 0.1} />
              <Row label="Air-speed cooling" value={`-${r.airSpeedCoolingC.toFixed(1)}°C`} muted={r.airSpeedCoolingC < 0.1} />
              <Row label="Evaporative cooling" value={`-${r.evapCoolingC.toFixed(1)}°C`} muted={r.evapCoolingC < 0.1} />
              <Row label="Heating load"
                value={r.heatingLoadKw != null ? `${r.heatingLoadKw.toFixed(1)} kW` : "—"}
                muted={r.heatingLoadKw == null || r.heatingLoadKw === 0} />
            </div>
          </div>

          {/* Ventilation */}
          <div>
            <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3">Ventilation</h3>
            <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-3">
              <Stat icon={<Wind size={14} />} label="Provided airflow"
                value={`${Math.round(r.providedVentilationM3h).toLocaleString()}`} sub="m³/h (est.)"
                status={r.providedVentilationM3h < r.minVentilationM3h ? "danger" : "ok"} />
              <Stat icon={<Wind size={14} />} label="Min for air quality"
                value={`${Math.round(r.minVentilationM3h).toLocaleString()}`} sub="m³/h" />
              <Stat icon={<Wind size={14} />} label="Hot-weather target"
                value={`${Math.round(r.hotVentilationM3h).toLocaleString()}`} sub="m³/h" />
              <Stat icon={<Gauge size={14} />} label="Air changes"
                value={`${r.airChangesPerHour.toFixed(1)}/h`} />
            </div>
          </div>

          {/* Density + feed/water */}
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3">Stocking density</h3>
              <div className="grid grid-cols-2 gap-3">
                <Stat icon={<Bird size={14} />} label="Density"
                  value={`${r.densityKgM2.toFixed(1)}`} sub="kg/m²" status={r.densityStatus} />
                <Stat icon={<Bird size={14} />} label="Birds / m²"
                  value={`${r.birdsPerM2.toFixed(1)}`} sub={`${Math.round(r.floorAreaM2)} m² floor`} />
              </div>
            </div>
            <div>
              <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3">Feed &amp; water (today)</h3>
              <div className="grid grid-cols-2 gap-3">
                <Stat icon={<Utensils size={14} />} label="Feed"
                  value={`${r.flockDailyFeedKg.toFixed(0)} kg`} sub={`${r.dailyFeedGPerBird.toFixed(0)} g/bird`} />
                <Stat icon={<Droplets size={14} />} label="Water"
                  value={`${r.flockDailyWaterL.toFixed(0)} L`} sub={`${r.dailyWaterMlPerBird.toFixed(0)} mL/bird`} />
              </div>
            </div>
          </div>

          {/* Compass guidance */}
          <div className="glass-card rounded-2xl p-5">
            <h3 className="flex items-center gap-2 text-xs uppercase tracking-wider text-white/40 mb-3">
              <Compass size={13} /> Siting analysis
            </h3>
            <div className="space-y-2 text-sm">
              <Row label="Solar load" value={r.compass.solarLabel} />
              <Row label="Ventilation alignment" value={r.compass.ventLabel} />
              <Row label="Strongest sun on" value={r.compass.warmSideLabel} />
            </div>
          </div>

          {/* Recommendations */}
          <div>
            <h3 className="text-xs uppercase tracking-wider text-white/40 mb-3">Recommendations</h3>
            <div className="space-y-2">
              {r.recommendations.map((rec, i) => (
                <div key={i} className={`rounded-xl border p-3.5 flex gap-3 ${sevColor[rec.severity]}`}>
                  <div className="mt-0.5 shrink-0">{sevIcon[rec.severity]}</div>
                  <div>
                    <div className="text-sm font-semibold">{rec.title}</div>
                    <div className="text-sm text-white/70 mt-0.5">{rec.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-white/30 pt-2">
            Estimates are a planning aid built on simplified poultry-science models and standard broiler
            reference curves. Always confirm against in-house sensors, breed guides and local veterinary advice.
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-white/5 py-1.5 last:border-0">
      <span className="text-white/50">{label}</span>
      <span className={`font-medium text-right ${muted ? "text-white/30" : "text-white/90"}`}>{value}</span>
    </div>
  );
}
