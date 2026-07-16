# c64 deterministic machine core — native and WebAssembly build.
#
# Native:   cmake -S core -B build/native -DCMAKE_BUILD_TYPE=Release
#           cmake --build build/native
#           ctest --test-dir build/native --output-on-failure
#
# WebAssembly (pinned Emscripten, see SETUP.md):
#           emcmake cmake -S core -B build/wasm -DCMAKE_BUILD_TYPE=Release
#           cmake --build build/wasm         # emits build/wasm/c64core.mjs + c64core.wasm
cmake_minimum_required(VERSION 3.20)
project(c64core LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
endif()

# Deterministic core library (no exceptions cross the public API; no host time/RNG).
add_library(c64core STATIC
  src/result.cpp
  src/timing.cpp
  src/sha256.cpp
  src/rom.cpp
  src/bus.cpp
  src/cpu.cpp
  src/cia.cpp
  src/vic.cpp
  src/sid.cpp
  src/media.cpp
  src/machine.cpp
  src/scenarios.cpp
)
target_include_directories(c64core PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include)

if(MSVC)
  target_compile_options(c64core PRIVATE /W4 /permissive-)
else()
  target_compile_options(c64core PRIVATE -Wall -Wextra)
endif()

if(EMSCRIPTEN)
  # Production WebAssembly artifact: one .wasm + ES6 loader used by the browser later and by
  # headless Node parity tests now. embind projects value types only.
  add_executable(c64core_wasm wasm/embind.cpp)
  target_link_libraries(c64core_wasm PRIVATE c64core)
  set_target_properties(c64core_wasm PROPERTIES OUTPUT_NAME "c64core" SUFFIX ".mjs")
  target_link_options(c64core_wasm PRIVATE
    "-lembind"
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sEXPORT_NAME=createC64Core"
    "-sENVIRONMENT=web,node"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sSTACK_SIZE=1048576"
  )
else()
  # Native tools and tests.
  enable_testing()

  add_executable(scenario_dump tools/scenario_dump.cpp)
  target_link_libraries(scenario_dump PRIVATE c64core)

  add_executable(c64_tests
    tests/test_main.cpp
    tests/test_sha256.cpp
    tests/test_timing.cpp
    tests/test_rom.cpp
    tests/test_bus.cpp
    tests/test_cpu.cpp
    tests/test_decimal.cpp
    tests/test_opcodes.cpp
    tests/test_cia.cpp
    tests/test_vic.cpp
    tests/test_sid.cpp
    tests/test_media.cpp
    tests/test_machine.cpp
    tests/test_integration.cpp
    tests/test_scenarios.cpp
  )
  target_include_directories(c64_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/tests)
  target_link_libraries(c64_tests PRIVATE c64core)

  # Register each source suite as its own CTest entry via a name filter.
  foreach(suite sha256 timing rom bus cpu decimal opcodes cia vic sid media machine integration scenarios)
    add_test(NAME ${suite} COMMAND c64_tests ${suite})
  endforeach()
endif()
