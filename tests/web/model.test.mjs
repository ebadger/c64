// Node tests for projectModel, diagnosticsView, palette, keymap, downloadsCore, and autosave.
import test from "node:test";
import assert from "node:assert/strict";

import {
  makeProject,
  projectFromGalleryEntry,
  canonicalProjectJson,
  computeBuildId,
  validateProject,
} from "../../web/client/lib/projectModel.js";
import { renderDiagnostics, formatDiagnostic } from "../../web/client/lib/diagnosticsView.js";
import { indexedToRgba, PALETTE_RGBA, C64_PALETTE_RGB } from "../../web/client/lib/palette.js";
import { buildKeyboardColumns, buildJoystick, JOYSTICK2_MAP } from "../../web/client/lib/keymap.js";
import { buildShare, sourceFilename } from "../../web/client/lib/downloadsCore.js";
import {
  serializeAutosave,
  parseAutosave,
  serializePreferences,
  parsePreferences,
} from "../../web/client/lib/autosaveFormat.js";

test("makeProject normalizes line endings and applies defaults", () => {
  const p = makeProject({ source: "a\r\nb\rc" });
  assert.equal(p.source, "a\nb\nc");
  assert.equal(p.runMode, "basic-sys");
});

test("projectFromGalleryEntry is deterministic and buildable", () => {
  const entry = { id: "border-flash", timingProfile: "pal-6569" };
  const p = projectFromGalleryEntry(entry, "lda #$00\nrts\n");
  assert.equal(p.name, "border-flash");
  assert.equal(p.outputName, "border-flash");
  const v = validateProject(p);
  assert.equal(v.ok, true, JSON.stringify(v.diagnostics));
  // buildId is stable for the same source.
  const id = computeBuildId(v.project, Uint8Array.from([1, 8, 0]));
  assert.match(id, /^[0-9a-f]{64}$/);
});

test("canonicalProjectJson returns null for an invalid project", () => {
  assert.equal(canonicalProjectJson({ source: 5 }), null);
  assert.equal(typeof canonicalProjectJson({ source: "nop" }), "string");
});

test("renderDiagnostics summarizes and formats safely", () => {
  const r = renderDiagnostics([
    { severity: "error", code: "syntax", message: "bad", line: 3, column: 2 },
    { severity: "warning", code: "range", message: "hi", line: 1, column: 1 },
  ]);
  assert.equal(r.errorCount, 1);
  assert.equal(r.warningCount, 1);
  assert.equal(r.lines[0], "3:2: error syntax: bad");
  assert.equal(renderDiagnostics([]).summary, "No diagnostics.");
});

test("formatDiagnostic neutralizes control characters", () => {
  const line = formatDiagnostic({ severity: "error", code: "x", message: "a\u0000b\u001fc", line: 1, column: 1 });
  assert.ok(!/[\u0000-\u001f]/.test(line));
});

test("palette maps 4-bit indices to RGBA, ignoring high nibble", () => {
  assert.equal(PALETTE_RGBA.length, 64);
  const out = new Uint8ClampedArray(2 * 4);
  indexedToRgba(Uint8Array.from([0x00, 0xf1 /* index 1 after masking */]), out);
  assert.deepEqual([...out.slice(0, 3)], C64_PALETTE_RGB[0]);
  assert.deepEqual([...out.slice(4, 7)], C64_PALETTE_RGB[1]);
  assert.equal(out[3], 255);
});

test("keyboard matrix assembles active-low columns for the correct positions", () => {
  const none = buildKeyboardColumns(new Set());
  assert.deepEqual([...none], [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  // 'A' is column 1, row 2 -> column byte 1 has bit 2 cleared.
  const a = buildKeyboardColumns(new Set(["KeyA"]));
  assert.equal(a[1], 0xff & ~(1 << 2));
  // ArrowUp injects LEFT SHIFT (col1,row7) plus CRSR-UD (col0,row7).
  const up = buildKeyboardColumns(new Set(["ArrowUp"]));
  assert.equal(up[0], 0xff & ~(1 << 7));
  assert.equal(up[1], 0xff & ~(1 << 7));
  // Unmapped codes have no effect.
  assert.deepEqual([...buildKeyboardColumns(new Set(["MetaLeft"]))], [...none]);
});

test("joystick byte is active-low from mapped codes", () => {
  assert.equal(buildJoystick(new Set(), JOYSTICK2_MAP), 0xff);
  assert.equal(buildJoystick(new Set(["Numpad8"]), JOYSTICK2_MAP), 0xff & ~(1 << 0)); // up
  const fire = buildJoystick(new Set(["Numpad0"]), JOYSTICK2_MAP);
  assert.equal(fire, 0xff & ~(1 << 4));
});

test("buildShare computes url-length policy and source filename", () => {
  const small = buildShare("nop\n", "http://x/app/");
  assert.equal(small.withinLimit, true);
  assert.match(small.query, /^\?code=[A-Za-z0-9_-]+$/);
  const big = buildShare("A".repeat(200 * 1024), "http://x/app/");
  assert.equal(big.withinLimit, false);
  assert.equal(sourceFilename("My Prog!"), "my-prog.asm");
});

test("autosave round-trips a valid project and enforces version", () => {
  const text = serializeAutosave(makeProject({ source: "lda #$00\n", name: "demo" }));
  const back = parseAutosave(text);
  assert.equal(back.ok, true);
  assert.equal(back.project.name, "demo");
  assert.equal(serializeAutosave({ source: 7 }), null); // invalid project -> not persisted
  assert.equal(parseAutosave('{"v":2,"project":{}}').reason, "version-mismatch");
  assert.equal(parseAutosave("not json").reason, "invalid-json");
});

test("preferences keep only whitelisted, well-typed keys", () => {
  const text = serializePreferences({ timingProfile: "ntsc-6567r8", masterVolume: 0.5, secret: "x", joystickPort: 9 });
  const back = parsePreferences(text);
  assert.equal(back.ok, true);
  assert.deepEqual(back.prefs, { timingProfile: "ntsc-6567r8", masterVolume: 0.5 });
  assert.equal("secret" in back.prefs, false);
});
