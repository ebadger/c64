# Deterministic C64 core build. One CMakeLists drives two build modes from the same C++17
# sources:
#   * Native (MSVC/Clang/GCC): a static core library plus the CTest golden-vector executable for
#     fast unit testing.
#   * Emscripten (via emcmake): the production WebAssembly module + embind ES loader that the web
#     client and the headless WASM smoke test both consume.
# See SETUP.md for the exact reproducible commands. No copyrighted ROMs are referenced anywhere.
cmake_minimum_required(VERSION 3.20)
project(c64core LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(CORE_SOURCES
  src/errors.cpp
  src/bus.cpp
  src/cpu.cpp
  src/vicii.cpp
  src/machine.cpp)

if(EMSCRIPTEN)
  # Production WebAssembly artifact: c64core.js (ES module loader) + c64core.wasm.
  add_executable(c64core_wasm ${CORE_SOURCES} wasm/embind.cpp)
  target_include_directories(c64core_wasm PRIVATE include)
  set_target_properties(c64core_wasm PROPERTIES OUTPUT_NAME "c64core" SUFFIX ".js")
  target_link_options(c64core_wasm PRIVATE
    "-lembind"
    "-sMODULARIZE=1"
    "-sEXPORT_ES6=1"
    "-sEXPORT_NAME=createC64Core"
    "-sENVIRONMENT=web,node"
    "-sALLOW_MEMORY_GROWTH=1"
    "-sSTRICT=1"
    "--no-entry")
else()
  add_library(c64core STATIC ${CORE_SOURCES})
  target_include_directories(c64core PUBLIC include)

  if(MSVC)
    target_compile_options(c64core PRIVATE /W4 /permissive-)
  else()
    target_compile_options(c64core PRIVATE -Wall -Wextra)
  endif()

  enable_testing()
  add_executable(c64_tests
    tests/test_main.cpp
    tests/test_cpu.cpp
    tests/test_machine.cpp)
  target_include_directories(c64_tests PRIVATE include tests)
  target_link_libraries(c64_tests PRIVATE c64core)
  add_test(NAME c64_tests COMMAND c64_tests)
endif()
