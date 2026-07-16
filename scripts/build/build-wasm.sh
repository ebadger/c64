#!/bin/sh
# Build the production WebAssembly artifact (c64core.mjs + c64core.wasm) from the same C++
# sources as the native build, using the pinned Emscripten toolchain (see
# scripts/build/emscripten-version.txt and SETUP.md).
#
# Requires an activated emsdk so that `emcmake` and `cmake` are on PATH.
#
#   sh scripts/build/build-wasm.sh [build-dir]
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

BUILD_DIR="${1:-build/wasm}"

emcmake cmake -S core -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release
cmake --build "$BUILD_DIR"

echo "wasm: built $BUILD_DIR/c64core.mjs and $BUILD_DIR/c64core.wasm" >&2
