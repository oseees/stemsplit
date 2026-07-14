// Smallest check that fails if the chain math breaks. Format-level plugin
// validation is auval's job; this covers the custom gain computers + preset blend.
#include "ChainDSP.h"
#include <cassert>
#include <cstdio>
#include <cmath>

int main()
{
    using namespace chain;

    // blend endpoints: Amount 0 = neutral, Amount 1 = the recipe
    for (auto& p : presets)
    {
        auto n = blend(p, 0.0f);
        assert(std::abs(n.mudDb) < 1e-6f && std::abs(n.airDb) < 1e-6f);
        assert(std::abs(n.c1Ratio - 1.0f) < 1e-6f && std::abs(n.c2Ratio - 1.0f) < 1e-6f);
        assert(n.satDrive == 0.0f && n.slapWet == 0.0f && n.verbWet == 0.0f && n.deess == 0.0f);
        auto f = blend(p, 1.0f);
        assert(std::abs(f.airDb - p.airDb) < 1e-6f && std::abs(f.c1Ratio - p.c1Ratio) < 1e-6f);
        assert(std::abs(f.hpfHz - p.hpfHz) < 1e-3f);
    }

    // saturation: unity at zero drive, never louder than input, odd symmetry
    assert(satShape(0.5f, 0.0f) == 0.5f);
    assert(std::abs(satShape(0.5f, 0.3f)) < 0.5f);
    assert(satShape(-0.5f, 0.3f) == -satShape(0.5f, 0.3f));
    assert(std::abs(satShape(0.01f, 0.3f) - 0.01f) < 0.001f);   // transparent when quiet

    // de-esser computer: silent below threshold, ducks above, capped at floor
    assert(deessGainDb(-30.0f, -25.0f, -14.0f) == 0.0f);
    assert(deessGainDb(-15.0f, -25.0f, -14.0f) < 0.0f);
    assert(deessGainDb(0.0f, -25.0f, -14.0f) == -14.0f);

    // gain-stager: gated in silence, rides toward target, clamped to range
    assert(levelerGainDb(-60.0f, -18.0f, -55.0f, 12.0f) == 0.0f);
    assert(levelerGainDb(-40.0f, -18.0f, -55.0f, 12.0f) == 12.0f);
    assert(std::abs(levelerGainDb(-20.0f, -18.0f, -55.0f, 12.0f) - 2.0f) < 1e-6f);
    assert(std::abs(levelerGainDb(-10.0f, -18.0f, -55.0f, 12.0f) + 8.0f) < 1e-6f);

    std::printf("TestChain: all assertions passed (%d presets)\n", numPresets);
    return 0;
}
