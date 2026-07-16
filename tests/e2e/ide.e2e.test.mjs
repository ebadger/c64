// End-to-end browser test for the c64 web IDE. Drives the real static app against the ACTUAL
// production WASM artifact via the dev server and a headless Chromium. Covers the build worker,
// bundled OpenROMs default, custom-ROM privacy/gating, machine run + frame progression,
// keyboard release (stuck-key prevention),
// URL share/remix round-trip (Unicode), gallery load + reproducible buildId, artifact downloads,
// and D64 import. Skips cleanly when the WASM artifact or Playwright is not available.

import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync, readFileSync, mkdtempSync } from "node:fs";

import { startServer } from "../../scripts/dev/serve.mjs";
import { wasmArtifactExists, tryLoadPlaywright, syntheticRomArrays, buildTempDist, safeRm } from "./helpers.mjs";
import { encodeSourceToCode } from "../../web/client/lib/base64url.js";
import { buildD64 } from "../../src/d64.js";
import { buildArtifacts } from "../../src/index.js";
import { sha256Hex } from "../../src/hash.js";
import { makeProject } from "../../web/client/lib/projectModel.js";

// basic-sys is the default project mode: the assembler emits the BASIC stub at $0801 and places the
// machine code right after it, so the source must NOT force an overlapping `* = $0801` origin. It
// writes an observable byte to $0400 and loops on the border. In-app Run enters at the SYS target
// (runAddress, $080D here) per the reconciled Run contract.
const OBSERVABLE_PROGRAM = `start
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

  // Assemble the deployable dist (production WASM required) and serve THAT — the real bytes that
  // ship to GitHub Pages — rooted so the app is at "/".
  const distDir = buildTempDist();
  const workDir = mkdtempSync(join(tmpdir(), "c64-e2e-"));
  const { server, url } = await startServer({ port: 0, root: distDir });
  let browser;
  try {
    // The playwright package importing does not guarantee the Chromium BINARY is installed;
    // launch() throws when it is missing. Skip cleanly in that case (developer convenience); the
    // strict browser matrix in matrix.e2e.test.mjs is the enforcing release gate.
    try {
      browser = await chromium.launch();
    } catch (err) {
      t.skip(`Chromium binary not installed (npx playwright install chromium): ${err && err.message ? err.message : err}`);
      return;
    }
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    await page.goto(`${url}/`);
    await page.waitForFunction(() => typeof window.__c64 === "object");
    // Wait until init() (including decideInitialProject) has fully run, so the starter project can
    // never overwrite the source we fill below.
    await page.waitForFunction(() => window.__c64.initialized && window.__c64.initialized() === true, null, { timeout: 8000 });

    // --- Build via the worker ---------------------------------------------------------------
    // The app auto-builds its starter program on load (which also sets the name field), so set a
    // known name + source and wait for the specific build that matches OURS (by buildId).
    const expectedBuild = buildArtifacts({ name: "e2etest", source: OBSERVABLE_PROGRAM, timingProfile: "pal-6569", outputName: "e2etest" });
    assert.equal(expectedBuild.ok, true, "the observable program must assemble");
    await page.fill("#project-name", "e2etest");
    await page.fill("#editor", OBSERVABLE_PROGRAM);
    await page.waitForFunction(
      (id) => {
        const b = window.__c64.lastBuild();
        return b !== null && b.buildId === id;
      },
      expectedBuild.assembly.buildId,
      { timeout: 8000 },
    );
    const build = await page.evaluate(() => window.__c64.lastBuild());
    assert.ok(build.buildId && build.prgLen > 0 && build.d64Len === 174848, "build produced a PRG and full D64");

    // --- Bundled OpenROMs default -------------------------------------------------------------
    assert.equal(await page.evaluate(() => window.__c64.romSource()), "bundled");
    assert.equal(await page.evaluate(() => window.__c64.romReady()), true);
    assert.equal(await page.evaluate(() => window.__c64.runEnabled()), true);
    assert.equal(await page.locator("#sel-rom-source").inputValue(), "bundled");
    assert.equal(await page.locator("#rom-custom").isHidden(), true);
    assert.match(await page.locator("#rom-license-link").getAttribute("href"), /\/roms\/LICENSE\.txt$/);
    assert.match(await page.locator("#rom-source-link").getAttribute("href"), /\/roms\/open-roms-.*\.tar\.gz$/);

    // ROM bytes and source-selection state never touch storage.
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

    // --- Complete custom local ROM override -------------------------------------------------
    await page.selectOption("#sel-rom-source", "custom");
    assert.equal(await page.evaluate(() => window.__c64.romSource()), "custom");
    assert.equal(await page.evaluate(() => window.__c64.romReady()), false);
    assert.equal(await page.evaluate(() => window.__c64.runEnabled()), false);
    assert.equal(await page.locator("#rom-custom").isVisible(), true);

    const customRoms = syntheticRomArrays();
    const staleBasic = [...customRoms.basic];
    staleBasic[0] ^= 0xff;
    const staleBasicPath = join(workDir, "stale-basic.rom");
    const currentBasicPath = join(workDir, "current-basic.rom");
    writeFileSync(staleBasicPath, Buffer.from(staleBasic));
    writeFileSync(currentBasicPath, Buffer.from(customRoms.basic));
    const currentBasicDigest = sha256Hex(Uint8Array.from(customRoms.basic));

    // A delayed earlier read must not replace the user's newer selection for the same role.
    await page.evaluate(() => {
      const originalArrayBuffer = File.prototype.arrayBuffer;
      let markStarted;
      let releaseSlowRead;
      const started = new Promise((resolve) => {
        markStarted = resolve;
      });
      File.prototype.arrayBuffer = function arrayBuffer() {
        if (this.name !== "stale-basic.rom") return originalArrayBuffer.call(this);
        markStarted();
        return new Promise((resolve, reject) => {
          releaseSlowRead = () => originalArrayBuffer.call(this).then(resolve, reject);
        }).finally(() => {
          window.__romReadRace.delivered = true;
        });
      };
      window.__romReadRace = {
        delivered: false,
        waitForStart: () => started,
        release: () => releaseSlowRead(),
        restore: () => {
          File.prototype.arrayBuffer = originalArrayBuffer;
          delete window.__romReadRace;
        },
      };
    });
    await page.setInputFiles('input[data-role="basic"]', staleBasicPath);
    await page.evaluate(() => window.__romReadRace.waitForStart());
    await page.setInputFiles('input[data-role="basic"]', currentBasicPath);
    await page.waitForFunction(
      (digest) => document.querySelector('input[data-role="basic"]')?.closest(".rom-role")?.querySelector(".digest")?.textContent.includes(digest),
      currentBasicDigest,
    );
    await page.evaluate(() => window.__romReadRace.release());
    await page.waitForFunction(() => window.__romReadRace.delivered);
    await page.waitForTimeout(0);
    assert.match(
      await page.locator('input[data-role="basic"]').locator("xpath=ancestor::div[contains(@class,'rom-role')]").locator(".digest").textContent(),
      new RegExp(currentBasicDigest),
      "the latest same-role custom ROM selection wins",
    );
    await page.evaluate(() => window.__romReadRace.restore());
    await page.getByRole("button", { name: "Confirm basic ROM" }).click();

    for (const role of ["kernal", "chargen"]) {
      const path = join(workDir, `${role}.rom`);
      writeFileSync(path, Buffer.from(customRoms[role]));
      await page.setInputFiles(`input[data-role="${role}"]`, path);
      await page.getByRole("button", { name: `Confirm ${role} ROM` }).click();
    }
    assert.equal(await page.evaluate(() => window.__c64.romReady()), true);
    assert.equal(await page.evaluate(() => window.__c64.runEnabled()), true);
    assert.equal(
      await page.evaluate(() => {
        for (let i = 0; i < localStorage.length; i++) {
          if ((localStorage.getItem(localStorage.key(i)) || "").length > 4096) return true;
        }
        return false;
      }),
      false,
      "custom ROM bytes are not written to storage",
    );
    await page.click("#btn-run");
    await page.waitForFunction(() => window.__c64.running() === true, null, { timeout: 5000 });
    await page.click("#btn-stop");

    // Returning to the default clears the custom set and revalidates all bundled roles.
    await page.selectOption("#sel-rom-source", "bundled");
    await page.waitForFunction(() => window.__c64.romSource() === "bundled" && window.__c64.romReady());
    assert.equal(await page.evaluate(() => window.__c64.runEnabled()), true);
    assert.equal(await page.locator("#rom-custom").isHidden(), true);

    // --- Artifact download bytes ------------------------------------------------------------
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#btn-dl-prg")]);
    const prgPath = join(workDir, "out.prg");
    await download.saveAs(prgPath);
    // Byte-for-byte equality against the independently-assembled PRG (not just length).
    const expectedPrg = new Uint8Array(buildArtifacts(makeProject({ source: OBSERVABLE_PROGRAM })).bundle.prg);
    assert.deepEqual(new Uint8Array(readFileSync(prgPath)), expectedPrg, "downloaded PRG is byte-identical to the assembled PRG");
    assert.equal(build.prgLen, expectedPrg.length, "reported PRG length matches");

    // --- D64 import (read-only) -------------------------------------------------------------
    const disk = buildD64({ outputName: "PROG", diskName: "TESTDISK", diskId: "ID" }, Uint8Array.from([0x01, 0x08, 0x2a, 0x2b]));
    assert.equal(disk.ok, true);
    const d64Path = join(workDir, "test.d64");
    writeFileSync(d64Path, Buffer.from(disk.d64));
    await page.setInputFiles("#d64-file", d64Path);
    await page.waitForFunction(() => /Selected|Mounted/.test(document.getElementById("d64-status").textContent));

    // --- Gallery load + reproducible buildId ------------------------------------------------
    const expected = JSON.parse(readFileSync(new URL("../../web/client/gallery.json", import.meta.url)));
    await page.waitForFunction(() => document.querySelectorAll("#gallery-list .gallery-item").length >= 1);
    await page.click("#gallery-list .gallery-item button");
    await page.waitForFunction(() => document.getElementById("editor").value.includes("border-flash"), null, { timeout: 8000 });
    // Wait for the gallery entry's specific build (not any earlier build) to land.
    await page.waitForFunction(
      (id) => {
        const b = window.__c64.lastBuild();
        return b !== null && b.buildId === id;
      },
      expected[0].expectedBuildId,
      { timeout: 8000 },
    );
    const galleryBuild = await page.evaluate(() => window.__c64.lastBuild());
    assert.equal(galleryBuild.buildId, expected[0].expectedBuildId, "gallery entry reproduces its buildId in-browser");

    // --- URL share/remix round-trip (Unicode) -----------------------------------------------
    const unicode = "; remix ☕ 日本語\nlda #$01\nrts\n";
    const code = encodeSourceToCode(unicode);
    await page.goto(`${url}/?code=${code}`);
    await page.waitForFunction(() => typeof window.__c64 === "object");
    await page.waitForFunction(
      (expected) => document.getElementById("editor").value === expected,
      unicode,
      { timeout: 5000 },
    );

    // --- Malformed ?code is a visible error, not a silent fallback --------------------------
    await page.goto(`${url}/?code=@@@@`);
    await page.waitForFunction(() => typeof window.__c64 === "object");
    await page.waitForFunction(() => window.__c64.errors().some((e) => e.category === "url"));

    assert.deepEqual(pageErrors, [], `no uncaught page errors: ${pageErrors.join("; ")}`);
  } finally {
    if (browser) await browser.close();
    server.close();
    safeRm(distDir);
    safeRm(workDir);
  }
});
