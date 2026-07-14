// Loader for committed example fixtures. Node-only helper (example tooling, not part of the
// browser/Node production pipeline in src/). Composes a full SourceProject from a project.json
// settings file plus a human-editable source.asm so the assembly is not JSON-escaped.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Directory names of the committed examples. */
export const EXAMPLES = ["border-flash"];

/** Absolute path to an example directory. */
export function exampleDir(name) {
  return join(here, name);
}

/** Load an example as a full SourceProject (settings + source string). */
export function loadExample(name) {
  const dir = exampleDir(name);
  const project = JSON.parse(readFileSync(join(dir, "project.json"), "utf8"));
  const source = readFileSync(join(dir, "source.asm"), "utf8");
  return { ...project, source };
}

/** Load an example's committed golden expectations. */
export function loadExpected(name) {
  return JSON.parse(readFileSync(join(exampleDir(name), "expected.json"), "utf8"));
}
