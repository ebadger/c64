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
