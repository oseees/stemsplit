// Broiler farm climate & performance simulator
// -------------------------------------------------
// A transparent, decision-support model for broiler (meat chicken) houses.
// It takes the outside environment, the house geometry + compass orientation,
// and the farmer's flock variables, and estimates:
//   - the age-appropriate target house temperature (brooding curve)
//   - the estimated inside temperature (simple steady-state heat balance)
//   - the temperature birds actually "feel" (humidity + air speed adjusted)
//   - a poultry heat-stress index (Marai THI) and stress category
//   - ventilation requirements (minimum air-quality vs. hot-weather cooling)
//   - feed / water demand and expected body weight for the age
//   - stocking density vs. welfare limits
//   - compass guidance for solar load and ventilation alignment
//   - a prioritised list of actionable recommendations
//
// Every formula here is a documented simplification meant for teaching /
// planning, not a substitute for on-farm sensors and veterinary advice.

// ----------------------------- Types --------------------------------------

export type Breed = "ross308" | "cobb500" | "generic";
export type VentilationType = "natural" | "mechanical" | "tunnel";
export type Insulation = "poor" | "average" | "good";
export type Sky = "clear" | "partly" | "overcast";
export type TimeOfDay = "day" | "night";
export type Hemisphere = "N" | "S";

export interface BroilerInputs {
  // Flock variables (farmer input)
  birdAgeDays: number;
  birdCount: number;
  breed: Breed;

  // House geometry (metres). Length is the LONG axis.
  houseLengthM: number;
  houseWidthM: number;
  houseHeightM: number;
  insulation: Insulation;

  // Compass / siting
  houseOrientationDeg: number; // bearing of the LONG axis, 0=N, 90=E
  prevailingWindDeg: number; // bearing the wind blows FROM
  latitudeDeg: number;
  hemisphere: Hemisphere;

  // Environment
  outsideTempC: number;
  relativeHumidity: number; // %
  windSpeedMs: number;
  sky: Sky;
  timeOfDay: TimeOfDay;

  // Equipment / management
  ventilation: VentilationType;
  heatingAvailable: boolean;
  evaporativeCooling: boolean;
  tunnelAirSpeedMs: number; // target air speed at bird level for tunnel mode
}

export type Severity = "ok" | "info" | "warn" | "danger";

export interface Recommendation {
  severity: Severity;
  title: string;
  detail: string;
}

export interface BroilerResult {
  ageWeeks: number;
  bodyWeightKg: number;
  targetTempC: number;
  comfortLowC: number;
  comfortHighC: number;

  estimatedInsideTempC: number;
  effectiveTempC: number; // what the birds "feel"
  tempDeltaC: number; // inside - target (+ = too warm)
  climateStatus: Severity;

  thi: number;
  heatStress: { level: string; severity: Severity };
  coldStress: boolean;

  heatingLoadKw: number | null; // null when heating not required
  airSpeedCoolingC: number;
  evapCoolingC: number;
  solarLiftC: number;

  minVentilationM3h: number; // air-quality minimum
  hotVentilationM3h: number; // hot-weather / tunnel capacity target
  providedVentilationM3h: number; // what the current setup delivers
  airChangesPerHour: number;

  floorAreaM2: number;
  birdsPerM2: number;
  densityKgM2: number;
  densityStatus: Severity;

  dailyFeedGPerBird: number;
  dailyWaterMlPerBird: number;
  flockDailyFeedKg: number;
  flockDailyWaterL: number;

  compass: {
    solarLoadIndex: number; // 0 best (E-W) .. 1 worst (N-S)
    solarLabel: string;
    ventAlignmentScore: number; // 0..1, higher is better for the vent type
    ventLabel: string;
    warmSideLabel: string; // side of the house taking the strongest sun
  };

  recommendations: Recommendation[];
}

// --------------------------- Constants ------------------------------------

const AIR_DENSITY = 1.2; // kg/m3
const AIR_CP = 1005; // J/(kg.K)
const SENSIBLE_HEAT_W_PER_KG = 6.5; // broiler sensible heat at moderate temps

// --------------------------- Helpers --------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Piecewise-linear interpolation over sorted [x, y] control points.
function interp(points: [number, number][], x: number): number {
  if (x <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (x >= last[0]) return last[1];
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    if (x >= x0 && x <= x1) {
      const t = (x - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return last[1];
}

// Smallest absolute angular difference between two bearings, 0..180.
function angleDiff(a: number, b: number): number {
  let d = Math.abs(((a - b) % 360) + 360) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

// ----------------------- Reference curves ---------------------------------

// Target house dry-bulb temperature by age (brooding curve, deg C).
const TARGET_TEMP: [number, number][] = [
  [0, 34], [3, 32], [7, 31], [14, 28], [21, 26], [28, 23], [35, 21], [42, 20], [56, 19],
];

// Body weight (kg) by age for a generic as-hatched broiler.
const WEIGHT_KG: [number, number][] = [
  [0, 0.042], [7, 0.185], [14, 0.465], [21, 0.94], [28, 1.55], [35, 2.25], [42, 2.95], [49, 3.5], [56, 3.9],
];

// Daily feed intake (g/bird/day) by age.
const DAILY_FEED_G: [number, number][] = [
  [1, 13], [7, 33], [14, 62], [21, 100], [28, 150], [35, 185], [42, 210], [49, 225], [56, 230],
];

const BREED_WEIGHT_FACTOR: Record<Breed, number> = {
  ross308: 1.03,
  cobb500: 1.02,
  generic: 1.0,
};

// ----------------------- Main simulation ----------------------------------

export function simulate(input: BroilerInputs): BroilerResult {
  const age = clamp(input.birdAgeDays, 0, 70);
  const rh = clamp(input.relativeHumidity, 0, 100);

  const bodyWeightKg = interp(WEIGHT_KG, age) * BREED_WEIGHT_FACTOR[input.breed];
  const targetTempC = interp(TARGET_TEMP, age);

  // Comfort band widens as birds feather up and tolerate more variation.
  const bandHalf = clamp(1.5 + age * 0.06, 1.5, 4);
  const comfortLowC = targetTempC - bandHalf;
  const comfortHighC = targetTempC + bandHalf;

  // ---------------- Compass: solar load + ventilation alignment -----------
  // Long walls run parallel to the long axis. Worst solar exposure on the
  // long sidewalls happens when the long axis runs N-S (walls face E/W and
  // catch low, hard-to-shade morning & afternoon sun). Best is E-W.
  const axisFromEW = Math.min(angleDiff(input.houseOrientationDeg, 90), angleDiff(input.houseOrientationDeg, 270)) / 90;
  const solarLoadIndex = clamp(axisFromEW, 0, 1); // 0 = E-W (good), 1 = N-S (bad)
  const solarLabel =
    solarLoadIndex < 0.34 ? "Low — long axis near E–W (recommended)"
    : solarLoadIndex < 0.67 ? "Moderate — angled to the sun"
    : "High — long axis near N–S; sidewalls catch low sun";

  // The strongest sun comes from the equator-ward side.
  const warmSideLabel = input.hemisphere === "N" ? "south-facing wall" : "north-facing wall";

  // Ventilation alignment.
  // Natural cross-ventilation wants wind roughly PERPENDICULAR to the long axis.
  // Tunnel ventilation wants the prevailing wind to run ALONG the axis so it
  // does not fight the exhaust fans.
  const windToAxis = angleDiff(input.prevailingWindDeg, input.houseOrientationDeg); // 0..90 effectively
  const perpAlignment = angleDiff(windToAxis, 90) / 90; // 0 = perfectly perpendicular
  let ventAlignmentScore: number;
  let ventLabel: string;
  if (input.ventilation === "tunnel") {
    const parallelness = Math.min(windToAxis, 180 - windToAxis) / 90; // 0 = parallel
    ventAlignmentScore = 1 - parallelness;
    ventLabel =
      ventAlignmentScore > 0.66 ? "Good — prevailing wind runs with the tunnel"
      : ventAlignmentScore > 0.33 ? "Fair — wind is quartering the fans"
      : "Poor — wind blows across/against the exhaust fans";
  } else {
    ventAlignmentScore = 1 - perpAlignment;
    ventLabel =
      ventAlignmentScore > 0.66 ? "Good — wind hits the long sidewalls"
      : ventAlignmentScore > 0.33 ? "Fair — wind quartering the house"
      : "Poor — wind runs along the ridge, weak cross-flow";
  }

  // ---------------- House geometry & bird heat ----------------------------
  const floorAreaM2 = Math.max(1, input.houseLengthM * input.houseWidthM);
  const volumeM3 = floorAreaM2 * Math.max(1.5, input.houseHeightM);
  const crossSectionM2 = Math.max(1, input.houseWidthM * input.houseHeightM);
  const totalWeightKg = input.birdCount * bodyWeightKg;
  const birdSensibleHeatW = totalWeightKg * SENSIBLE_HEAT_W_PER_KG;

  // ---------------- Ventilation capacity of the current setup -------------
  // Minimum air-quality ventilation (~0.4 m3/h per kg of live weight) and a
  // hot-weather / tunnel target (~8 m3/h per kg).
  const minVentilationM3h = totalWeightKg * 0.4;
  const hotVentilationM3h = totalWeightKg * 8;

  let providedVentilationM3h: number;
  if (input.ventilation === "tunnel") {
    // Airflow = target air speed through the house cross-section.
    providedVentilationM3h = input.tunnelAirSpeedMs * crossSectionM2 * 3600;
  } else if (input.ventilation === "mechanical") {
    // Minimum-ventilation fans staged for air quality; scale up modestly in heat.
    providedVentilationM3h = minVentilationM3h * (input.outsideTempC > targetTempC ? 3 : 1);
  } else {
    // Natural: wind-driven through ~30% open sidewall area on the windward side.
    const openingArea = input.houseLengthM * input.houseHeightM * 0.3;
    providedVentilationM3h = 0.25 * Math.max(0.3, input.windSpeedMs) * openingArea * 3600 * (0.4 + 0.6 * ventAlignmentScore);
  }
  providedVentilationM3h = Math.max(minVentilationM3h * 0.5, providedVentilationM3h);
  const airChangesPerHour = providedVentilationM3h / volumeM3;

  // ---------------- Inside temperature (steady-state estimate) ------------
  const insulationFactor: Record<Insulation, number> = { poor: 1.4, average: 1.0, good: 0.6 };
  const iFac = insulationFactor[input.insulation];

  // Warming from bird heat, limited by how much air the fans move.
  const ventM3s = providedVentilationM3h / 3600;
  const birdLiftC = clamp(birdSensibleHeatW / (Math.max(0.02, ventM3s) * AIR_DENSITY * AIR_CP), 0, 12);

  // Solar lift during daytime, driven by orientation, sky and insulation.
  const skyFactor: Record<Sky, number> = { clear: 1, partly: 0.55, overcast: 0.15 };
  const solarLiftC = input.timeOfDay === "day"
    ? solarLoadIndex * 6 * skyFactor[input.sky] * iFac
    : 0;

  // Evaporative cooling only helps when air is not already saturated.
  const evapCoolingC = input.evaporativeCooling
    ? clamp(((100 - rh) / 100) * 9, 0, 9) * (input.ventilation === "tunnel" ? 1 : 0.6)
    : 0;

  let estimatedInsideTempC: number;
  let heatingLoadKw: number | null = null;

  const passiveInside = input.outsideTempC + birdLiftC + solarLiftC - evapCoolingC;

  if (passiveInside < targetTempC && input.heatingAvailable) {
    // Heater holds the setpoint; report the load it must supply.
    estimatedInsideTempC = targetTempC;
    const ventHeatLossW = ventM3s * AIR_DENSITY * AIR_CP * (targetTempC - input.outsideTempC);
    const fabricUA = 0.9 * iFac * (2 * (input.houseLengthM + input.houseWidthM) * input.houseHeightM + floorAreaM2);
    const fabricLossW = fabricUA * (targetTempC - input.outsideTempC);
    heatingLoadKw = Math.max(0, (ventHeatLossW + fabricLossW - birdSensibleHeatW) / 1000);
  } else {
    estimatedInsideTempC = passiveInside;
  }

  // ---------------- Effective (felt) temperature --------------------------
  // Humidity penalty: high RH blocks evaporative heat loss once it is warm.
  const humidityPenaltyC = estimatedInsideTempC > 26
    ? clamp(((rh - 50) / 100) * (estimatedInsideTempC - 26) * 0.7, 0, 6)
    : 0;

  // Air-speed cooling ("wind chill") only benefits feathered birds (>14 d)
  // and only when they need to shed heat. Young chicks must not feel drafts.
  const localAirSpeed =
    input.ventilation === "tunnel" ? input.tunnelAirSpeedMs
    : input.ventilation === "natural" ? Math.min(1.2, input.windSpeedMs * 0.3 * ventAlignmentScore)
    : 0.2;
  const ageCoolingFactor = clamp((age - 10) / 25, 0, 1); // ramps in from ~10 d
  const airSpeedCoolingC = estimatedInsideTempC > targetTempC
    ? clamp(localAirSpeed * 2.5 * ageCoolingFactor, 0, 7)
    : 0;

  const effectiveTempC = estimatedInsideTempC + humidityPenaltyC - airSpeedCoolingC;
  const tempDeltaC = estimatedInsideTempC - targetTempC;

  // ---------------- Poultry heat-stress index (Marai THI) -----------------
  const thi = effectiveTempC - (0.31 - 0.0031 * rh) * (effectiveTempC - 14.4);
  let heatStress: { level: string; severity: Severity };
  if (thi < 27.8) heatStress = { level: "None / comfortable", severity: "ok" };
  else if (thi < 28.9) heatStress = { level: "Moderate heat stress", severity: "warn" };
  else if (thi < 30) heatStress = { level: "Severe heat stress", severity: "danger" };
  else heatStress = { level: "Extreme heat stress", severity: "danger" };

  const coldStress = effectiveTempC < comfortLowC - 0.5;

  // ---------------- Climate status ----------------------------------------
  let climateStatus: Severity = "ok";
  if (effectiveTempC > comfortHighC + 3 || effectiveTempC < comfortLowC - 3) climateStatus = "danger";
  else if (effectiveTempC > comfortHighC || effectiveTempC < comfortLowC) climateStatus = "warn";
  if (heatStress.severity === "danger") climateStatus = "danger";

  // ---------------- Density -----------------------------------------------
  const birdsPerM2 = input.birdCount / floorAreaM2;
  const densityKgM2 = totalWeightKg / floorAreaM2;
  let densityStatus: Severity = "ok";
  if (densityKgM2 > 42) densityStatus = "danger";
  else if (densityKgM2 > 39) densityStatus = "warn";
  else if (densityKgM2 > 33) densityStatus = "info";

  // ---------------- Feed & water ------------------------------------------
  const dailyFeedGPerBird = interp(DAILY_FEED_G, Math.max(1, age));
  // Water:feed ~1.8 at 21C, rising ~6% per deg C of felt heat above 21C.
  const waterRatio = 1.8 * (1 + 0.06 * Math.max(0, effectiveTempC - 21));
  const dailyWaterMlPerBird = dailyFeedGPerBird * waterRatio;
  const flockDailyFeedKg = (dailyFeedGPerBird * input.birdCount) / 1000;
  const flockDailyWaterL = (dailyWaterMlPerBird * input.birdCount) / 1000;

  // ---------------- Recommendations ---------------------------------------
  const recommendations: Recommendation[] = [];

  if (heatStress.severity === "danger") {
    recommendations.push({
      severity: "danger",
      title: "Act now on heat stress",
      detail: `THI ${thi.toFixed(1)} (${heatStress.level}). Maximise air speed over the birds, run evaporative cooling, ensure ample cool drinking water, and avoid handling/feeding during the hottest hours.`,
    });
  } else if (heatStress.severity === "warn") {
    recommendations.push({
      severity: "warn",
      title: "Watch for heat stress",
      detail: `THI ${thi.toFixed(1)}. Increase ventilation and air movement over the birds and check water flow before it worsens.`,
    });
  }

  if (coldStress) {
    recommendations.push({
      severity: input.heatingAvailable ? "warn" : "danger",
      title: "Birds are too cold",
      detail: input.heatingAvailable
        ? `Felt temperature ${effectiveTempC.toFixed(1)}°C is below the ${comfortLowC.toFixed(1)}°C comfort floor. Raise heating toward the ${targetTempC.toFixed(0)}°C setpoint and reduce minimum ventilation to the air-quality minimum.`
        : `Felt temperature ${effectiveTempC.toFixed(1)}°C is below the ${comfortLowC.toFixed(1)}°C comfort floor and no heating is configured. Chicks will huddle; add supplemental heat.`,
    });
  }

  if (tempDeltaC > 3 && input.ventilation !== "tunnel") {
    recommendations.push({
      severity: "warn",
      title: "Upgrade cooling capacity",
      detail: `Estimated inside temperature is ${tempDeltaC.toFixed(1)}°C above target. Consider tunnel ventilation and/or evaporative cooling pads for this flock weight.`,
    });
  }

  if (age <= 14 && localAirSpeed > 0.3) {
    recommendations.push({
      severity: "warn",
      title: "Reduce draughts on young chicks",
      detail: `At ${age} days chicks cannot regulate heat well. Air speed at bird level should stay under ~0.3 m/s — use minimum ventilation, not tunnel, and check for inlet leaks.`,
    });
  }

  if (providedVentilationM3h < minVentilationM3h) {
    recommendations.push({
      severity: "danger",
      title: "Below minimum ventilation",
      detail: `Estimated airflow ${Math.round(providedVentilationM3h).toLocaleString()} m³/h is under the ${Math.round(minVentilationM3h).toLocaleString()} m³/h air-quality minimum for this live weight. Ammonia, CO₂ and humidity will build up.`,
    });
  }

  if (densityStatus === "danger") {
    recommendations.push({
      severity: "danger",
      title: "Stocking density too high",
      detail: `${densityKgM2.toFixed(1)} kg/m² exceeds the 42 kg/m² welfare ceiling. Reduce bird numbers or plan an earlier partial harvest (thinning).`,
    });
  } else if (densityStatus === "warn") {
    recommendations.push({
      severity: "warn",
      title: "Approaching density limit",
      detail: `${densityKgM2.toFixed(1)} kg/m² is above the 39 kg/m² threshold that requires enhanced environmental control.`,
    });
  }

  if (solarLoadIndex > 0.66 && input.timeOfDay === "day" && input.sky !== "overcast") {
    recommendations.push({
      severity: "info",
      title: "High solar load from orientation",
      detail: `The long axis runs close to N–S, so the ${warmSideLabel} takes strong low-angle sun. Add roof overhang/shade or reflective/insulated cladding; future houses site best on an E–W long axis.`,
    });
  }

  if (ventAlignmentScore < 0.34) {
    recommendations.push({
      severity: "info",
      title: "Ventilation fights the wind",
      detail: input.ventilation === "tunnel"
        ? "The prevailing wind crosses/opposes the exhaust fans, cutting effective airflow. Consider windbreaks or siting fans on the leeward gable."
        : "The prevailing wind runs along the ridge, giving weak cross-flow. Open the windward sidewall fully and consider ridge/chimney outlets.",
    });
  }

  if (heatingLoadKw !== null && heatingLoadKw > 0) {
    recommendations.push({
      severity: "info",
      title: "Heating required",
      detail: `About ${heatingLoadKw.toFixed(1)} kW of supplemental heat is needed to hold ${targetTempC.toFixed(0)}°C against the outside ${input.outsideTempC.toFixed(0)}°C.`,
    });
  }

  if (rh < 40) {
    recommendations.push({
      severity: "info",
      title: "Air is dry",
      detail: `${rh.toFixed(0)}% RH can raise dust and respiratory irritation. Aim for 50–70%; light litter dampening or reduced ventilation can help.`,
    });
  } else if (rh > 75) {
    recommendations.push({
      severity: "warn",
      title: "Humidity is high",
      detail: `${rh.toFixed(0)}% RH promotes wet litter, footpad lesions and ammonia. Increase ventilation to carry moisture out.`,
    });
  }

  if (recommendations.length === 0) {
    recommendations.push({
      severity: "ok",
      title: "Conditions are on target",
      detail: `Felt temperature ${effectiveTempC.toFixed(1)}°C sits inside the ${comfortLowC.toFixed(1)}–${comfortHighC.toFixed(1)}°C comfort band with no stress flags. Keep monitoring as the birds grow.`,
    });
  }

  // Sort most-severe first.
  const rank: Record<Severity, number> = { danger: 0, warn: 1, info: 2, ok: 3 };
  recommendations.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    ageWeeks: age / 7,
    bodyWeightKg,
    targetTempC,
    comfortLowC,
    comfortHighC,
    estimatedInsideTempC,
    effectiveTempC,
    tempDeltaC,
    climateStatus,
    thi,
    heatStress,
    coldStress,
    heatingLoadKw,
    airSpeedCoolingC,
    evapCoolingC,
    solarLiftC,
    minVentilationM3h,
    hotVentilationM3h,
    providedVentilationM3h,
    airChangesPerHour,
    floorAreaM2,
    birdsPerM2,
    densityKgM2,
    densityStatus,
    dailyFeedGPerBird,
    dailyWaterMlPerBird,
    flockDailyFeedKg,
    flockDailyWaterL,
    compass: {
      solarLoadIndex,
      solarLabel,
      ventAlignmentScore,
      ventLabel,
      warmSideLabel,
    },
    recommendations,
  };
}

export const DEFAULT_INPUTS: BroilerInputs = {
  birdAgeDays: 21,
  birdCount: 20000,
  breed: "ross308",
  houseLengthM: 120,
  houseWidthM: 15,
  houseHeightM: 2.7,
  insulation: "average",
  houseOrientationDeg: 90,
  prevailingWindDeg: 0,
  latitudeDeg: 7,
  hemisphere: "N",
  outsideTempC: 30,
  relativeHumidity: 65,
  windSpeedMs: 2,
  sky: "clear",
  timeOfDay: "day",
  ventilation: "tunnel",
  heatingAvailable: true,
  evaporativeCooling: true,
  tunnelAirSpeedMs: 2.5,
};

export const CARDINALS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
export function bearingToCardinal(deg: number): string {
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return CARDINALS[idx];
}
