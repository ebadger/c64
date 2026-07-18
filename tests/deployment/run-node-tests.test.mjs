import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";

import { discoverNodeTestFiles } from "../../scripts/dev/run-node-tests.mjs";

test("Node test discovery is recursive, deterministic, and deduplicated", (context) => {
  const root = mkdtempSync(join(tmpdir(), "c64-node-tests-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const nested = join(root, "nested");
  mkdirSync(nested);
  const first = join(root, "alpha.test.mjs");
  const second = join(nested, "beta.test.js");
  writeFileSync(first, "");
  writeFileSync(second, "");
  writeFileSync(join(root, "not-a-test.mjs"), "");

  const discovered = discoverNodeTestFiles([nested, root, first], root)
    .map((path) => relative(root, path));
  assert.deepEqual(discovered, ["alpha.test.mjs", join("nested", "beta.test.js")]);
});
