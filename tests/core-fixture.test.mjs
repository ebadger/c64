// Drift guard tying the committed core fixtures to the src/ assembler. Rebuilds the fixture in
// memory from the assembler and asserts the committed JSON matches, so a change in assembler
// output (or an accidental hand edit) fails fast in the standard `node --test tests/` gate — the
// same way examples/build-example.mjs protects the example golden vectors.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildBorderBgFixture } from "../tools/core-fixture.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const jsonPath = join(here, "..", "core", "tests", "fixtures", "border_bg_fixture.json");

test("committed core border/background fixture matches the assembler output", () => {
  const rebuilt = buildBorderBgFixture();
  const committed = JSON.parse(readFileSync(jsonPath, "utf8"));
  assert.deepEqual(committed, JSON.parse(JSON.stringify(rebuilt)));
});
