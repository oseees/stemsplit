#include <juce_audio_utils/juce_audio_utils.h>
#include "MatchDSP.h"

class VocalMatchProcessor : public juce::AudioProcessor
{
public:
    VocalMatchProcessor()
        : AudioProcessor(BusesProperties()
              .withInput("Input", juce::AudioChannelSet::stereo(), true)
              .withOutput("Output", juce::AudioChannelSet::stereo(), true))
    {
        addParameter(amount = new juce::AudioParameterFloat({ "amount", 1 }, "Amount", 0.0f, 1.0f, 1.0f));
        addParameter(reverbMix = new juce::AudioParameterFloat({ "reverb", 1 }, "Reverb", 0.0f, 1.0f, 0.0f));
        addParameter(deess = new juce::AudioParameterFloat({ "deess", 1 }, "De-ess", 0.0f, 1.0f, 0.0f));
        addParameter(breath = new juce::AudioParameterFloat({ "breath", 1 }, "Breath", 0.0f, 1.0f, 0.0f));
        addParameter(level = new juce::AudioParameterFloat({ "level", 1 }, "Level", 0.0f, 1.0f, 0.0f));
        addParameter(harsh = new juce::AudioParameterFloat({ "harsh", 1 }, "Harsh", 0.0f, 1.0f, 0.0f));
        formats.registerBasicFormats();
    }

    void prepareToPlay(double sr, int samplesPerBlock) override
    {
        currentSR = sr;
        monoScratch.resize((size_t) std::max(1, samplesPerBlock));
        juce::dsp::ProcessSpec spec { sr, (juce::uint32) samplesPerBlock,
                                      (juce::uint32) std::max(1, getTotalNumOutputChannels()) };
        conv.prepare(spec);
        gain.prepare(spec);
        gain.setRampDurationSeconds(0.05);
        comp.prepare(spec);
        comp.setAttack(10.0f);
        comp.setRelease(120.0f);
        reverb.prepare(spec);

        deessLR.prepare(spec);
        deessLR.setType(juce::dsp::LinkwitzRileyFilterType::allpass);
        deessLR.setCutoffFrequency(6500.0f);          // sibilance splits above ~6.5 kHz

        // Harshness band = 2.5-6.5 kHz (below the de-esser's band). Two LR splits isolate it;
        // LR crossovers sum back flat, so the band is only touched when it's actually hot.
        harshLR1.prepare(spec);
        harshLR1.setType(juce::dsp::LinkwitzRileyFilterType::allpass);
        harshLR1.setCutoffFrequency(2500.0f);
        harshLR2.prepare(spec);
        harshLR2.setType(juce::dsp::LinkwitzRileyFilterType::allpass);
        harshLR2.setCutoffFrequency(6500.0f);
        harshEnv.prepare(spec);
        harshEnv.setLevelCalculationType(juce::dsp::BallisticsFilterLevelCalculationType::RMS);
        harshEnv.setAttackTime(3.0f);
        harshEnv.setReleaseTime(90.0f);
        deessEnv.prepare(spec);
        deessEnv.setLevelCalculationType(juce::dsp::BallisticsFilterLevelCalculationType::peak);
        deessEnv.setAttackTime(0.5f);
        deessEnv.setReleaseTime(60.0f);
        breathEnv.prepare(spec);
        breathEnv.setLevelCalculationType(juce::dsp::BallisticsFilterLevelCalculationType::RMS);
        breathEnv.setAttackTime(5.0f);
        breathEnv.setReleaseTime(80.0f);

        // Leveler detector: RMS at syllable/phrase timing (NOT fast enough to chew consonants ->
        // that was the harshness). Level rides toward a stable anchor tracked in dB below.
        levelEnv.prepare(spec);
        levelEnv.setLevelCalculationType(juce::dsp::BallisticsFilterLevelCalculationType::RMS);
        levelEnv.setAttackTime(50.0f);
        levelEnv.setReleaseTime(300.0f);
        levelSmoothDb = 0.0f;
        levelAnchorDb = 0.0f;
        levelPrimed   = false;
        setLatencySamples(match::fftSize / 2);
        rebuild();
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
        const int n = buffer.getNumSamples();
        if ((int) monoScratch.size() < n)
            monoScratch.resize((size_t) n);   // some hosts exceed the prepared block size

        if (learning.load())
        {
            const int ch = buffer.getNumChannels();
            for (int i = 0; i < n; ++i)
            {
                float s = 0;
                for (int c = 0; c < ch; ++c)
                    s += buffer.getReadPointer(c)[i];
                monoScratch[(size_t) i] = s / (float) ch;
            }
            liveAnalyzer.addBlock(monoScratch.data(), n);
        }

        juce::dsp::AudioBlock<float> block(buffer);
        juce::dsp::ProcessContextReplacing<float> ctx(block);

        if (matchActive.load())
        {
            if (compRatioEff.load() > 1.01f)
                comp.process(ctx);
            conv.process(ctx);
            gain.setGainDecibels(gainDb.load() * amount->get() + makeupDb.load());
            gain.process(ctx);
        }

        // Harsh (dynamic duck of the 2.5-6.5 kHz band) + de-ess (sibilance band) + breath gate.
        const float de = deess->get(), br = breath->get(), hr = harsh->get();
        if (de > 0.001f || br > 0.001f || hr > 0.001f)
        {
            const float deThresh = -20.0f - 16.0f * de;   // dBFS; higher de = ess ducked sooner
            const float deFloor  = -14.0f * de;           // max sibilance reduction
            const float brThresh = -55.0f + 20.0f * br;   // below this = treated as breath/noise
            const float brFloor  = -24.0f * br;           // max breath attenuation
            const float hrThresh = -24.0f - 14.0f * hr;   // higher knob = harsh band tamed sooner
            const float hrFloor  = -12.0f * hr;           // max harshness reduction
            for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
            {
                float* d = buffer.getWritePointer(ch);
                for (int i = 0; i < n; ++i)
                {
                    float x = d[i];
                    if (hr > 0.001f)                      // same downward-comp math as the de-esser, lower band
                    {
                        float lo, rest, band, top;
                        harshLR1.processSample(ch, x, lo, rest);
                        harshLR2.processSample(ch, rest, band, top);
                        float envDb = juce::Decibels::gainToDecibels(harshEnv.processSample(ch, std::abs(band)));
                        band *= juce::Decibels::decibelsToGain(match::deessGainDb(envDb, hrThresh, hrFloor));
                        x = lo + band + top;
                    }
                    if (de > 0.001f)
                    {
                        float lo, hi;
                        deessLR.processSample(ch, x, lo, hi);
                        float envDb = juce::Decibels::gainToDecibels(deessEnv.processSample(ch, std::abs(hi)));
                        hi *= juce::Decibels::decibelsToGain(match::deessGainDb(envDb, deThresh, deFloor));
                        x = lo + hi;
                    }
                    if (br > 0.001f)
                    {
                        float envDb = juce::Decibels::gainToDecibels(breathEnv.processSample(ch, std::abs(x)));
                        x *= juce::Decibels::decibelsToGain(match::breathGainDb(envDb, brThresh, brFloor));
                    }
                    d[i] = x;
                }
            }
        }

        // Constant-volume leveler: ride the detector toward a stable anchor that is PRIMED to the first
        // real level (no startup ramp) and FROZEN during silence (no re-ramp) -> no swell/duck jumps.
        // Gain smoothed ~120 ms so loud drops and quiet lifts happen cleanly, no zipper/pumping.
        const float lv = level->get();
        if (lv > 0.001f)
        {
            const int ch = buffer.getNumChannels();
            const float maxDb = 12.0f * lv;               // knob = allowed ride range; correction inside it is FULL
            const float sr = (float) std::max(1.0, currentSR);
            const float downCoef   = std::exp(-1.0f / (0.040f * sr)); // pull loud DOWN fast - onsets can't poke through
            const float upCoef     = std::exp(-1.0f / (0.200f * sr)); // lift quiet UP gently - no pumping/noise swell
            const float anchorCoef = std::exp(-1.0f / (30.0f  * sr)); // ~30 s: whole-take drift only, a loud chorus can't absorb it
            float sm = levelSmoothDb, anchor = levelAnchorDb;
            for (int i = 0; i < n; ++i)
            {
                float m = 0;
                for (int c = 0; c < ch; ++c)
                    m += buffer.getReadPointer(c)[i];
                m = std::abs(m / (float) ch);
                float envDb = juce::Decibels::gainToDecibels(levelEnv.processSample(0, m));
                if (envDb > -55.0f)                       // above gate: prime once, then barely drift
                {
                    if (! levelPrimed) { anchor = envDb; levelPrimed = true; }
                    else                 anchor += (1.0f - anchorCoef) * (envDb - anchor);
                }                                         // gated: anchor frozen (no decay -> no re-ramp)
                float target = match::levelerGainDb(envDb, anchor, -55.0f, maxDb);
                sm = target + (target < sm ? downCoef : upCoef) * (sm - target);
                float g = juce::Decibels::decibelsToGain(sm);
                for (int c = 0; c < ch; ++c)
                    buffer.getWritePointer(c)[i] *= g;
            }
            levelSmoothDb = sm;
            levelAnchorDb = anchor;
            levelGainDb = sm;                             // for the UI readout
        }

        const float rv = reverbMix->get();
        if (rv > 0.001f)
        {
            juce::Reverb::Parameters rp;
            rp.roomSize = 0.5f;
            rp.damping = 0.5f;
            rp.width = 1.0f;
            rp.wetLevel = rv * 0.35f;
            rp.dryLevel = 1.0f - 0.25f * rv;
            reverb.setParameters(rp);
            reverb.process(ctx);
        }
    }

    //=== learning / matching (message thread only) =====================
    void startLearning()
    {
        liveAnalyzer.reset();
        learning = true;
    }

    void stopLearning()
    {
        learning = false;
        // ponytail: 100ms delay instead of a lock - the audio thread is long past this block by then
        juce::Timer::callAfterDelay(100, [wr = juce::WeakReference<VocalMatchProcessor>(this)]
        {
            if (auto* p = wr.get())
            {
                p->vocSpec = p->liveAnalyzer.finalize(p->currentSR);
                p->rebuild();
            }
        });
    }

    juce::String loadReferenceFile(const juce::File& f)
    {
        std::unique_ptr<juce::AudioFormatReader> reader(formats.createReaderFor(f));
        if (reader == nullptr)
            return "Can't read " + f.getFileName();
        // ponytail: a ref at a different sample rate replaces the average instead of resampling into it
        if (refSR > 0 && std::abs(refSR - reader->sampleRate) > 1.0)
        {
            refAnalyzer.reset();
            refFileCount = 0;
        }
        refSR = reader->sampleRate;

        const int chunk = 1 << 16;
        juce::AudioBuffer<float> buf((int) reader->numChannels, chunk);
        std::vector<float> mono((size_t) chunk);
        for (juce::int64 pos = 0; pos < (juce::int64) reader->lengthInSamples;)
        {
            int nn = (int) std::min<juce::int64>(chunk, (juce::int64) reader->lengthInSamples - pos);
            reader->read(&buf, 0, nn, pos, true, true);
            for (int i = 0; i < nn; ++i)
            {
                float s = 0;
                for (int c = 0; c < buf.getNumChannels(); ++c)
                    s += buf.getReadPointer(c)[i];
                mono[(size_t) i] = s / (float) buf.getNumChannels();
            }
            refAnalyzer.addBlock(mono.data(), nn);
            pos += nn;
        }
        ++refFileCount;
        refSpec = refAnalyzer.finalize(refSR);
        if (!refSpec.valid)
            return f.getFileName() + " is too short or silent to analyse";
        rebuild();
        saveSharedRef();
        return {};
    }

    //=== shared reference: analyse once, reuse in every instance ========
    static juce::File sharedRefFile()
    {
        return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory)
            .getChildFile("VocalMatch/last_reference.dat");
    }

    void saveSharedRef() const
    {
        auto f = sharedRefFile();
        f.getParentDirectory().createDirectory();
        juce::MemoryBlock mb;
        juce::MemoryOutputStream mos(mb, false);
        writeSpec(mos, refSpec);
        f.replaceWithData(mb.getData(), mb.getSize());
    }

    juce::String loadSharedRef()
    {
        auto f = sharedRefFile();
        juce::MemoryBlock mb;
        if (!f.existsAsFile() || !f.loadFileAsData(mb))
            return "No saved reference yet - load one normally first";
        juce::MemoryInputStream mis(mb, false);
        match::Spectrum s;
        readSpec(mis, s);
        if (!s.valid)
            return "Saved reference unreadable";
        refSpec = s;
        refFileCount = 1;
        rebuild();
        return {};
    }

    //=== vocal extraction (Demucs CLI, off-thread) =====================
    static juce::File findDemucs()
    {
        // ponytail: fixed candidate list, no config UI - it's a personal plugin
        auto home = juce::File::getSpecialLocation(juce::File::userHomeDirectory);
        for (auto* p : { "stem split/backend/venv/bin/demucs" })
            if (auto f = home.getChildFile(p); f.existsAsFile()) return f;
        for (auto* p : { "/opt/homebrew/bin/demucs", "/usr/local/bin/demucs" })
            if (juce::File f(p); f.existsAsFile()) return f;
        return {};
    }

    // Pulls the last "NN%" out of a tqdm tail (Demucs prints its bar to stderr).
    static int lastPercent(const juce::String& s)
    {
        auto t = s.toStdString();
        int best = -1;
        for (size_t i = 0; i < t.size(); ++i)
            if (t[i] == '%')
            {
                int val = 0, mul = 1, digits = 0;
                for (size_t j = i; j > 0 && t[j - 1] >= '0' && t[j - 1] <= '9'; --j)
                    { val += (t[j - 1] - '0') * mul; mul *= 10; ++digits; }
                if (digits > 0 && val <= 100) best = val;
            }
        return best;
    }

    void extractAndLoad(const juce::Array<juce::File>& files)
    {
        auto flag = busy;
        if (flag->exchange(true))
            return;                            // one extraction at a time
        demucsFiles = files.size();
        demucsFile = 0;
        demucsPct = 0;
        extractNote = {};
        juce::Thread::launch([flag, exe = demucsExe, files,
                              wr = juce::WeakReference<VocalMatchProcessor>(this)]
        {
            auto outRoot = juce::File::getSpecialLocation(juce::File::tempDirectory)
                               .getChildFile("VocalMatchDemucs");
            juce::Array<juce::File> toLoad;
            juce::String note;
            int idx = 0;
            for (auto& f : files)
            {
                if (auto* p = wr.get()) { p->demucsFile = ++idx; p->demucsPct = 0; }
                juce::ChildProcess pr;
                // FL 20 runs under Rosetta (x86_64); a child inherits x86_64, but the venv's
                // torch extensions are arm64 -> "incompatible architecture". Force arm64 with
                // `arch`. `env` adds an ffmpeg-capable PATH (a Dock-launched DAW's PATH is minimal,
                // and torchaudio needs ffmpeg to decode m4a/aac).
                auto py = exe.getParentDirectory().getChildFile("python3");
                juce::StringArray args { "/usr/bin/arch", "-arm64",
                                         "/usr/bin/env", "PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin" };
                if (py.existsAsFile())
                    args.addArray({ py.getFullPathName(), "-m", "demucs.separate" });   // bypass the shebang wrapper
                else
                    args.add(exe.getFullPathName());
                args.addArray({ "--two-stems=vocals", "-o", outRoot.getFullPathName(), f.getFullPathName() });
                bool started = pr.start(args);
                juce::String tail;
                if (started)
                {
                    char raw[2048];
                    for (int n; (n = pr.readProcessOutput(raw, sizeof(raw))) > 0;)
                    {
                        tail = (tail + juce::String::fromUTF8(raw, n)).getLastCharacters(600);
                        if (int pct = lastPercent(tail); pct >= 0)
                            if (auto* p = wr.get()) p->demucsPct = pct;
                    }
                    pr.waitForProcessToFinish(30 * 60 * 1000);   // a full song on CPU can take minutes
                }
                juce::File vocals;
                if (started && pr.getExitCode() == 0)
                    for (auto& v : outRoot.findChildFiles(juce::File::findFiles, true, "vocals.wav"))
                        if (v.getParentDirectory().getFileName() == f.getFileNameWithoutExtension())
                            vocals = v;

                if (vocals.existsAsFile())
                    toLoad.add(vocals);
                else
                {
                    toLoad.add(f);            // fall back to the raw file, but tell the user why
                    auto why = tail.replace("\n", " ").trim();
                    note = f.getFileName() + ": extraction failed"
                         + (why.isNotEmpty() ? " (" + why.getLastCharacters(90) + ")" : "")
                         + " - using the raw file instead";
                }
            }
            juce::MessageManager::callAsync([wr, toLoad, outRoot, flag, note]
            {
                if (auto* p = wr.get())
                {
                    for (auto& f : toLoad)
                        p->loadReferenceFile(f);
                    p->extractNote = note;
                }
                outRoot.deleteRecursively();
                flag->store(false);
            });
        });
    }

    float capturedSeconds() const
    {
        return currentSR > 0 ? liveAnalyzer.windowCount() * (float)(match::fftSize / 2) / (float) currentSR : 0.0f;
    }

    void resetAll()
    {
        learning = false;
        matchActive = false;
        refAnalyzer.reset();
        liveAnalyzer.reset();
        refSpec = {};
        vocSpec = {};
        refSR = 0;
        refFileCount = 0;
        compRatioEff = 1.0f;
        makeupDb = 0.0f;
        extractNote = {};
        conv.reset();
    }

    void rebuild()
    {
        if (!refSpec.valid || !vocSpec.valid || currentSR <= 0)
            return;
        const float amt = amount->get();
        auto corr = match::correctionDb(refSpec, vocSpec, currentSR, amt);
        auto fir  = match::designFir(corr);
        juce::AudioBuffer<float> ir(1, match::fftSize);
        ir.copyFrom(0, 0, fir.data(), match::fftSize);
        conv.loadImpulseResponse(std::move(ir), currentSR,
                                 juce::dsp::Convolution::Stereo::no,
                                 juce::dsp::Convolution::Trim::no,
                                 juce::dsp::Convolution::Normalise::no);
        gainDb = juce::jlimit(-match::maxCorrDb, match::maxCorrDb, refSpec.rmsDb - vocSpec.rmsDb);

        // dynamics match: derive a compressor from the loudness-spread difference
        const float r = match::compRatio(refSpec.spreadDb, vocSpec.spreadDb);
        const float rEff = 1.0f + (r - 1.0f) * amt;
        comp.setThreshold(vocSpec.medianDb + 6.0f);   // ponytail: median RMS + 6 dB approximates peak-weighted threshold
        comp.setRatio(std::max(1.0f, rEff));
        compRatioEff = rEff;
        makeupDb = juce::jlimit(0.0f, 6.0f, (vocSpec.spreadDb - vocSpec.spreadDb / std::max(1.0f, rEff)) * 0.5f);

        double sum = 0;
        for (auto v : corr) sum += std::abs(v);
        avgCorrDb = (float)(sum / (double) corr.size());
        lastBuiltAmount = amt;
        matchActive = true;
    }

    //=== state =========================================================
    static void writeSpec(juce::MemoryOutputStream& mos, const match::Spectrum& s)
    {
        mos.writeBool(s.valid);
        if (s.valid)
        {
            mos.writeDouble(s.sampleRate);
            mos.writeFloat(s.rmsDb);
            mos.writeFloat(s.medianDb);
            mos.writeFloat(s.spreadDb);
            for (auto v : s.dB) mos.writeFloat(v);
        }
    }

    static void readSpec(juce::MemoryInputStream& mis, match::Spectrum& s)
    {
        s = {};
        if (mis.readBool())
        {
            s.sampleRate = mis.readDouble();
            s.rmsDb = mis.readFloat();
            s.medianDb = mis.readFloat();
            s.spreadDb = mis.readFloat();
            s.dB.resize((size_t) match::numBins);
            for (auto& v : s.dB) v = mis.readFloat();
            s.valid = true;
        }
    }

    void getStateInformation(juce::MemoryBlock& dest) override
    {
        juce::MemoryOutputStream mos(dest, false);
        mos.writeInt(5);
        mos.writeFloat(amount->get());
        mos.writeFloat(reverbMix->get());
        mos.writeFloat(deess->get());
        mos.writeFloat(breath->get());
        mos.writeFloat(level->get());
        mos.writeFloat(harsh->get());
        writeSpec(mos, refSpec);
        writeSpec(mos, vocSpec);
    }

    void setStateInformation(const void* data, int size) override
    {
        juce::MemoryInputStream mis(data, (size_t) size, false);
        if (mis.readInt() != 5)               // ponytail: no old-version migration, re-learning takes 10s
            return;
        *amount = mis.readFloat();
        *reverbMix = mis.readFloat();
        *deess = mis.readFloat();
        *breath = mis.readFloat();
        *level = mis.readFloat();
        *harsh = mis.readFloat();
        readSpec(mis, refSpec);
        readSpec(mis, vocSpec);
        rebuild();   // no-op before prepareToPlay; prepareToPlay rebuilds again
    }

    //=== boilerplate ===================================================
    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}
    bool hasEditor() const override { return true; }
    juce::AudioProcessorEditor* createEditor() override;

    //=== shared with editor ============================================
    juce::AudioParameterFloat* amount = nullptr;
    juce::AudioParameterFloat* reverbMix = nullptr;
    juce::AudioParameterFloat* deess = nullptr;
    juce::AudioParameterFloat* breath = nullptr;
    juce::AudioParameterFloat* level = nullptr;
    juce::AudioParameterFloat* harsh = nullptr;
    match::Analyzer refAnalyzer, liveAnalyzer;
    match::Spectrum refSpec, vocSpec;
    std::atomic<bool> learning { false }, matchActive { false };
    std::atomic<float> gainDb { 0 }, compRatioEff { 1.0f }, makeupDb { 0 }, levelGainDb { 0 };
    std::atomic<int> demucsPct { 0 }, demucsFile { 0 }, demucsFiles { 0 };
    juce::String extractNote;              // message-thread only: why extraction fell back, if it did
    float avgCorrDb = 0, lastBuiltAmount = -1;
    int refFileCount = 0;
    juce::File demucsExe = findDemucs();
    std::shared_ptr<std::atomic<bool>> busy = std::make_shared<std::atomic<bool>>(false);

private:
    juce::AudioFormatManager formats;
    double currentSR = 0, refSR = 0;
    float levelSmoothDb = 0, levelAnchorDb = 0;   // leveler state (audio thread only)
    bool  levelPrimed = false;                    // anchor snapped to the first real level yet?
    std::vector<float> monoScratch;
    juce::dsp::Convolution conv;
    juce::dsp::Gain<float> gain;
    juce::dsp::Compressor<float> comp;
    juce::dsp::Reverb reverb;
    juce::dsp::LinkwitzRileyFilter<float> deessLR, harshLR1, harshLR2;
    juce::dsp::BallisticsFilter<float> deessEnv, breathEnv, levelEnv, harshEnv;

    JUCE_DECLARE_WEAK_REFERENCEABLE(VocalMatchProcessor)
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(VocalMatchProcessor)
};

//======================================================================
// Live proof-of-work: overlays the reference's learned tonal shape, your
// vocal's shape, and the green EQ move actually being applied (flat until you
// match, bends live as Amount turns). Log freq 20 Hz-20 kHz, 0 dB = centre.
struct CurveView : juce::Component
{
    VocalMatchProcessor& p;
    explicit CurveView(VocalMatchProcessor& pr) : p(pr) {}

    static double freqAtX(int px, float w)   // inverse: pixel -> Hz on the log axis
    {
        const double lo = std::log10(20.0), hi = std::log10(20000.0);
        return std::pow(10.0, lo + (hi - lo) * px / w);
    }
    static float xAtFreq(double f, float w)
    {
        const double lo = std::log10(20.0), hi = std::log10(20000.0);
        return (float)((std::log10(f) - lo) / (hi - lo)) * w;
    }

    void paint(juce::Graphics& g) override
    {
        auto b = getLocalBounds().toFloat();
        const float w = b.getWidth(), h = b.getHeight(), midY = h * 0.5f;
        g.setColour(juce::Colour(0xff101418));
        g.fillRoundedRectangle(b, 4.0f);

        g.setColour(juce::Colour(0xff2a2f36));               // 0 dB baseline + decade ticks
        g.drawHorizontalLine((int) midY, 0.0f, w);
        for (double f : { 100.0, 1000.0, 10000.0 })
            g.drawVerticalLine((int) xAtFreq(f, w), 0.0f, h);

        auto plot = [&](juce::Colour c, float thick, auto dbAt)
        {
            juce::Path path;
            for (int px = 0; px <= (int) w; px += 2)
            {
                float dbv = dbAt(freqAtX(px, w));
                float y = midY - juce::jlimit(-1.0f, 1.0f, dbv / 18.0f) * (midY - 5.0f);
                if (px == 0) path.startNewSubPath((float) px, y);
                else         path.lineTo((float) px, y);
            }
            g.setColour(c);
            g.strokePath(path, juce::PathStrokeType(thick));
        };

        // ref & vocal: shape relative to each one's own level (offset cancels, as in correctionDb)
        if (p.refSpec.valid)
            plot(juce::Colour(0xff5ac8fa), 1.5f, [&](double f){ return match::interpDb(p.refSpec, f) - p.refSpec.rmsDb; });
        if (p.vocSpec.valid)
            plot(juce::Colour(0xff888e96), 1.5f, [&](double f){ return match::interpDb(p.vocSpec, f) - p.vocSpec.rmsDb; });

        if (p.refSpec.valid && p.vocSpec.valid)              // the actual EQ move (the proof)
        {
            const double sr = p.vocSpec.sampleRate > 0 ? p.vocSpec.sampleRate : 48000.0;
            auto corr = match::correctionDb(p.refSpec, p.vocSpec, sr, p.amount->get());
            plot(juce::Colour(0xff34c759), 2.2f, [&](double f)
            {
                int bi = juce::jlimit(0, match::numBins - 1, (int) std::round(f * match::fftSize / sr));
                return corr[(size_t) bi];
            });
        }

        g.setFont(10.0f);
        g.setColour(juce::Colour(0xff5ac8fa)); g.drawText("reference",  6,  4, 70, 12, juce::Justification::left);
        g.setColour(juce::Colour(0xff888e96)); g.drawText("your vocal", 78, 4, 70, 12, juce::Justification::left);
        g.setColour(juce::Colour(0xff34c759)); g.drawText("EQ move",   156, 4, 70, 12, juce::Justification::left);
    }
};

//======================================================================
class VocalMatchEditor : public juce::AudioProcessorEditor, private juce::Timer
{
public:
    explicit VocalMatchEditor(VocalMatchProcessor& pr) : AudioProcessorEditor(pr), p(pr)
    {
        addAndMakeVisible(loadBtn);
        loadBtn.onClick = [this]
        {
            chooser = std::make_unique<juce::FileChooser>("Choose reference track(s) - acapellas work best",
                                                          juce::File{}, "*.wav;*.aif;*.aiff;*.flac;*.mp3;*.m4a");
            chooser->launchAsync(juce::FileBrowserComponent::openMode
                                     | juce::FileBrowserComponent::canSelectFiles
                                     | juce::FileBrowserComponent::canSelectMultipleItems,
                                 [this](const juce::FileChooser& fc)
                                 {
                                     if (fc.getResults().isEmpty())
                                         return;
                                     if (extractToggle.getToggleState())
                                         p.extractAndLoad(fc.getResults());
                                     else
                                         for (auto& f : fc.getResults())
                                             if (auto err = p.loadReferenceFile(f); err.isNotEmpty())
                                                 status.setText(err, juce::dontSendNotification);
                                 });
        };

        extractToggle.setButtonText("Extract vocals (Demucs)");
        extractToggle.setToggleState(p.demucsExe.existsAsFile(), juce::dontSendNotification);
        addAndMakeVisible(extractToggle);
        extractToggle.setVisible(p.demucsExe.existsAsFile());

        addAndMakeVisible(reuseBtn);
        reuseBtn.onClick = [this]
        {
            if (auto err = p.loadSharedRef(); err.isNotEmpty())
                status.setText(err, juce::dontSendNotification);
        };

        learnBtn.setClickingTogglesState(true);
        addAndMakeVisible(learnBtn);
        learnBtn.onClick = [this]
        {
            if (learnBtn.getToggleState()) { learnBtn.setButtonText("Stop learning"); p.startLearning(); }
            else                           { learnBtn.setButtonText("Learn Vocal");   p.stopLearning(); }
        };

        addAndMakeVisible(resetBtn);
        resetBtn.onClick = [this]
        {
            p.resetAll();
            learnBtn.setToggleState(false, juce::dontSendNotification);
            learnBtn.setButtonText("Learn Vocal");
        };

        auto setupKnob = [this](juce::Slider& s, juce::Label& l, const char* name)
        {
            s.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);
            s.setTextBoxStyle(juce::Slider::TextBoxBelow, false, 60, 18);
            addAndMakeVisible(s);
            l.setText(name, juce::dontSendNotification);
            l.setJustificationType(juce::Justification::centred);
            addAndMakeVisible(l);
        };
        setupKnob(amountSlider, amountLabel, "Amount");
        setupKnob(reverbSlider, reverbLabel, "Reverb");
        setupKnob(deessSlider,  deessLabel,  "De-ess");
        setupKnob(breathSlider, breathLabel, "Breath");
        setupKnob(levelSlider,  levelLabel,  "Level");
        setupKnob(harshSlider,  harshLabel,  "Harsh");
        attachment       = std::make_unique<juce::SliderParameterAttachment>(*p.amount,    amountSlider);
        reverbAttachment = std::make_unique<juce::SliderParameterAttachment>(*p.reverbMix, reverbSlider);
        deessAttachment  = std::make_unique<juce::SliderParameterAttachment>(*p.deess,     deessSlider);
        breathAttachment = std::make_unique<juce::SliderParameterAttachment>(*p.breath,    breathSlider);
        levelAttachment  = std::make_unique<juce::SliderParameterAttachment>(*p.level,     levelSlider);
        harshAttachment  = std::make_unique<juce::SliderParameterAttachment>(*p.harsh,     harshSlider);

        addAndMakeVisible(curve);

        progressBar.setVisible(false);
        addChildComponent(progressBar);

        status.setJustificationType(juce::Justification::topLeft);
        addAndMakeVisible(status);

        setSize(640, 440);
        startTimerHz(4);
    }

private:
    void timerCallback() override
    {
        const bool extracting = p.busy->load();
        loadBtn.setEnabled(!extracting);
        reuseBtn.setEnabled(!extracting);
        extractToggle.setEnabled(!extracting);

        if (extracting)
        {
            barValue = p.demucsPct.load() / 100.0;
            progressBar.setTextToDisplay("Separating vocals  " + juce::String(p.demucsFile.load())
                                         + "/" + juce::String(p.demucsFiles.load()) + "   "
                                         + juce::String(p.demucsPct.load()) + "%");
        }
        progressBar.setVisible(extracting);

        const juce::String tick = juce::CharPointer_UTF8("\xe2\x9c\x93");   // ✓
        juce::String t;

        if (extracting)
            t << "Reference: extracting vocals with Demucs...";
        else if (p.refSpec.valid)
            t << "Reference: analysed " << tick << "  (" << p.refFileCount
              << (p.refFileCount == 1 ? " file)" : " files)");
        else
            t << "Reference: none loaded";
        t << "\n";

        if (p.learning.load())
        {
            const float s = p.capturedSeconds();
            if (s <= 0.0f)
                t << "Vocal: listening... play your vocal (press ▶ if the transport is stopped)";
            else
                t << "Vocal: capturing " << juce::String(s, 1) << "s  "
                  << (s >= 10.0f ? "(enough — hit Stop)" : "(keep going, aim for 10s+)");
        }
        else if (p.vocSpec.valid)
            t << "Vocal: learned " << tick;
        else
            t << "Vocal: not learned — hit Learn Vocal, play your vocal";

        if (p.extractNote.isNotEmpty())
            t << "\n" << p.extractNote;

        if (p.matchActive.load())
            t << "\nMatching " << tick << "   EQ " << juce::String(p.avgCorrDb, 1) << " dB avg   level "
              << juce::String(p.gainDb.load() * p.amount->get(), 1) << " dB   comp "
              << juce::String(p.compRatioEff.load(), 1) << ":1";

        if (p.level->get() > 0.001f)
            t << "\nLevel riding " << juce::String(p.levelGainDb.load(), 1) << " dB  (constant volume)";

        status.setText(t, juce::dontSendNotification);
        curve.repaint();   // 4 Hz: reflects new learns and live Amount moves

        if (p.matchActive.load() && std::abs(p.amount->get() - p.lastBuiltAmount) > 0.02f)
            p.rebuild();   // debounced EQ re-tilt when Amount moves
    }

    void paint(juce::Graphics& g) override
    {
        g.fillAll(getLookAndFeel().findColour(juce::ResizableWindow::backgroundColourId));
        g.setColour(juce::Colours::white);
        g.setFont(juce::Font(18.0f, juce::Font::bold));
        g.drawText("VocalMatch", 14, 8, 200, 22, juce::Justification::left);
        g.setColour(juce::Colours::grey);
        g.setFont(12.0f);
        g.drawText("reference tone match", 118, 12, 250, 18, juce::Justification::left);
    }

    void resized() override
    {
        auto r = getLocalBounds().reduced(14);
        r.removeFromTop(24);                              // title band

        // four knobs across the bottom
        auto knobRow = r.removeFromBottom(84);
        juce::Slider* sliders[] = { &amountSlider, &reverbSlider, &deessSlider, &breathSlider, &levelSlider, &harshSlider };
        juce::Label*  labels[]  = { &amountLabel,  &reverbLabel,  &deessLabel,  &breathLabel,  &levelLabel,  &harshLabel  };
        const int kw = knobRow.getWidth() / 6;
        for (int i = 0; i < 6; ++i)
        {
            auto cell = knobRow.removeFromLeft(kw);
            labels[i]->setBounds(cell.removeFromTop(18));
            sliders[i]->setBounds(cell);
        }
        r.removeFromBottom(8);

        curve.setBounds(r.removeFromTop(130));            // proof-of-work graph
        r.removeFromTop(8);

        auto rowA = r.removeFromTop(30);                  // primary buttons
        loadBtn.setBounds(rowA.removeFromLeft(120));
        rowA.removeFromLeft(6);
        learnBtn.setBounds(rowA.removeFromLeft(110));
        rowA.removeFromLeft(6);
        resetBtn.setBounds(rowA.removeFromLeft(60));
        r.removeFromTop(8);

        auto rowB = r.removeFromTop(24);                  // extract toggle + reuse
        extractToggle.setBounds(rowB.removeFromLeft(180));
        rowB.removeFromLeft(6);
        reuseBtn.setBounds(rowB.removeFromLeft(120).reduced(0, 1));
        r.removeFromTop(8);

        progressBar.setBounds(r.removeFromTop(18));        // reserved strip (shown only while extracting)
        r.removeFromTop(4);
        status.setBounds(r);
    }

    VocalMatchProcessor& p;
    juce::TextButton loadBtn { "Load Reference..." }, learnBtn { "Learn Vocal" }, resetBtn { "Reset" },
                     reuseBtn { "Reuse Last Ref" };
    juce::ToggleButton extractToggle;
    juce::Slider amountSlider, reverbSlider, deessSlider, breathSlider, levelSlider, harshSlider;
    juce::Label amountLabel, reverbLabel, deessLabel, breathLabel, levelLabel, harshLabel, status;
    CurveView curve { p };
    double barValue = 0;
    juce::ProgressBar progressBar { barValue };
    std::unique_ptr<juce::FileChooser> chooser;
    std::unique_ptr<juce::SliderParameterAttachment> attachment, reverbAttachment, deessAttachment, breathAttachment, levelAttachment, harshAttachment;
};

juce::AudioProcessorEditor* VocalMatchProcessor::createEditor() { return new VocalMatchEditor(*this); }

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new VocalMatchProcessor(); }
