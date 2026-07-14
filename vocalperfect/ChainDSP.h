// VocalPerfect chain math: preset table + the pure gain computers.
// Kept header-only so TestChain can assert on it without building the plugin.
#pragma once
#include <juce_dsp/juce_dsp.h>

namespace chain
{

// One vocal chain "recipe". Values are what the chain sounds like at Amount = 1.
struct Preset
{
    const char* name;
    const char* blurb;                 // one-liner shown in the UI
    float hpfHz;                       // high-pass (tight lows)
    float mudHz, mudDb, boxHz, boxDb;  // subtractive EQ (Marroquin/Ali: cut before compressing)
    float deess;                       // 0..1 de-esser depth (before comps, MixedByAli style)
    float c1Thresh, c1Ratio;           // fast FET-style peak catcher (1176 role)
    float c2Thresh, c2Ratio;           // slow opto-style density (LA-2A role; Jaycen serial pair)
    float satDrive;                    // 0..1 tanh saturation for harmonics/density
    float warmHz, warmDb;              // additive low shelf (Maserati warmth)
    float presHz, presDb;              // presence bell (Pensado 3-5 kHz)
    float airHz, airDb;                // air shelf (Afrobeats 11-14 kHz sheen)
    float slapMs, slapWet;             // mono slap delay (Afrobeats staple)
    float verbWet, verbSize, verbDamp; // plate-ish reverb
    float outDb;                       // makeup for the compressors' gain reduction
};

// Comp thresholds assume the gain-stager has parked the vocal at -18 dBFS RMS
// (peaks ~ -8): c1 catches ~3 dB on peaks, c2 adds ~2-4 dB of slow density -
// the "few dB per stage" serial approach, not one comp doing all the work.
static const Preset presets[] = {
//  name               blurb                                            hpf   mudHz mudDb boxHz boxDb  dees  c1Th  c1R   c2Th  c2R   sat    warmHz warmDb presHz presDb airHz  airDb  slap  sWet   vWet   vSize  vDamp  out
{ "Afro Lead",       "Bright airy lead - slap delay + short plate",     100,  300, -3.5f, 800, -2.0f, 0.60f, -12, 4.0f, -22, 2.5f, 0.25f,  200,  0.0f, 4000,  2.5f, 11000, 4.0f,  120, 0.16f, 0.10f, 0.45f, 0.40f, 3.5f },
{ "Afro Adlib",      "Wetter and brighter - sits behind the lead",      150,  320, -3.0f, 800, -2.0f, 0.60f, -11, 4.0f, -21, 2.5f, 0.35f,  200,  0.0f, 4500,  2.0f, 11000, 5.0f,  130, 0.28f, 0.18f, 0.50f, 0.35f, 3.5f },
{ "RnB Silk",        "Smooth serial compression, silky air",             85,  250, -3.0f, 700, -1.5f, 0.70f, -13, 4.0f, -24, 3.0f, 0.15f,  200,  1.0f, 3500,  1.5f, 13500, 3.5f,    0, 0.00f, 0.14f, 0.55f, 0.55f, 4.5f },
{ "RnB Warm Ballad", "Warm low shelf, gentle opto, bigger verb",         75,  350, -2.0f, 700, -1.0f, 0.50f, -10, 3.0f, -20, 2.0f, 0.20f,  220,  2.0f, 3000,  1.0f, 12000, 2.5f,    0, 0.00f, 0.20f, 0.70f, 0.60f, 2.5f },
{ "Presence Pop",    "Upfront and dry - deep cuts, hot presence",        95,  300, -4.0f, 900, -2.5f, 0.65f, -12, 4.0f, -22, 2.5f, 0.30f,  200,  0.0f, 4500,  3.5f, 11000, 3.0f,    0, 0.00f, 0.06f, 0.40f, 0.50f, 3.5f },
{ "Clean",           "Light polish for already-good vocals",             80,  300, -1.5f, 800, -0.5f, 0.40f,  -9, 2.5f, -18, 2.0f, 0.00f,  200,  0.0f, 4000,  1.0f, 11000, 1.5f,    0, 0.00f, 0.04f, 0.40f, 0.50f, 1.5f },
};
constexpr int numPresets = (int) (sizeof(presets) / sizeof(presets[0]));

inline float lerp(float a, float b, float t) { return a + (b - a) * t; }

// Scale a preset by Amount: 0 = neutral pass-through, 1 = the full recipe.
// Gains/depths/wets scale linearly; ratios lerp to 1:1; thresholds stay put
// (a 1:1 ratio already disables the comp, and moving thresholds re-tunes attack feel).
inline Preset blend(Preset p, float t)
{
    p.hpfHz    = lerp(20.0f, p.hpfHz, t);
    p.mudDb   *= t;  p.boxDb  *= t;  p.deess  *= t;
    p.c1Ratio  = lerp(1.0f, p.c1Ratio, t);
    p.c2Ratio  = lerp(1.0f, p.c2Ratio, t);
    p.satDrive*= t;  p.warmDb *= t;  p.presDb *= t;  p.airDb *= t;
    p.slapWet *= t;  p.verbWet*= t;  p.outDb  *= t;
    return p;
}

// Soft saturation with unity small-signal gain: transparent at low level,
// harmonics + peak rounding as the vocal pushes. drive <= ~0.35 in the presets.
inline float satShape(float x, float drive)
{
    if (drive <= 0.0001f) return x;
    const float g = 1.0f + 3.0f * drive;
    return std::tanh(g * x) / g;
}

// De-esser gain computer (same curve as VocalMatch, proven on real vocals):
// above threshold the band ducks at ~4:1, capped at floorDb.
inline float deessGainDb(float envDb, float threshDb, float floorDb)
{
    return envDb > threshDb ? juce::jmax(-(envDb - threshDb) * 0.75f, floorDb) : 0.0f;
}

// Gain-staging computer (the Jaycen Joshua move): ride the input fully to the
// chain's design level so the fixed thresholds downstream always land right.
// Gated below gateDb, correction clamped to +/- maxDb.
inline float levelerGainDb(float envDb, float targetDb, float gateDb, float maxDb)
{
    if (envDb <= gateDb)
        return 0.0f;
    return juce::jlimit(-maxDb, maxDb, targetDb - envDb);
}

} // namespace chain
