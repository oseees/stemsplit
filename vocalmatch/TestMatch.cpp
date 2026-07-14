// Self-check: reference is +6 dB at 100-400 Hz vs the vocal; the designed FIR must
// boost ~+6 dB there and stay flat elsewhere. Catches any FFT-scaling or curve bug.
#include "MatchDSP.h"
#include <cstdio>

static bool near(double a, double b, double tol) { return std::abs(a - b) <= tol; }

int main()
{
    match::Spectrum ref, in;
    ref.sampleRate = in.sampleRate = 48000;
    ref.valid = in.valid = true;
    ref.rmsDb = in.rmsDb = -20.0f;
    ref.dB.assign((size_t) match::numBins, -20.0f);
    in.dB.assign((size_t) match::numBins, -20.0f);
    for (int b = 0; b < match::numBins; ++b)
    {
        double f = b * 48000.0 / match::fftSize;
        if (f >= 100 && f <= 400)
            ref.dB[(size_t) b] = -14.0f;
    }

    auto fir = match::designFir(match::correctionDb(ref, in, 48000, 1.0f));

    juce::dsp::FFT fft(match::fftOrder);
    std::vector<float> buf((size_t) match::fftSize * 2, 0.0f);
    std::copy(fir.begin(), fir.end(), buf.begin());
    fft.performFrequencyOnlyForwardTransform(buf.data());
    auto dbAt = [&](double f)
    {
        int b = (int) std::round(f * match::fftSize / 48000.0);
        return 20.0 * std::log10(buf[(size_t) b] + 1e-9);
    };

    double g200 = dbAt(200), g4k = dbAt(4000);
    std::printf("FIR response: 200 Hz = %+.2f dB (want +6), 4 kHz = %+.2f dB (want 0)\n", g200, g4k);
    if (!near(g200, 6.0, 1.5) || !near(g4k, 0.0, 1.0))
    {
        std::printf("FAIL\n");
        return 1;
    }

    // dynamics match: ref spread 5 dB vs vocal 10 dB -> 2:1; never expands; capped at 4:1
    if (!near(match::compRatio(5.0f, 10.0f), 2.0, 0.01)
        || !near(match::compRatio(10.0f, 5.0f), 1.0, 0.01)
        || !near(match::compRatio(2.0f, 20.0f), 4.0, 0.01))
    {
        std::printf("FAIL compRatio\n");
        return 1;
    }

    // de-ess: 8 dB over threshold -> -6 dB (4:1); below threshold untouched; floor caps it
    if (!near(match::deessGainDb(-22.0f, -30.0f, -14.0f), -6.0, 0.01)   // 8 over * 0.75
        || !near(match::deessGainDb(-40.0f, -30.0f, -14.0f), 0.0, 0.01) // below thresh
        || !near(match::deessGainDb(0.0f,   -30.0f, -14.0f), -14.0, 0.01)) // clamped to floor
    {
        std::printf("FAIL deessGainDb\n");
        return 1;
    }

    // breath: 5 dB under threshold -> -10 dB (3:1); above threshold untouched; floor caps it
    if (!near(match::breathGainDb(-50.0f, -45.0f, -24.0f), -10.0, 0.01)  // 5 under * 2
        || !near(match::breathGainDb(-30.0f, -45.0f, -24.0f), 0.0, 0.01) // above thresh
        || !near(match::breathGainDb(-90.0f, -45.0f, -24.0f), -24.0, 0.01)) // clamped to floor
    {
        std::printf("FAIL breathGainDb\n");
        return 1;
    }

    // leveler: FULL correction - env 10 dB under anchor -> +10; 10 over -> -10;
    // gated below -55; capped at ±maxDb
    if (!near(match::levelerGainDb(-30.0f, -20.0f, -55.0f, 12.0f), 10.0, 0.01)   // 10 under
        || !near(match::levelerGainDb(-10.0f, -20.0f, -55.0f, 12.0f), -10.0, 0.01) // 10 over
        || !near(match::levelerGainDb(-60.0f, -20.0f, -55.0f, 12.0f), 0.0, 0.01)   // gated
        || !near(match::levelerGainDb(-40.0f, -10.0f, -55.0f, 12.0f), 12.0, 0.01))  // 30 under -> capped
    {
        std::printf("FAIL levelerGainDb\n");
        return 1;
    }

    std::printf("OK\n");
    return 0;
}
