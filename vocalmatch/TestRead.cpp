// Repro: does the plugin's reader path handle a given file? Mirrors loadReferenceFile's open.
#include <juce_audio_formats/juce_audio_formats.h>
#include <cstdio>

int main(int argc, char** argv)
{
    if (argc < 2) { std::printf("usage: TestRead <file>\n"); return 2; }
    juce::AudioFormatManager fm;
    fm.registerBasicFormats();
    std::printf("registered formats: %s\n", fm.getWildcardForAllFormats().toRawUTF8());

    juce::File f(juce::String::fromUTF8(argv[1]));
    std::unique_ptr<juce::AudioFormatReader> r(fm.createReaderFor(f));
    if (r == nullptr) { std::printf("FAIL: no reader for %s\n", f.getFileName().toRawUTF8()); return 1; }
    std::printf("OK: %s  sr=%.0f ch=%d len=%lld\n", f.getFileName().toRawUTF8(),
                r->sampleRate, (int) r->numChannels, (long long) r->lengthInSamples);
    return 0;
}
