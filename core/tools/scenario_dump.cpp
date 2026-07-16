// Native scenario dumper. Prints canonical JSON for the deterministic scenario suite so it can
// be diffed against the WebAssembly build's output (parity) and inspected during bring-up.
//
//   scenario_dump           -> JSON array of all scenarios
//   scenario_dump <id>      -> JSON for one scenario
//   scenario_dump --list    -> newline-separated scenario ids
#include <cstdio>
#include <string>

#include "c64/scenarios.hpp"

int main(int argc, char** argv) {
  if (argc >= 2) {
    const std::string arg = argv[1];
    if (arg == "--list") {
      for (const std::string& id : c64::scenarioIds()) {
        std::printf("%s\n", id.c_str());
      }
      return 0;
    }
    std::printf("%s\n", c64::runScenario(arg).c_str());
    return 0;
  }
  std::printf("%s\n", c64::runAllScenarios().c_str());
  return 0;
}
