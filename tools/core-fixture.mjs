// Deterministic core test fixtures, generated from the already-merged src/ assembler. This is
// Node tooling (not part of the browser/Node production pipeline). It assembles a direct-mode
// PRG that writes the VIC-II border ($D020) and background ($D021) colour registers, so both the
// native golden test and the headless WASM smoke test exercise the SAME assembler output against
// the SAME production core. No ROM bytes are involved.

import { assemble } from "../src/index.js";

// Framebuffer geometry must match core/include/c64/vicii.hpp.
export const FB_WIDTH = 384;
export const FB_HEIGHT = 272;
export const BORDER_X = 32;
export const BORDER_Y = 36;

// A minimal direct-mode program: set border=RED($02) and background=BLUE($06), then spin.
const BORDER_BG_SOURCE = [
  "BORDER = $d020",
  "BG     = $d021",
  "        lda #$02",
  "        sta BORDER",
  "        lda #$06",
  "        sta BG",
  "loop    jmp loop",
  "",
].join("\n");

const BORDER_COLOR = 0x02;
const BACKGROUND_COLOR = 0x06;
const LOAD_ADDRESS = 0xc000;

/**
 * Assemble the border/background fixture and return everything the native and WASM tests need.
 * Throws if assembly fails so drift or a broken assembler surfaces immediately.
 */
export function buildBorderBgFixture() {
  const project = {
    schema: 1,
    name: "core-border-bg",
    source: BORDER_BG_SOURCE,
    target: "nmos-6510",
    loadAddress: LOAD_ADDRESS,
    runMode: "direct",
    runAddress: LOAD_ADDRESS,
    timingProfile: "pal-6569",
    outputName: "CORE-BORDER-BG",
  };
  const result = assemble(project);
  if (!result.ok) {
    throw new Error(`fixture assembly failed: ${JSON.stringify(result.diagnostics)}`);
  }
  const prg = Array.from(result.prg);
  // Sample points: a border corner and the display centre.
  const centreX = BORDER_X + 160;
  const centreY = BORDER_Y + 100;
  return {
    name: "border-bg",
    prg,
    loadAddress: result.loadAddress,
    runAddress: result.runAddress,
    timingProfile: "pal-6569",
    expected: {
      border: BORDER_COLOR,
      background: BACKGROUND_COLOR,
      width: FB_WIDTH,
      height: FB_HEIGHT,
      borderSample: { x: 0, y: 0, index: 0, color: BORDER_COLOR },
      centreSample: { x: centreX, y: centreY, index: centreY * FB_WIDTH + centreX, color: BACKGROUND_COLOR },
    },
  };
}
