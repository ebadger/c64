// Deterministic scenario suite shared by the native tools/tests and the WebAssembly build.
//
// Both the native scenario_dump tool and the embind projection call runScenario()/
// runAllScenarios(), so native and WASM exercise the identical C++ sources. Each scenario
// returns canonical JSON; parity tests assert the native and WASM JSON are byte-identical,
// proving the same behaviour on CPU traces, PRG loading, bus banking, resets, and errors.
#ifndef C64_SCENARIOS_HPP
#define C64_SCENARIOS_HPP

#include <string>
#include <vector>

namespace c64 {

std::vector<std::string> scenarioIds();
// Returns canonical JSON for one scenario, or {"error":"unknown-scenario"} for an unknown id.
std::string runScenario(const std::string& id);
// Returns a canonical JSON array of { "id": ..., "result": ... } for every scenario in order.
std::string runAllScenarios();

}  // namespace c64

#endif  // C64_SCENARIOS_HPP
