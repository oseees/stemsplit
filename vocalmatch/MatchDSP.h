#pragma once
#include <juce_dsp/juce_dsp.h>
#include <vector>

namespace match
{

constexpr int   fftOrder  = 12;
constexpr int   fftSize   = 1 << fftOrder;   // 4096
constexpr int   numBins   = fftSize / 2 + 1;
constexpr float maxCorrDb = 12.0f;           // ponytail: hard cap so one bad learn can't wreck the vocal

struct Spectrum
{
    double sampleRate = 0;
    std::vector<float> dB;                   // numBins, average power in dB (unnormalised scale, cancels in diffs)
    float rmsDb = -100.0f;
    float medianDb = -100.0f;                // median short-term loudness
    float spreadDb = 0.0f;                   // p90 - p50 of short-term loudness = dynamics
    bool valid = false;
};

// Compressor ratio that squeezes the input's loudness spread down to the reference's.
inline float compRatio(float refSpread, float inSpread)
{
    if (refSpread <= 0.01f || inSpread <= refSpread)
        return 1.0f;                         // input already as tight or tighter - no expansion, ever
    return juce::jlimit(1.0f, 4.0f, inSpread / refSpread);   // ponytail: 4:1 cap
}

// De-esser: downward compression (~4:1) of the sibilance band's overshoot above threshold. floorDb <= 0 caps it.
inline float deessGainDb(float envDb, float threshDb, float floorDb)
{
    return envDb > threshDb ? juce::jmax(-(envDb - threshDb) * 0.75f, floorDb) : 0.0f;
}

// Breath gate: downward expansion (~3:1) below threshold, so only quiet inter-phrase noise ducks. floorDb <= 0 caps it.
inline float breathGainDb(float envDb, float threshDb, float floorDb)
{
    return envDb < threshDb ? juce::jmax((envDb - threshDb) * 2.0f, floorDb) : 0.0f;
}

// Leveler: ride the short-term level (envDb) fully back to the anchor (setDb) for an even
// vocal. Correction is COMPLETE inside the range cap - the knob widens the range, it does
// not weaken the correction (a scaled correction always leaks loud parts through).
inline float levelerGainDb(float envDb, float setDb, float gateDb, float maxDb)
{
    if (envDb <= gateDb)
        return 0.0f;
    return juce::jlimit(-maxDb, maxDb, setDb - envDb);
}

// Averages Hann-windowed power spectra (50% overlap), skipping near-silent windows.
struct Analyzer
{
    Analyzer() { reset(); }

    void reset()
    {
        std::fill(power.begin(), power.end(), 0.0);
        fifoFill = 0;
        sumSquares = 0;
        windows = 0;
    }

    void addBlock(const float* samples, int n)
    {
        for (int i = 0; i < n; ++i)
        {
            fifo[(size_t) fifoFill++] = samples[i];
            if (fifoFill == fftSize)
            {
                processWindow();
                std::memmove(fifo.data(), fifo.data() + fftSize / 2, sizeof(float) * (size_t)(fftSize / 2));
                fifoFill = fftSize / 2;
            }
        }
    }

    Spectrum finalize(double sampleRate) const
    {
        Spectrum s;
        const int w = windows.load();
        if (w < 4 || sampleRate <= 0)        // need ~0.4s of non-silent signal
            return s;
        s.sampleRate = sampleRate;
        s.dB.resize((size_t) numBins);
        for (int b = 0; b < numBins; ++b)
            s.dB[(size_t) b] = 10.0f * std::log10((float)(power[(size_t) b] / (double) w) + 1.0e-12f);
        s.rmsDb = 10.0f * std::log10((float)(sumSquares / ((double) w * fftSize)) + 1.0e-12f);

        std::vector<float> sorted(windowDb.begin(), windowDb.begin() + std::min(w, maxDynWindows));
        std::sort(sorted.begin(), sorted.end());
        s.medianDb = sorted[sorted.size() / 2];
        s.spreadDb = sorted[(size_t)((double)(sorted.size() - 1) * 0.9)] - s.medianDb;
        s.valid = true;
        return s;
    }

    int windowCount() const { return windows.load(); }

private:
    void processWindow()
    {
        double e = 0;
        for (int i = 0; i < fftSize; ++i)
            e += (double) fifo[(size_t) i] * fifo[(size_t) i];
        if (e / fftSize < 1.0e-6)            // skip silence (< ~-60 dBFS)
            return;

        for (int i = 0; i < fftSize; ++i)
        {
            float w = 0.5f - 0.5f * std::cos(juce::MathConstants<float>::twoPi * (float) i / (float)(fftSize - 1));
            scratch[(size_t) i] = fifo[(size_t) i] * w;
        }
        std::fill(scratch.begin() + fftSize, scratch.end(), 0.0f);
        fft.performFrequencyOnlyForwardTransform(scratch.data());
        for (int b = 0; b < numBins; ++b)
            power[(size_t) b] += (double) scratch[(size_t) b] * scratch[(size_t) b];
        sumSquares += e;
        const int w = windows.load();
        if (w < maxDynWindows)               // ponytail: dynamics stats capped at ~1.5 min of signal
            windowDb[(size_t) w] = 10.0f * std::log10((float)(e / fftSize) + 1.0e-12f);
        ++windows;
    }

    static constexpr int maxDynWindows = 2048;
    juce::dsp::FFT fft { fftOrder };
    std::vector<float> scratch = std::vector<float>((size_t) fftSize * 2);
    std::vector<float> fifo = std::vector<float>((size_t) fftSize);
    std::vector<double> power = std::vector<double>((size_t) numBins);
    std::vector<float> windowDb = std::vector<float>((size_t) maxDynWindows);
    double sumSquares = 0;
    int fifoFill = 0;
    std::atomic<int> windows { 0 };
};

inline float interpDb(const Spectrum& s, double freq)
{
    double bin = freq * (double) fftSize / s.sampleRate;
    if (bin <= 0.0)                     return s.dB[0];
    if (bin >= (double)(numBins - 1))   return s.dB[(size_t)(numBins - 1)];
    auto b0 = (size_t) bin;
    float t = (float)(bin - (double) b0);
    return s.dB[b0] * (1.0f - t) + s.dB[b0 + 1] * t;
}

// Shape-only correction in dB on the target-SR grid (broadband level is handled as a separate gain).
inline std::vector<float> correctionDb(const Spectrum& ref, const Spectrum& in, double targetSR, float amount)
{
    std::vector<float> raw((size_t) numBins), out((size_t) numBins);
    const float refPeak = *std::max_element(ref.dB.begin(), ref.dB.end());
    const float inPeak  = *std::max_element(in.dB.begin(),  in.dB.end());

    for (int b = 0; b < numBins; ++b)
    {
        double f = (double) b * targetSR / (double) fftSize;
        float rDb = interpDb(ref, f), iDb = interpDb(in, f);
        float diff = (rDb - ref.rmsDb) - (iDb - in.rmsDb);
        // only trust the diff where both signals actually have content (within 60 dB of their own peak)
        float margin = std::min(rDb - (refPeak - 60.0f), iDb - (inPeak - 60.0f));
        raw[(size_t) b] = diff * juce::jlimit(0.0f, 1.0f, margin / 12.0f);
    }

    // ponytail: naive O(bins*window) 1/6-octave smoothing - runs once per (re)match, not per sample
    for (int b = 0; b < numBins; ++b)
    {
        double f = std::max(20.0, (double) b * targetSR / (double) fftSize);
        int b0 = std::max(0, (int) std::floor(f / std::pow(2.0, 1.0 / 12.0) * fftSize / targetSR));
        int b1 = std::min(numBins - 1, (int) std::ceil(f * std::pow(2.0, 1.0 / 12.0) * fftSize / targetSR));
        double sum = 0;
        for (int k = b0; k <= b1; ++k)
            sum += raw[(size_t) k];
        float v = (float)(sum / (double)(b1 - b0 + 1));

        float ff = (float)((double) b * targetSR / (double) fftSize);
        float taper = 1.0f;                              // don't invent sub-bass or air on a vocal
        if (ff < 40.0f)          taper = ff / 40.0f;
        else if (ff > 16000.0f)  taper = juce::jmax(0.0f, 1.0f - (ff - 16000.0f) / 4000.0f);

        out[(size_t) b] = juce::jlimit(-maxCorrDb, maxCorrDb, v) * taper * amount;
    }
    return out;
}

// Linear-phase FIR (fftSize taps) whose magnitude follows corrDb. Latency = fftSize/2 samples.
inline std::vector<float> designFir(const std::vector<float>& corrDb)
{
    juce::dsp::FFT fft(fftOrder);
    std::vector<std::complex<float>> spec((size_t) fftSize), td((size_t) fftSize);
    for (int b = 0; b < numBins; ++b)
    {
        float mag = std::pow(10.0f, corrDb[(size_t) b] / 20.0f);
        spec[(size_t) b] = { mag, 0.0f };
        if (b > 0 && b < fftSize / 2)
            spec[(size_t)(fftSize - b)] = { mag, 0.0f };   // conjugate-symmetric -> real impulse
    }
    fft.perform(spec.data(), td.data(), true);
    std::vector<float> fir((size_t) fftSize);
    for (int i = 0; i < fftSize; ++i)
    {
        float w = 0.5f - 0.5f * std::cos(juce::MathConstants<float>::twoPi * (float) i / (float)(fftSize - 1));
        fir[(size_t) i] = td[(size_t)((i + fftSize / 2) % fftSize)].real() * w;   // centre + window
    }
    return fir;
}

} // namespace match
