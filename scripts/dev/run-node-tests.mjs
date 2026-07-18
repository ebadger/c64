import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const TEST_FILE_PATTERN = /\.test\.(?:cjs|mjs|js)$/;

function comparePaths(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function discoverNodeTestFiles(inputs = ["tests"], cwd = process.cwd()) {
  const files = new Set();

  function visit(path) {
    const stats = statSync(path);
    if (stats.isFile()) {
      if (!TEST_FILE_PATTERN.test(basename(path))) {
        throw new Error(`not a Node test file: ${path}`);
      }
      files.add(path);
      return;
    }
    if (!stats.isDirectory()) throw new Error(`test input is not a file or directory: ${path}`);

    const entries = readdirSync(path, { withFileTypes: true }).sort((left, right) =>
      comparePaths(left.name, right.name));
    for (const entry of entries) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile() && TEST_FILE_PATTERN.test(entry.name)) files.add(child);
    }
  }

  for (const input of inputs.length > 0 ? inputs : ["tests"]) visit(resolve(cwd, input));
  const discovered = [...files].sort(comparePaths);
  if (discovered.length === 0) throw new Error("no Node test files found");
  return discovered;
}

export function runNodeTests(inputs = process.argv.slice(2), cwd = process.cwd()) {
  const files = discoverNodeTestFiles(inputs, cwd).map((path) => relative(cwd, path));
  const result = spawnSync(process.execPath, ["--test", ...files], {
    cwd,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status === null) throw new Error(`Node test runner terminated by ${result.signal ?? "unknown signal"}`);
  return result.status;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = runNodeTests();
}
