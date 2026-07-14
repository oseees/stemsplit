cmake_minimum_required(VERSION 3.22)
project(VocalMatch VERSION 0.1.0)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)
FetchContent_Declare(JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG 8.0.14
    GIT_SHALLOW TRUE)
FetchContent_MakeAvailable(JUCE)

juce_add_plugin(VocalMatch
    COMPANY_NAME "Oseabhi"
    PLUGIN_MANUFACTURER_CODE Osea
    PLUGIN_CODE Vmch
    FORMATS AU VST3 Standalone
    PRODUCT_NAME "VocalMatch"
    IS_SYNTH FALSE
    NEEDS_MIDI_INPUT FALSE
    NEEDS_MIDI_OUTPUT FALSE
    COPY_PLUGIN_AFTER_BUILD TRUE)

target_sources(VocalMatch PRIVATE VocalMatch.cpp)

target_compile_definitions(VocalMatch PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0)

target_link_libraries(VocalMatch
    PRIVATE juce::juce_audio_utils juce::juce_dsp
    PUBLIC juce::juce_recommended_config_flags)

juce_add_console_app(TestMatch PRODUCT_NAME "TestMatch")
target_sources(TestMatch PRIVATE TestMatch.cpp)
target_link_libraries(TestMatch PRIVATE juce::juce_dsp juce::juce_recommended_config_flags)

juce_add_console_app(TestRead PRODUCT_NAME "TestRead")
target_sources(TestRead PRIVATE TestRead.cpp)
target_compile_definitions(TestRead PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
target_link_libraries(TestRead PRIVATE juce::juce_audio_formats juce::juce_recommended_config_flags)
