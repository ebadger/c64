#!/bin/sh
# Configure, build, and test the native C++17 machine core.
#
# Requires cmake (>= 3.20) and a C++17 compiler on PATH. On Windows use the Visual Studio
# toolchain (see SETUP.md) instead of this POSIX helper.
#
#   sh scripts/build/build-native.sh [build-dir]
set -eu

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$REPO_ROOT"

BUILD_DIR="${1:-build/native}"

cmake -S core -B "$BUILD_DIR" -DCMAKE_BUILD_TYPE=Release
cmake --build "$BUILD_DIR"
ctest --test-dir "$BUILD_DIR" --output-on-failure
