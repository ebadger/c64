// Minimal dependency-free assertion harness for the native core tests. Each test executable
// defines test functions, registers them with TEST(), and calls c64test::run() from main. A
// non-zero process exit signals failure to CTest. No third-party test framework is used so the
// core stays dependency-light and identical to build in any environment.
#ifndef C64_TEST_FRAMEWORK_HPP
#define C64_TEST_FRAMEWORK_HPP

#include <cstdint>
#include <cstdio>
#include <functional>
// Minimal dependency-free test framework for the native core tests.
//
// Tests self-register via TEST(name). `ctest` runs the single test binary, which returns
// non-zero if any check fails. An optional substring argument filters test names.
#ifndef C64_TEST_FRAMEWORK_HPP
#define C64_TEST_FRAMEWORK_HPP

#include <cstdio>
#include <cstdint>
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
using TestFn = void (*)();

struct TestCase {
  const char* name;
  TestFn fn;
};

std::vector<TestCase>& registry();
int registerTest(const char* name, TestFn fn);

extern int g_failures;
extern int g_checks;

void reportFailure(const char* file, int line, const std::string& message);

template <typename A, typename B>
void checkEq(const char* file, int line, const A& a, const B& b, const char* exprA,
             const char* exprB) {
  ++g_checks;
  if (!(a == static_cast<A>(b))) {
    char buf[256];
    std::snprintf(buf, sizeof(buf), "CHECK_EQ(%s, %s): %lld != %lld", exprA, exprB,
                  static_cast<long long>(a), static_cast<long long>(b));
    reportFailure(file, line, buf);
  }
}

}  // namespace c64test

#define TEST(name)                                                            \
  static void name();                                                         \
  static int _reg_##name = c64test::registerTest(#name, name);                \
  static void name()

#define CHECK(cond)                                                           \
  do {                                                                        \
    ++c64test::g_checks;                                                      \
    if (!(cond)) {                                                            \
      c64test::reportFailure(__FILE__, __LINE__, "CHECK(" #cond ")");         \
    }                                                                         \
  } while (0)

#define CHECK_EQ(a, b) c64test::checkEq(__FILE__, __LINE__, (a), (b), #a, #b)

#define CHECK_STR_EQ(a, b)                                                    \
  do {                                                                        \
    ++c64test::g_checks;                                                      \
    if (std::string(a) != std::string(b)) {                                   \
      c64test::reportFailure(__FILE__, __LINE__,                              \
                             std::string("CHECK_STR_EQ(" #a ", " #b "): \"") + \
                                 std::string(a) + "\" != \"" + std::string(b) + "\""); \
    }                                                                         \
  } while (0)

#endif  // C64_TEST_FRAMEWORK_HPP
