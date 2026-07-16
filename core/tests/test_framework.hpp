// Minimal dependency-free assertion harness for the native core tests. Each test executable
// defines test functions, registers them with TEST(), and calls c64test::run() from main. A
// non-zero process exit signals failure to CTest. No third-party test framework is used so the
// core stays dependency-light and identical to build in any environment.
#ifndef C64_TEST_FRAMEWORK_HPP
#define C64_TEST_FRAMEWORK_HPP

#include <cstdint>
#include <cstdio>
#include <functional>
#include <string>
#include <vector>

namespace c64test {

struct Case {
  std::string name;
  std::function<void()> fn;
};

inline std::vector<Case>& registry() {
  static std::vector<Case> cases;
  return cases;
}

inline int& failureCount() {
  static int failures = 0;
  return failures;
}

struct Registrar {
  Registrar(const char* name, std::function<void()> fn) { registry().push_back({name, std::move(fn)}); }
};

inline void reportFailure(const char* file, int line, const std::string& message) {
  ++failureCount();
  std::printf("  FAIL %s:%d: %s\n", file, line, message.c_str());
}

inline int run() {
  int failed = 0;
  for (auto& c : registry()) {
    const int before = failureCount();
    c.fn();
    const bool ok = failureCount() == before;
    std::printf("[%s] %s\n", ok ? "PASS" : "FAIL", c.name.c_str());
    if (!ok) {
      ++failed;
    }
  }
  std::printf("%d/%zu test cases passed\n", static_cast<int>(registry().size()) - failed, registry().size());
  return failed == 0 ? 0 : 1;
}

} // namespace c64test

#define C64_CONCAT_(a, b) a##b
#define C64_CONCAT(a, b) C64_CONCAT_(a, b)

// Define a test case. Body follows in braces.
#define TEST(name)                                                                        \
  static void name();                                                                     \
  static c64test::Registrar C64_CONCAT(reg_, name)(#name, name);                          \
  static void name()

#define REQUIRE(cond)                                                                     \
  do {                                                                                    \
    if (!(cond)) {                                                                        \
      c64test::reportFailure(__FILE__, __LINE__, "expected: " #cond);                     \
    }                                                                                     \
  } while (0)

#define REQUIRE_EQ(actual, expected)                                                      \
  do {                                                                                    \
    const long _a = static_cast<long>(actual);                                            \
    const long _e = static_cast<long>(expected);                                          \
    if (_a != _e) {                                                                       \
      c64test::reportFailure(__FILE__, __LINE__,                                          \
                             std::string(#actual " == " #expected " (got ") +             \
                                 std::to_string(_a) + " vs " + std::to_string(_e) + ")");  \
    }                                                                                     \
  } while (0)

#endif // C64_TEST_FRAMEWORK_HPP
