// End-to-end browser test for the c64 web IDE. Drives the real static app against the ACTUAL
// production WASM artifact via the dev server and a headless Chromium. Covers the build worker,
// ROM privacy/gating, machine run + frame progression, keyboard release (stuck-key prevention),
// URL share/remix round-trip (Unicode), gallery load + reproducible buildId, artifact downloads,
// and D64 import. Skips cleanly when the WASM artifact or Playwright is not available.

import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";

import { startServer } from "../../scripts/dev/serve.mjs";
import { wasmArtifactExists, tryLoadPlaywright, syntheticRomArrays } from "./helpers.mjs";
import { encodeSourceToCode } from "../../web/client/lib/base64url.js";
import { buildD64 } from "../../src/d64.js";

const OBSERVABLE_PROGRAM = `* = $0801
start
        lda #$07
        sta $0400
loop
        inc $d020
        jmp loop
`;

test("c64 IDE end-to-end against the production WASM artifact", async (t) => {
  if (!wasmArtifactExists()) {
    t.skip("WASM artifact not built (build/wasm/c64core.mjs)");
    return;
  }
  const chromium = await tryLoadPlaywright();
  if (!chromium) {
    t.skip("Playwright not installed (npm i -D playwright && npx playwright install chromium)");
    return;
  }

  const { server, url } = await startServer({ port: 0 });
  let browser;
  try {
    browser = await chromium.launch();
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.goto(`${url}/web/client/`);
    await page.waitForFunction(() => typeof window.__c64 === "object");

    // --- Build via the worker ---------------------------------------------------------------
    await page.fill("#editor", OBSERVABLE_PROGRAM);
    await page.waitForFunction(() => window.__c64.lastBuild() !== null, null, { timeout: 5000 });
    const build = await page.evaluate(() => window.__c64.lastBuild());
    assert.ok(build.buildId && build.prgLen > 0 && build.d64Len === 174848, "build produced a PRG and full D64");

    // Run is disabled until a valid ROM set exists.
    assert.equal(await page.evaluate(() => window.__c64.runEnabled()), false);

    // --- ROM privacy + gating ---------------------------------------------------------------
    const roms = syntheticRomArrays();
    await page.evaluate((r) => {
      window.__c64.setRomBytes("basic", r.basic);
      window.__c64.setRomBytes("kernal", r.kernal);
      window.__c64.setRomBytes("chargen", r.chargen);
    }, roms);
    assert.equal(await page.evaluate(() => window.__c64.romReady()), true);
    assert.equal(await page.evaluate(() => window.__c64.runEnabled()), true);
    // ROM bytes never touch storage.
    const storedHasRom = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const v = localStorage.getItem(localStorage.key(i)) || "";
        if (v.length > 4096) return true;
      }
      return false;
    });
    assert.equal(storedHasRom, false, "no ROM-sized blob is ever written to storage");

    // --- Run + frame progression + observable RAM write -------------------------------------
    await page.click("#btn-run");
    await page.waitForFunction(() => window.__c64.running() === true, null, { timeout: 5000 });
    const seq1 = await page.evaluate(() => window.__c64.frame().sequence);
    await page.waitForTimeout(250);
    const seq2 = await page.evaluate(() => window.__c64.frame().sequence);
    assert.ok(Number(seq2) > Number(seq1), "frame sequence advances while running");
    assert.equal(await page.evaluate(() => window.__c64.peek(0x0400)), 0x07, "program wrote $07 to $0400");

    // --- Keyboard release (stuck-key prevention) --------------------------------------------
    await page.focus("#screen-surface");
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" })));
    const colA = await page.evaluate(() => window.__c64.inputSnapshot().keyboardColumns[1]);
    assert.equal(colA, 0xff & ~(1 << 2), "KeyA pulls column 1 row 2 low");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const released = await page.evaluate(() => [...window.__c64.inputSnapshot().keyboardColumns]);
    assert.deepEqual(released, [255, 255, 255, 255, 255, 255, 255, 255], "blur releases all keys");

    await page.click("#btn-stop");
    await page.waitForFunction(() => window.__c64.running() === false);

    // --- Artifact download bytes ------------------------------------------------------------
    const dir = mkdtempSync(join(tmpdir(), "c64-e2e-"));
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#btn-dl-prg")]);
    const prgPath = join(dir, "out.prg");
    await download.saveAs(prgPath);
    assert.equal(readFileSync(prgPath).length, build.prgLen, "downloaded PRG has the exact byte length");

    // --- D64 import (read-only) -------------------------------------------------------------
    const disk = buildD64({ outputName: "PROG", diskName: "TESTDISK", diskId: "ID" }, Uint8Array.from([0x01, 0x08, 0x2a, 0x2b]));
    assert.equal(disk.ok, true);
    const d64Path = join(dir, "test.d64");
    writeFileSync(d64Path, Buffer.from(disk.d64));
    await page.setInputFiles("#d64-file", d64Path);
    await page.waitForFunction(() => /Selected|Mounted/.test(document.getElementById("d64-status").textContent));

    // --- Gallery load + reproducible buildId ------------------------------------------------
    await page.waitForFunction(() => document.querySelectorAll("#gallery-list .gallery-item").length >= 1);
    await page.click("#gallery-list .gallery-item button");
    await page.waitForFunction(() => document.getElementById("editor").value.includes("border-flash"), null, { timeout: 5000 });
    await page.waitForFunction(() => window.__c64.lastBuild() !== null);
    const galleryBuild = await page.evaluate(() => window.__c64.lastBuild());
    const expected = JSON.parse(readFileSync(new URL("../../web/client/gallery.json", import.meta.url)));
    assert.equal(galleryBuild.buildId, expected[0].expectedBuildId, "gallery entry reproduces its buildId in-browser");

    // --- URL share/remix round-trip (Unicode) -----------------------------------------------
    const unicode = "; remix ☕ 日本語\nlda #$01\nrts\n";
    const code = encodeSourceToCode(unicode);
    await page.goto(`${url}/web/client/?code=${code}`);
    await page.waitForFunction(() => typeof window.__c64 === "object");
    await page.waitForFunction(
      (expected) => document.getElementById("editor").value === expected,
      unicode,
      { timeout: 5000 },
    );

    // --- Malformed ?code is a visible error, not a silent fallback --------------------------
    await page.goto(`${url}/web/client/?code=@@@@`);
    await page.waitForFunction(() => typeof window.__c64 === "object");
    await page.waitForFunction(() => window.__c64.errors().some((e) => e.category === "url"));

    assert.deepEqual(pageErrors, [], `no uncaught page errors: ${pageErrors.join("; ")}`);
  } finally {
    if (browser) await browser.close();
    server.close();
  }
});
