// End-to-end browser test for the c64 web IDE. Drives the real static app against the ACTUAL
// production WASM artifact via the dev server and a headless Chromium. Covers the build worker,
// bundled Pascual ROM default + BASIC boot, custom-ROM privacy/gating, direct Run progression,
// keyboard release (stuck-key prevention),
// URL share/remix round-trip (Unicode), gallery load + reproducible buildId, artifact downloads,
// and D64 directory/launch/eject behavior. Skips cleanly when the WASM artifact or Playwright is
// not available.

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

const DISK_PROGRAM = `start
        lda #$5a
        sta $0420
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
    assert.equal(await page.locator("#sel-timing").inputValue(), "ntsc-6567r8", "new projects default to NTSC");

    // --- Build via the worker ---------------------------------------------------------------
    // The app auto-builds its starter program on load (which also sets the name field), so set a
    // known name + source and wait for the specific build that matches OURS (by buildId).
    const expectedBuild = buildArtifacts({ name: "e2etest", source: OBSERVABLE_PROGRAM, timingProfile: "ntsc-6567r8", outputName: "e2etest" });
    assert.equal(expectedBuild.ok, true, "the observable program must assemble");
    await page.fill("#project-name", "e2etest");
    await page.fill("#editor", OBSERVABLE_PROGRAM);
    await page.click("#btn-build-run");
    // Pacing can become active before the first machine batch; wait for the program's write too.
    await page.waitForFunction(
      (id) => {
        const b = window.__c64.lastBuild();
        return b !== null
          && b.buildId === id
          && window.__c64.running()
          && window.__c64.peek(0x0400) === 0x07;
      },
      expectedBuild.assembly.buildId,
      { timeout: 8000 },
    );
    const build = await page.evaluate(() => window.__c64.lastBuild());
    assert.ok(build.buildId && build.prgLen > 0 && build.d64Len === 174848, "build produced a PRG and full D64");
    assert.equal(await page.evaluate(() => window.__c64.peek(0x0400)), 0x07, "Build & Run starts its exact successful result");
    const ntscDisplay = await page.evaluate(() => {
      const canvas = document.getElementById("screen");
      const rect = canvas.getBoundingClientRect();
      const frame = window.__c64.frame();
      return {
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        frameWidth: frame.width,
        frameHeight: frame.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
      };
    });
    assert.deepEqual(
      [ntscDisplay.backingWidth, ntscDisplay.backingHeight, ntscDisplay.frameWidth, ntscDisplay.frameHeight],
      [384, 235, 384, 235],
      "NTSC uses its complete native framebuffer",
    );
    await page.click("#btn-stop");

    // --- Bundled Pascual ROM default + real reset-vector BASIC boot ---------------------------
    assert.equal(await page.evaluate(() => window.__c64.romSource()), "bundled");
    assert.equal(await page.evaluate(() => window.__c64.romReady()), true);
    assert.equal(await page.evaluate(() => window.__c64.runEnabled()), true);
    assert.equal(await page.evaluate(() => window.__c64.bootBasicEnabled()), true);
    assert.equal(await page.locator("#sel-rom-source").inputValue(), "bundled");
    assert.equal(await page.locator("#rom-custom").isHidden(), true);
    assert.match(await page.locator("#rom-license-link").getAttribute("href"), /\/roms\/LICENSE\.txt$/);
    assert.match(await page.locator("#rom-source-link").getAttribute("href"), /\/roms\/pascuals-basic-.*\.tar\.gz$/);
    assert.match(await page.locator("#rom-basic-license-link").getAttribute("href"), /\/roms\/LICENSE-microsoft\.txt$/);

    await page.selectOption("#sel-timing", "pal-6569");
    await page.click("#btn-boot-basic");
    await page.waitForFunction(
      () => window.__c64.running()
        && window.__c64.frame().height === 284
        && document.getElementById("screen").height === 284,
      null,
      { timeout: 15000 },
    );
    const palDisplay = await page.evaluate(() => {
      const canvas = document.getElementById("screen");
      const rect = canvas.getBoundingClientRect();
      return {
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
      };
    });
    assert.deepEqual(
      [palDisplay.backingWidth, palDisplay.backingHeight],
      [384, 284],
      "PAL uses its complete native framebuffer",
    );
    assert.ok(Math.abs(palDisplay.cssWidth - ntscDisplay.cssWidth) < 0.5, "timing switches keep the display width");
    assert.ok(Math.abs(palDisplay.cssHeight - ntscDisplay.cssHeight) < 0.5, "timing switches keep the display height");
    await page.click("#btn-stop");
    await page.selectOption("#sel-timing", "ntsc-6567r8");

    await page.click("#btn-boot-basic");
    await page.waitForFunction(
      () => {
        const text = window.__c64.screenText();
        return text.includes("PASCUAL'S BASIC") && text.includes("READY.");
      },
      null,
      { timeout: 15000 },
    );
    const ntscAfterPal = await page.evaluate(() => {
      const canvas = document.getElementById("screen");
      const rect = canvas.getBoundingClientRect();
      return {
        backingWidth: canvas.width,
        backingHeight: canvas.height,
        cssWidth: rect.width,
        cssHeight: rect.height,
      };
    });
    assert.deepEqual(
      [ntscAfterPal.backingWidth, ntscAfterPal.backingHeight],
      [384, 235],
      "switching back to NTSC restores its complete native framebuffer",
    );
    assert.ok(Math.abs(ntscAfterPal.cssWidth - palDisplay.cssWidth) < 0.5, "PAL to NTSC keeps the display width");
    assert.ok(Math.abs(ntscAfterPal.cssHeight - palDisplay.cssHeight) < 0.5, "PAL to NTSC keeps the display height");
    assert.equal(await page.evaluate(() => window.__c64.activeMode()), "basic");
    const basicSeq1 = await page.evaluate(() => window.__c64.frame().sequence);
    await page.waitForTimeout(250);
    const basicSeq2 = await page.evaluate(() => window.__c64.frame().sequence);
    assert.ok(Number(basicSeq2) > Number(basicSeq1), "BASIC boot advances production frames");

    await page.focus("#screen-surface");
    for (const key of ["p", "r", "i", "n", "t", " ", "4", "Enter"]) {
      await page.keyboard.down(key);
      await page.waitForTimeout(60);
      await page.keyboard.up(key);
      await page.waitForTimeout(60);
    }
    await page.waitForFunction(
      () => {
        const text = window.__c64.screenText();
        return text.includes("PRINT 4") && (text.match(/READY\./g) || []).length >= 2;
      },
      null,
      { timeout: 10000 },
    );

    await page.click("#virtual-keyboard-summary");
    for (const id of ["key-p", "key-r", "key-i", "key-n", "key-t", "space", "digit-5", "return"]) {
      await page.click(`[data-key-id="${id}"]`);
      await page.waitForTimeout(130);
    }
    await page.waitForFunction(
      () => {
        const text = window.__c64.screenText();
        return text.includes("PRINT 5") && (text.match(/READY\./g) || []).length >= 3;
      },
      null,
      { timeout: 10000 },
    );
    await page.click("#btn-stop");

    const virtualChord = await page.evaluate(() => {
      document.querySelector('[data-key-id="left-shift"]').click();
      document.querySelector('[data-key-id="key-a"]').click();
      return [...window.__c64.inputSnapshot().keyboardColumns];
    });
    assert.equal(virtualChord[1], 0xff & ~(1 << 7) & ~(1 << 2), "virtual SHIFT+A reaches the shared matrix");
    await page.waitForTimeout(130);
    const virtualReleased = await page.evaluate(() => [...window.__c64.inputSnapshot().keyboardColumns]);
    assert.deepEqual(virtualReleased, [255, 255, 255, 255, 255, 255, 255, 255], "virtual pulse releases its chord");

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
    await page.focus("#editor");
    await page.keyboard.press("Control+Enter");
    await page.waitForFunction(() => window.__c64.running() === true, null, { timeout: 5000 });
    const seq1 = await page.evaluate(() => window.__c64.frame().sequence);
    await page.waitForTimeout(250);
    const seq2 = await page.evaluate(() => window.__c64.frame().sequence);
    assert.ok(Number(seq2) > Number(seq1), "frame sequence advances while running");
    assert.equal(await page.evaluate(() => window.__c64.peek(0x0400)), 0x07, "Ctrl+Enter builds and runs the current source");

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

    // --- D64 directory, direct PRG launch, reset continuity, and live eject -----------------
    const diskProgram = buildArtifacts(makeProject({
      name: "disk-program",
      source: DISK_PROGRAM,
      outputName: "PROG",
    }));
    assert.equal(diskProgram.ok, true, "the disk program must assemble");
    const disk = buildD64(
      { outputName: "PROG", diskName: "TESTDISK", diskId: "ID" },
      diskProgram.bundle.prg,
    );
    assert.equal(disk.ok, true);
    const d64Path = join(workDir, "test.d64");
    writeFileSync(d64Path, Buffer.from(disk.d64));
    await page.setInputFiles("#d64-file", d64Path);
    await page.waitForFunction(() => document.getElementById("d64-controls").hidden === false);
    assert.match(await page.locator("#d64-status").textContent(), /Selected TESTDISK/);
    assert.match(await page.locator("#d64-program option").textContent(), /"PROG" PRG/);
    assert.equal(
      await page.locator("#d64-entry").inputValue(),
      `$${diskProgram.assembly.runAddress.toString(16).toUpperCase().padStart(4, "0")}`,
      "the first-line BASIC SYS target is detected",
    );
    assert.equal(await page.locator("#btn-run-d64").isEnabled(), true);

    await page.click("#btn-boot-basic");
    await page.waitForFunction(
      () => window.__c64.running() && window.__c64.activeMode() === "basic"
        && window.__c64.diskMounted() && window.__c64.screenText().includes("READY."),
      null,
      { timeout: 15000 },
    );
    await page.click("#btn-reset");
    await page.waitForFunction(
      () => window.__c64.running() && window.__c64.activeMode() === "basic"
        && window.__c64.diskMounted() && window.__c64.screenText().includes("READY."),
      null,
      { timeout: 15000 },
    );
    await page.click("#btn-stop");

    await page.click("#btn-run-d64");
    await page.waitForFunction(
      () => window.__c64.running() && window.__c64.peek(0x0420) === 0x5a,
      null,
      { timeout: 5000 },
    );
    assert.equal(await page.evaluate(() => window.__c64.diskMounted()), true);

    // A pending older file read must not remount media after the user presses Eject.
    const replacementD64Path = join(workDir, "replacement.d64");
    writeFileSync(replacementD64Path, Buffer.from(disk.d64));
    await page.evaluate(() => {
      const originalArrayBuffer = File.prototype.arrayBuffer;
      let markStarted;
      let releaseSlowRead;
      const started = new Promise((resolve) => {
        markStarted = resolve;
      });
      File.prototype.arrayBuffer = function arrayBuffer() {
        if (this.name !== "replacement.d64") return originalArrayBuffer.call(this);
        markStarted();
        return new Promise((resolve, reject) => {
          releaseSlowRead = () => originalArrayBuffer.call(this).then(resolve, reject);
        }).finally(() => {
          window.__d64ReadRace.delivered = true;
        });
      };
      window.__d64ReadRace = {
        delivered: false,
        waitForStart: () => started,
        release: () => releaseSlowRead(),
        restore: () => {
          File.prototype.arrayBuffer = originalArrayBuffer;
          delete window.__d64ReadRace;
        },
      };
    });
    await page.setInputFiles("#d64-file", replacementD64Path);
    await page.evaluate(() => window.__d64ReadRace.waitForStart());
    const diskSeqBeforeEject = await page.evaluate(() => window.__c64.frame().sequence);
    await page.click("#btn-eject-d64");
    assert.equal(await page.evaluate(() => window.__c64.diskMounted()), false);
    assert.equal(await page.locator("#d64-controls").isHidden(), true);
    assert.equal(await page.locator("#d64-status").textContent(), "No disk mounted.");
    assert.equal(await page.evaluate(() => window.__c64.running()), true, "eject does not stop the CPU");
    await page.waitForTimeout(150);
    const diskSeqAfterEject = await page.evaluate(() => window.__c64.frame().sequence);
    assert.ok(Number(diskSeqAfterEject) > Number(diskSeqBeforeEject), "frames continue after eject");

    await page.evaluate(() => window.__d64ReadRace.release());
    await page.waitForFunction(() => window.__d64ReadRace.delivered);
    await page.waitForTimeout(0);
    assert.equal(await page.locator("#d64-controls").isHidden(), true, "a stale disk read cannot undo Eject");
    await page.evaluate(() => window.__d64ReadRace.restore());

    await page.click("#btn-reset");
    await page.waitForFunction(
      () => window.__c64.running() && window.__c64.peek(0x0420) === 0x5a,
      null,
      { timeout: 5000 },
    );
    await page.click("#btn-stop");

    // --- Gallery load + reproducible buildId ------------------------------------------------
    const expected = JSON.parse(readFileSync(new URL("../../web/client/gallery.json", import.meta.url)));
    await page.waitForFunction(() => document.querySelectorAll("#gallery-list .gallery-item").length >= 1);
    await page.selectOption("#gallery-select", expected[0].id);
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

    await page.click("#btn-run");
    await page.waitForFunction(() => window.__c64.running() === true, null, { timeout: 5000 });
    const borderColors = await page.evaluate(async () => {
      const observed = new Set();
      const deadline = performance.now() + 800;
      while (performance.now() < deadline) {
        const frame = window.__c64.frame();
        if (frame && frame.pixels.length > 0) observed.add(frame.pixels[0]);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return [...observed];
    });
    const paletteColors = borderColors.filter((color) => [0x00, 0x06, 0x0e, 0x01, 0x02].includes(color));
    assert.ok(new Set(paletteColors).size >= 3, `border example visibly cycles colours: ${borderColors.join(", ")}`);
    await page.click("#btn-stop");

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
