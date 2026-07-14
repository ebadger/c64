import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateProject,
  canonicalJson,
  normalizeLineEndings,
  computeBuildId,
  DEFAULT_PROJECT,
} from "../src/project.js";

test("defaults are applied when optional fields are omitted", () => {
  const { ok, project } = validateProject({ source: "" });
  assert.ok(ok);
  assert.equal(project.schema, 1);
  assert.equal(project.target, "nmos-6510");
  assert.equal(project.loadAddress, 0x0801);
  assert.equal(project.runMode, "basic-sys");
  assert.equal(project.timingProfile, "pal-6569");
  assert.equal(project.diskName, DEFAULT_PROJECT.diskName);
});

test("missing source is an invalid-project error", () => {
  const { ok, diagnostics } = validateProject({});
  assert.equal(ok, false);
  assert.equal(diagnostics[0].code, "invalid-project");
});

test("unsupported target is reported distinctly", () => {
  const { ok, diagnostics } = validateProject({ source: "", target: "wdc65c02" });
  assert.equal(ok, false);
  assert.equal(diagnostics[0].code, "unsupported-target");
});

test("out-of-range addresses are rejected", () => {
  const bad = validateProject({ source: "", loadAddress: 0x10000 });
  assert.equal(bad.ok, false);
  assert.equal(bad.diagnostics[0].code, "invalid-project");
});

test("runAddress defaults to loadAddress when unspecified", () => {
  const { project } = validateProject({ source: "", loadAddress: 0xc000 });
  assert.equal(project.runAddress, 0xc000);
});

test("line endings are normalized to LF", () => {
  assert.equal(normalizeLineEndings("a\r\nb\rc\n"), "a\nb\nc\n");
  const { project } = validateProject({ source: "lda #$00\r\nrts\r\n" });
  assert.ok(!project.source.includes("\r"));
});

test("canonical JSON uses fixed key order and no insignificant whitespace", () => {
  const { project } = validateProject({ source: "x", name: "n" });
  const json = canonicalJson(project);
  assert.equal(
    json,
    '{"schema":1,"name":"n","source":"x","target":"nmos-6510","loadAddress":2049,"runMode":"basic-sys","runAddress":2049,"timingProfile":"pal-6569","diskName":"c64 disk","diskId":"64","outputName":"program"}',
  );
});

test("canonical JSON is stable regardless of input key order", () => {
  const a = validateProject({ source: "x", name: "n", outputName: "p" }).project;
  const b = validateProject({ outputName: "p", name: "n", source: "x" }).project;
  assert.equal(canonicalJson(a), canonicalJson(b));
});

test("buildId is a lowercase 64-hex digest and is deterministic", () => {
  const { project } = validateProject({ source: "x" });
  const prg = new Uint8Array([0x01, 0x08, 0xa9, 0x00]);
  const id1 = computeBuildId(project, prg);
  const id2 = computeBuildId(project, prg);
  assert.match(id1, /^[0-9a-f]{64}$/);
  assert.equal(id1, id2);
});

test("buildId changes when output bytes change", () => {
  const { project } = validateProject({ source: "x" });
  const a = computeBuildId(project, new Uint8Array([0x01, 0x08, 0x00]));
  const b = computeBuildId(project, new Uint8Array([0x01, 0x08, 0x01]));
  assert.notEqual(a, b);
});

test("buildId changes when canonical project changes", () => {
  const prg = new Uint8Array([0x01, 0x08, 0x00]);
  const a = computeBuildId(validateProject({ source: "x", name: "a" }).project, prg);
  const b = computeBuildId(validateProject({ source: "x", name: "b" }).project, prg);
  assert.notEqual(a, b);
});

test("diskId must be exactly two PETSCII characters", () => {
  assert.equal(validateProject({ source: "", diskId: "6" }).ok, false);
  assert.equal(validateProject({ source: "", diskId: "641" }).ok, false);
  assert.equal(validateProject({ source: "", diskId: "AB" }).ok, true);
});

test("outputName must be 1..16 PETSCII characters", () => {
  assert.equal(validateProject({ source: "", outputName: "" }).ok, false);
  assert.equal(validateProject({ source: "", outputName: "X".repeat(17) }).ok, false);
  assert.equal(validateProject({ source: "", outputName: "GAME" }).ok, true);
});
