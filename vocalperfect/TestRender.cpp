// Full-chain integration check: renders a synthetic vocal through the REAL
// processor (same code the plugin ships) and asserts the promises hold:
// quiet and hot takes come out at matched level, output never clips or NaNs,
// and the chain actually produces signal. TestChain covers the pure math;
// this covers the wiring.
#define JucePlugin_Name "VocalPerfect"
#include "VocalPerfect.cpp"

#include <cassert>
#include <cstdio>

static float rmsDb(const juce::AudioBuffer<float>& b, int start, int len)
{
    double sum = 0;
    for (int c = 0; c < b.getNumChannels(); ++c)
        for (int i = start; i < start + len; ++i)
            sum += (double) b.getSample(c, i) * b.getSample(c, i);
    return juce::Decibels::gainToDecibels((float) std::sqrt(sum / (len * b.getNumChannels())), -120.0f);
}

int main()
{
    const double sr = 48000.0;
    const int block = 512, secs = 6, total = (int) sr * secs;

    // Vocal-ish source: harmonic stack at 180 Hz with vibrato.
    // 0-2 s quiet take (-30 dB-ish), 2-4 s silence, 4-6 s hot take (-12 dB-ish).
    juce::AudioBuffer<float> audio(2, total);
    for (int i = 0; i < total; ++i)
    {
        double t = i / sr;
        float f0 = 180.0f * (1.0f + 0.01f * std::sin(2.0 * juce::MathConstants<double>::pi * 5.0 * t));
        float s = 0.5f * std::sin(2.0 * juce::MathConstants<double>::pi * f0 * t)
                + 0.25f * std::sin(2.0 * juce::MathConstants<double>::pi * 2 * f0 * t)
                + 0.12f * std::sin(2.0 * juce::MathConstants<double>::pi * 3 * f0 * t);
        float g = t < 2.0 ? 0.045f : (t < 4.0 ? 0.0f : 0.36f);   // ~18 dB apart
        audio.setSample(0, i, s * g);
        audio.setSample(1, i, s * g);
    }
    const float inQuiet = rmsDb(audio, (int) (0.5 * sr), (int) (1.5 * sr));
    const float inHot   = rmsDb(audio, (int) (4.5 * sr), (int) (1.5 * sr));

    VocalPerfectProcessor p;                       // defaults: Afro Lead, Amount 1, Space 1
    p.setPlayConfigDetails(2, 2, sr, block);
    p.prepareToPlay(sr, block);

    juce::MidiBuffer midi;
    for (int pos = 0; pos < total; pos += block)
    {
        int n = std::min(block, total - pos);
        juce::AudioBuffer<float> chunk(audio.getArrayOfWritePointers(), 2, pos, n);
        p.processBlock(chunk, midi);
    }

    // 1. sane samples everywhere: finite, never past full scale
    float peak = 0;
    for (int c = 0; c < 2; ++c)
        for (int i = 0; i < total; ++i)
        {
            float v = audio.getSample(c, i);
            assert(std::isfinite(v));
            peak = std::max(peak, std::abs(v));
        }
    assert(peak <= 1.0f);
    assert(peak > 0.05f);                          // chain produces real signal

    // steady-state (leveler settled) must sit under the -1 dB ceiling, not ride the clamp
    float ssPeak = 0;
    for (int c = 0; c < 2; ++c)
        for (int i = (int) (5.0 * sr); i < total; ++i)
            ssPeak = std::max(ssPeak, std::abs(audio.getSample(c, i)));
    assert(ssPeak < 0.95f);

    // 2. gain-staging works: an 18 dB input gap collapses at the output
    const float outQuiet = rmsDb(audio, (int) (0.5 * sr), (int) (1.5 * sr));
    const float outHot   = rmsDb(audio, (int) (4.5 * sr), (int) (1.5 * sr));
    const float inGap = inHot - inQuiet, outGap = std::abs(outHot - outQuiet);
    assert(inGap > 15.0f);                         // the test signal really is far apart
    assert(outGap < 8.0f);                         // ...and the chain pulls it together
    assert(outHot > -30.0f);                       // not squashed into silence

    // 3. every preset renders clean at full Amount
    for (int pi = 0; pi < chain::numPresets; ++pi)
    {
        VocalPerfectProcessor q;
        q.setPlayConfigDetails(2, 2, sr, block);
        q.prepareToPlay(sr, block);
        *q.preset = pi;
        juce::AudioBuffer<float> buf(2, block);
        for (int rep = 0; rep < 200; ++rep)        // ~2 s per preset
        {
            for (int i = 0; i < block; ++i)
            {
                double t = (rep * block + i) / sr;
                float v = 0.3f * std::sin(2.0 * juce::MathConstants<double>::pi * 200.0 * t);
                buf.setSample(0, i, v);
                buf.setSample(1, i, v);
            }
            q.processBlock(buf, midi);
            for (int i = 0; i < block; ++i)
            {
                assert(std::isfinite(buf.getSample(0, i)));
                assert(std::abs(buf.getSample(0, i)) <= 1.0f);
            }
        }
    }

    std::printf("TestRender: chain OK  in gap %.1f dB -> out gap %.1f dB, peak %.2f (steady %.2f), %d presets clean\n",
                inGap, outGap, peak, ssPeak, chain::numPresets);
    return 0;
}
