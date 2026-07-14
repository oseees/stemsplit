cmake_minimum_required(VERSION 3.22)

# Universal binary: a Rosetta/x86_64 DAW (FL Studio) can't load an arm64-only plugin.
set(CMAKE_OSX_ARCHITECTURES "x86_64;arm64" CACHE STRING "" FORCE)

project(VocalPerfect VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Reuse the JUCE checkout VocalMatch already downloaded; fetch only if missing.
set(JUCE_LOCAL "${CMAKE_CURRENT_SOURCE_DIR}/../vocalmatch/build/_deps/juce-src")
if(EXISTS "${JUCE_LOCAL}/CMakeLists.txt")
    add_subdirectory("${JUCE_LOCAL}" JUCE)
else()
    include(FetchContent)
    FetchContent_Declare(JUCE
        GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
        GIT_TAG 8.0.14
        GIT_SHALLOW TRUE)
    FetchContent_MakeAvailable(JUCE)
endif()

juce_add_plugin(VocalPerfect
    COMPANY_NAME "Oseabhi"
    PLUGIN_MANUFACTURER_CODE Osea
    PLUGIN_CODE Vpfc
    FORMATS AU VST3 Standalone
    PRODUCT_NAME "VocalPerfect"
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    COPY_PLUGIN_AFTER_BUILD TRUE)

target_sources(VocalPerfect PRIVATE VocalPerfect.cpp)

target_compile_definitions(VocalPerfect PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0)

target_link_libraries(VocalPerfect
    PRIVATE juce::juce_audio_utils juce::juce_dsp
    PUBLIC juce::juce_recommended_config_flags)

juce_add_console_app(TestChain PRODUCT_NAME "TestChain")
target_sources(TestChain PRIVATE TestChain.cpp)
target_link_libraries(TestChain PRIVATE juce::juce_dsp juce::juce_recommended_config_flags)

# Renders audio through the real processor (includes VocalPerfect.cpp directly).
juce_add_console_app(TestRender PRODUCT_NAME "TestRender")
target_sources(TestRender PRIVATE TestRender.cpp)
target_compile_definitions(TestRender PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
target_link_libraries(TestRender PRIVATE juce::juce_audio_utils juce::juce_dsp juce::juce_recommended_config_flags)
