// Entry point for the native core test executable. Test cases self-register via the TEST() macro
// in the linked translation units; this just runs them and returns a non-zero exit on failure.
#include "test_framework.hpp"

int main() { return c64test::run(); }
