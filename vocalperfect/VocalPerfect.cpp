// VocalPerfect: one-click vocal chain for Afrobeats & R&B.
// Fixed pro chain (the order the top mixers use), auto gain-staged input,
// presets = engineer recipes. Pick a preset, vocal is mixed.
#include <juce_audio_utils/juce_audio_utils.h>
#include "ChainDSP.h"

class VocalPerfectProcessor : public juce::AudioProcessor
{
public:
    VocalPerfectProcessor()
        : AudioProcessor(BusesProperties()
              .withInput("Input", juce::AudioChannelSet::stereo(), true)
              .withOutput("Output", juce::AudioChannelSet::stereo(), true))
    {
        juce::StringArray names;
        for (auto& p : chain::presets) names.add(p.name);
        addParameter(preset = new juce::AudioParameterChoice({ "preset", 1 }, "Preset", names, 0));
        addParameter(amount = new juce::AudioParameterFloat({ "amount", 1 }, "Amount", 0.0f, 1.0f, 1.0f));
        addParameter(space  = new juce::AudioParameterFloat({ "space",  1 }, "Space",  0.0f, 2.0f, 1.0f));
        addParameter(out    = new juce::AudioParameterFloat({ "out",    1 }, "Output",-12.0f, 12.0f, 0.0f));
    }

    void prepareToPlay(double sr, int samplesPerBlock) override
    {
        currentSR = sr;
        juce::dsp::ProcessSpec spec { sr, (juce::uint32) samplesPerBlock,
                                      (juce::uint32) std::max(1, getTotalNumOutputChannels()) };
        for (auto* f : { &hpf, &mud, &box, &warm, &pres, &air }) f->prepare(spec);

        comp1.prepare(spec);                     // FET role: catch peaks fast
        comp1.setAttack(1.5f);  comp1.setRelease(80.0f);
        comp2.prepare(spec);                     // opto role: slow density/glue
        comp2.setAttack(15.0f); comp2.setRelease(300.0f);

        deessLR.prepare(spec);
        deessLR.setType(juce::dsp::LinkwitzRileyFilterType::allpass);
        deessLR.setCutoffFrequency(6500.0f);     // sibilance lives above ~6.5 kHz
        deessEnv.prepare(spec);
        deessEnv.setLevelCalculationType(juce::dsp::BallisticsFilterLevelCalculationType::peak);
        deessEnv.setAttackTime(0.5f);
        deessEnv.setReleaseTime(60.0f);

        levelEnv.prepare(spec);                  // syllable-rate RMS for the gain-stager
        levelEnv.setLevelCalculationType(juce::dsp::BallisticsFilterLevelCalculationType::RMS);
        levelEnv.setAttackTime(50.0f);
        levelEnv.setReleaseTime(300.0f);
        levelSmoothDb = 0.0f;

        gain.prepare(spec);
        gain.setRampDurationSeconds(0.05);
        limiter.prepare(spec);
        limiter.setThreshold(-1.0f);             // safety ceiling, not an effect
        limiter.setRelease(100.0f);
        reverb.prepare(spec);

        juce::dsp::ProcessSpec mono { sr, (juce::uint32) samplesPerBlock, 1 };
        slap.prepare(mono);
        slap.setMaximumDelayInSamples((int) (0.3 * sr) + 1);
        slapLP = 0.0f;
        slapLPCoef = 1.0f - std::exp(-juce::MathConstants<float>::twoPi * 3500.0f / (float) sr);

        builtPreset = -1;                        // force rebuild with real sample rate
        rebuild(preset->getIndex(), amount->get());
    }

    void releaseResources() override {}

    bool isBusesLayoutSupported(const BusesLayout& l) const override
    {
        auto in = l.getMainInputChannelSet();
        return in == l.getMainOutputChannelSet()
            && (in == juce::AudioChannelSet::mono() || in == juce::AudioChannelSet::stereo());
    }

    void processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer&) override
    {
        juce::ScopedNoDenormals noDenormals;
        const int n  = buffer.getNumSamples();
        const int ch = buffer.getNumChannels();
        const float amt = amount->get(), spc = space->get();

        // ponytail: coefficient rebuild allocates on the audio thread - fires only on preset/knob change
        if (preset->getIndex() != builtPreset || std::abs(amt - builtAmount) > 0.005f)
            rebuild(preset->getIndex(), amt);

        // 1. Auto gain-stage to -18 dBFS RMS (Jaycen: the chain is fixed, the INPUT moves).
        //    Asymmetric ride (fast down, gentle up), frozen during silence -> no swell/re-ramp.
        const float maxRide = 12.0f * amt;
        if (maxRide > 0.05f)
        {
            const float sr = (float) std::max(1.0, currentSR);
            const float downCoef = std::exp(-1.0f / (0.040f * sr));
            const float upCoef   = std::exp(-1.0f / (0.200f * sr));
            float sm = levelSmoothDb;
            for (int i = 0; i < n; ++i)
            {
                float m = 0;
                for (int c = 0; c < ch; ++c)
                    m += buffer.getReadPointer(c)[i];
                m = std::abs(m / (float) ch);
                float envDb = juce::Decibels::gainToDecibels(levelEnv.processSample(0, m));
                if (envDb > -55.0f)              // gated: hold gain through silence
                {
                    float target = chain::levelerGainDb(envDb, -18.0f, -55.0f, maxRide);
                    sm = target + (target < sm ? downCoef : upCoef) * (sm - target);
                }
                float g = juce::Decibels::decibelsToGain(sm);
                for (int c = 0; c < ch; ++c)
                    buffer.getWritePointer(c)[i] *= g;
            }
            levelSmoothDb = sm;
        }

        juce::dsp::AudioBlock<float> block(buffer);
        juce::dsp::ProcessContextReplacing<float> ctx(block);

        // 2. Subtractive first (Marroquin/Ali): tight lows, cut mud & box before compressing.
        hpf.process(ctx);
        mud.process(ctx);
        box.process(ctx);

        // 3. De-ess BEFORE the comps so esses don't drive them (MixedByAli).
        const float de = cur.deess;
        if (de > 0.001f)
        {
            const float deThresh = -20.0f - 16.0f * de;
            const float deFloor  = -14.0f * de;
            for (int c = 0; c < ch; ++c)
            {
                float* d = buffer.getWritePointer(c);
                for (int i = 0; i < n; ++i)
                {
                    float lo, hi;
                    deessLR.processSample(c, d[i], lo, hi);
                    float envDb = juce::Decibels::gainToDecibels(deessEnv.processSample(c, std::abs(hi)));
                    hi *= juce::Decibels::decibelsToGain(chain::deessGainDb(envDb, deThresh, deFloor));
                    d[i] = lo + hi;
                }
            }
        }

        // 4-5. Serial compression (Jaycen): two comps a few dB each beat one doing all the work.
        if (cur.c1Ratio > 1.01f) comp1.process(ctx);
        if (cur.c2Ratio > 1.01f) comp2.process(ctx);

        // 6. Saturation for harmonics/density.
        if (cur.satDrive > 0.001f)
            for (int c = 0; c < ch; ++c)
            {
                float* d = buffer.getWritePointer(c);
                for (int i = 0; i < n; ++i)
                    d[i] = chain::satShape(d[i], cur.satDrive);
            }

        // 7. Additive after compression: warmth, presence, air.
        warm.process(ctx);
        pres.process(ctx);
        air.process(ctx);

        // 8. Makeup for the comps' gain reduction + user trim.
        gain.setGainDecibels(cur.outDb + out->get());
        gain.process(ctx);

        // 9. Mono slap delay (Afrobeats staple), darkened repeats.
        const float sw = cur.slapWet * spc;
        if (sw > 0.001f)
        {
            for (int i = 0; i < n; ++i)
            {
                float in = 0;
                for (int c = 0; c < ch; ++c)
                    in += buffer.getReadPointer(c)[i];
                in /= (float) ch;
                float d = slap.popSample(0);
                slapLP += slapLPCoef * (d - slapLP);      // darken every repeat, first one included
                slap.pushSample(0, in + slapLP * 0.3f);
                for (int c = 0; c < ch; ++c)
                    buffer.getWritePointer(c)[i] += slapLP * sw;
            }
        }

        // 10. Plate-ish reverb.
        const float vw = cur.verbWet * spc;
        if (vw > 0.001f)
        {
            juce::Reverb::Parameters rp;
            rp.roomSize = cur.verbSize;
            rp.damping  = cur.verbDamp;
            rp.width    = 1.0f;
            rp.wetLevel = juce::jmin(1.0f, vw);
            rp.dryLevel = 1.0f;
            reverb.setParameters(rp);
            reverb.process(ctx);
        }

        // 11. Safety limiter: "perfect" never clips.
        limiter.process(ctx);
    }

    void rebuild(int pi, float amt)
    {
        pi = juce::jlimit(0, chain::numPresets - 1, pi);
        cur = chain::blend(chain::presets[pi], amt);
        builtPreset = pi;
        builtAmount = amt;
        if (currentSR <= 0)
            return;
        using C = juce::dsp::IIR::Coefficients<float>;
        auto g = [](float db) { return juce::Decibels::decibelsToGain(db); };
        *hpf.state  = *C::makeHighPass  (currentSR, cur.hpfHz);
        *mud.state  = *C::makePeakFilter(currentSR, cur.mudHz,  1.4f, g(cur.mudDb));
        *box.state  = *C::makePeakFilter(currentSR, cur.boxHz,  2.0f, g(cur.boxDb));
        *warm.state = *C::makeLowShelf  (currentSR, cur.warmHz, 0.7f, g(cur.warmDb));
        *pres.state = *C::makePeakFilter(currentSR, cur.presHz, 1.0f, g(cur.presDb));
        *air.state  = *C::makeHighShelf (currentSR, cur.airHz,  0.7f, g(cur.airDb));
        comp1.setThreshold(cur.c1Thresh); comp1.setRatio(cur.c1Ratio);
        comp2.setThreshold(cur.c2Thresh); comp2.setRatio(cur.c2Ratio);
        slap.setDelay((float) (cur.slapMs * 0.001 * currentSR));
    }

    //=== state =========================================================
    void getStateInformation(juce::MemoryBlock& dest) override
    {
        juce::MemoryOutputStream mos(dest, false);
        mos.writeInt(1);
        mos.writeInt(preset->getIndex());
        mos.writeFloat(amount->get());
        mos.writeFloat(space->get());
        mos.writeFloat(out->get());
    }

    void setStateInformation(const void* data, int size) override
    {
        juce::MemoryInputStream mis(data, (size_t) size, false);
        if (mis.readInt() != 1)
            return;
        *preset = mis.readInt();
        *amount = mis.readFloat();
        *space  = mis.readFloat();
        *out    = mis.readFloat();
    }

    //=== boilerplate ===================================================
    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 2.0; }
    // presets double as DAW programs so hosts show them natively
    int getNumPrograms() override { return chain::numPresets; }
    int getCurrentProgram() override { return preset->getIndex(); }
    void setCurrentProgram(int i) override { *preset = juce::jlimit(0, chain::numPresets - 1, i); }
    const juce::String getProgramName(int i) override { return chain::presets[juce::jlimit(0, chain::numPresets - 1, i)].name; }
    void changeProgramName(int, const juce::String&) override {}
    bool hasEditor() const override { return true; }
    juce::AudioProcessorEditor* createEditor() override;

    juce::AudioParameterChoice* preset = nullptr;
    juce::AudioParameterFloat* amount = nullptr;
    juce::AudioParameterFloat* space = nullptr;
    juce::AudioParameterFloat* out = nullptr;

private:
    using Filt = juce::dsp::ProcessorDuplicator<juce::dsp::IIR::Filter<float>,
                                                juce::dsp::IIR::Coefficients<float>>;
    double currentSR = 0;
    chain::Preset cur = chain::blend(chain::presets[0], 1.0f);
    int builtPreset = -1;
    float builtAmount = -1.0f;
    float levelSmoothDb = 0, slapLP = 0, slapLPCoef = 0;

    Filt hpf, mud, box, warm, pres, air;
    juce::dsp::Compressor<float> comp1, comp2;
    juce::dsp::LinkwitzRileyFilter<float> deessLR;
    juce::dsp::BallisticsFilter<float> deessEnv, levelEnv;
    juce::dsp::Gain<float> gain;
    juce::dsp::Limiter<float> limiter;
    juce::dsp::Reverb reverb;
    juce::dsp::DelayLine<float> slap;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(VocalPerfectProcessor)
};

//======================================================================
class VocalPerfectEditor : public juce::AudioProcessorEditor
{
public:
    explicit VocalPerfectEditor(VocalPerfectProcessor& pr) : AudioProcessorEditor(pr), p(pr)
    {
        for (int i = 0; i < chain::numPresets; ++i)
            presetBox.addItem(chain::presets[i].name, i + 1);
        addAndMakeVisible(presetBox);
        presetAttach = std::make_unique<juce::ComboBoxParameterAttachment>(*p.preset, presetBox);

        desc.setJustificationType(juce::Justification::centredLeft);
        desc.setColour(juce::Label::textColourId, juce::Colours::grey);
        desc.setFont(juce::Font(12.0f));
        addAndMakeVisible(desc);
        auto updateDesc = [this]
        {
            int i = juce::jlimit(0, chain::numPresets - 1, presetBox.getSelectedItemIndex());
            desc.setText(chain::presets[i].blurb, juce::dontSendNotification);
        };
        presetBox.onChange = updateDesc;   // fires on user picks AND host automation via the attachment
        updateDesc();

        auto setupKnob = [this](juce::Slider& s, juce::Label& l, const char* name)
        {
            s.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
            s.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 64, 18);
            addAndMakeVisible(s);
            l.setText(name, juce::dontSendNotification);
            l.setJustificationType(juce::Justification::centred);
            addAndMakeVisible(l);
        };
        setupKnob(amountSlider, amountLabel, "Amount");
        setupKnob(spaceSlider,  spaceLabel,  "Space");
        setupKnob(outSlider,    outLabel,    "Output");
        amountAttach = std::make_unique<juce::SliderParameterAttachment>(*p.amount, amountSlider);
        spaceAttach  = std::make_unique<juce::SliderParameterAttachment>(*p.space,  spaceSlider);
        outAttach    = std::make_unique<juce::SliderParameterAttachment>(*p.out,    outSlider);

        setSize(420, 262);
    }

private:
    void paint(juce::Graphics& g) override
    {
        g.fillAll(getLookAndFeel().findColour(juce::ResizableWindow::backgroundColourId));
        g.setColour(juce::Colours::white);
        g.setFont(juce::Font(18.0f, juce::Font::bold));
        g.drawText("VocalPerfect", 14, 10, 200, 22, juce::Justification::left);
        g.setColour(juce::Colours::grey);
        g.setFont(12.0f);
        g.drawText("afrobeats & r&b vocal chain", 132, 14, 220, 18, juce::Justification::left);
    }

    void resized() override
    {
        auto r = getLocalBounds().reduced(14);
        r.removeFromTop(30);
        presetBox.setBounds(r.removeFromTop(30));
        desc.setBounds(r.removeFromTop(20));
        r.removeFromTop(4);
        const int kw = r.getWidth() / 3;
        juce::Slider* sliders[] = { &amountSlider, &spaceSlider, &outSlider };
        juce::Label*  labels[]  = { &amountLabel,  &spaceLabel,  &outLabel  };
        for (int i = 0; i < 3; ++i)
        {
            auto cell = r.removeFromLeft(kw);
            labels[i]->setBounds(cell.removeFromTop(18));
            sliders[i]->setBounds(cell);
        }
    }

    VocalPerfectProcessor& p;
    juce::ComboBox presetBox;
    juce::Slider amountSlider, spaceSlider, outSlider;
    juce::Label amountLabel, spaceLabel, outLabel, desc;
    std::unique_ptr<juce::ComboBoxParameterAttachment> presetAttach;
    std::unique_ptr<juce::SliderParameterAttachment> amountAttach, spaceAttach, outAttach;
};

juce::AudioProcessorEditor* VocalPerfectProcessor::createEditor() { return new VocalPerfectEditor(*this); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VocalPerfectProcessor(); }
