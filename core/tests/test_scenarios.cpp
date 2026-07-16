#include "c64/scenarios.hpp"

#include <string>

#include "test_framework.hpp"

using namespace c64;

TEST(scenarios_all_run) {
  const std::vector<std::string> ids = scenarioIds();
  CHECK(ids.size() >= 10u);
  for (const std::string& id : ids) {
    const std::string out = runScenario(id);
    CHECK(!out.empty());
    CHECK(out.front() == '{' || out.front() == '[');
  }
}

TEST(scenarios_unknown) {
  CHECK_STR_EQ(runScenario("does-not-exist"), "{\"error\":\"unknown-scenario\"}");
}

TEST(scenarios_run_all_is_array) {
  const std::string out = runAllScenarios();
  CHECK(!out.empty());
  CHECK(out.front() == '[');
  CHECK(out.back() == ']');
}

TEST(scenarios_determinism_reports_identical) {
  const std::string out = runScenario("determinism");
  CHECK(out.find("\"identical\":true") != std::string::npos);
}
