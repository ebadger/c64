#include "test_framework.hpp"

#include <cstring>

namespace c64test {

std::vector<TestCase>& registry() {
  static std::vector<TestCase> r;
  return r;
}

int registerTest(const char* name, TestFn fn) {
  registry().push_back(TestCase{name, fn});
  return 0;
}

int g_failures = 0;
int g_checks = 0;

void reportFailure(const char* file, int line, const std::string& message) {
  ++g_failures;
  std::printf("  FAIL %s:%d %s\n", file, line, message.c_str());
}

}  // namespace c64test

int main(int argc, char** argv) {
  const char* filter = (argc >= 2) ? argv[1] : nullptr;
  int ran = 0;
  for (const c64test::TestCase& t : c64test::registry()) {
    if (filter != nullptr && std::strstr(t.name, filter) == nullptr) continue;
    const int before = c64test::g_failures;
    t.fn();
    ++ran;
    const bool ok = c64test::g_failures == before;
    std::printf("[%s] %s\n", ok ? "PASS" : "FAIL", t.name);
  }
  std::printf("\n%d test(s), %d check(s), %d failure(s)\n", ran, c64test::g_checks,
              c64test::g_failures);
  return c64test::g_failures == 0 ? 0 : 1;
}
