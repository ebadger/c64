import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const versionFile = readFileSync(resolve(repoRoot, "scripts", "build", "playwright-version.txt"), "utf8");
const playwrightVersion = versionFile
  .split(/\r?\n/)
  .map((line) => line.trim())
  .find((line) => line && !line.startsWith("#"));

test("CI browser gates install the repository-pinned Playwright version", () => {
  assert.match(playwrightVersion, /^\d+\.\d+\.\d+$/);

  const pinnedReference = 'playwright@${{ steps.playwright.outputs.version }}';
  for (const workflow of ["core.yml", "release.yml"]) {
    const source = readFileSync(resolve(repoRoot, ".github", "workflows", workflow), "utf8");
    assert.match(source, /id: playwright/);
    assert.match(source, /scripts\/build\/playwright-version\.txt/);
    assert.ok(source.includes(pinnedReference), `${workflow} must install the pinned Playwright output`);
    assert.match(source, /npx playwright --version/);
    assert.match(source, /node scripts\/dev\/run-node-tests\.mjs tests/);
    assert.doesNotMatch(source, /node --test tests\//);
  }
});
