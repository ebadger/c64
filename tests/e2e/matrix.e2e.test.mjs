// Browser-matrix end-to-end test. Assembles the deployable `dist/` (production WASM required) and
// drives the real user journey with PRODUCTION bytes across the pinned Playwright browser matrix
// (Chromium, Firefox, WebKit) at BOTH the localhost root ("/") and a GitHub Pages project base
// ("/c64/"), proving base-path independence. Covers: page load + capability init, gallery presence,
// edit/build via the worker, bundled Pascual BASIC boot, direct Run + frame
// progression + observable RAM write, keyboard release on blur, PRG download byte-equality, and a
// malformed ?code error.
//
// Local developer convenience: missing browsers or a missing WASM artifact SKIP cleanly. The
// release gate sets C64_E2E_REQUIRE (e.g. "1") so a missing artifact or required browser FAILS
// instead of skipping. No test depends on proprietary Commodore ROMs or any network service.

import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";

import { startServer } from "../../scripts/dev/serve.mjs";
import {
  wasmArtifactExists,
  requiredBrowsers,
  tryLoadBrowser,
  buildTempDist,
  stageDistBasePaths,
  safeRm,
} from "./helpers.mjs";
import { buildArtifacts } from "../../src/index.js";
import { makeProject } from "../../web/client/lib/projectModel.js";

// basic-sys is the default project mode: the stub occupies $0801 and code is placed after it, so
// the source must not force an overlapping `* = $0801` origin. Run enters at the SYS target.
const OBSERVABLE_PROGRAM = `start
        lda #$07
        sta $0400
loop
        inc $d020
        jmp loop
`;

// Independently assemble the EXPECTED artifacts with the Node pipeline, mirroring EXACTLY the
// project the app builds from the UI (syncProjectFromUI: name + outputName from the project-name
// field, default pal-6569 timing). This lets the browser test wait for OUR specific build by
// buildId (never a stale starter build) and compare the downloaded PRG byte-for-byte.
const EXPECTED = (() => {
  const project = makeProject({
    name: "matrixtest",
    source: OBSERVABLE_PROGRAM,
    timingProfile: "pal-6569",
    outputName: "matrixtest",
  });
  const r = buildArtifacts(project);
  if (!r.ok) throw new Error("matrix test fixture failed to assemble");
  return { prg: new Uint8Array(r.bundle.prg), buildId: r.assembly.buildId };
})();
const EXPECTED_PRG = EXPECTED.prg;
const EXPECTED_BUILD_ID = EXPECTED.buildId;

async function runJourney(browser, base, url, expectedPrgLen) {
  const page = await browser.newPage();
  try {
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(String(e)));

    // Load at the given base path (proves relative resolution under "/" and "/c64/").
    await page.goto(`${url}${base}`);
    await page.waitForFunction(() => typeof window.__c64 === "object");
    // Wait until init() (incl. decideInitialProject + the starter auto-build) has fully run, so the
    // starter project can never overwrite the source we fill below or leave a stale pending build.
    await page.waitForFunction(() => window.__c64.initialized && window.__c64.initialized() === true, null, { timeout: 8000 });
    // Gallery loaded through the same-origin relative path -> init completed successfully.
    await page.waitForFunction(() => document.querySelectorAll("#gallery-list .gallery-item").length >= 1);
    // Capability detection succeeded (no capability-error banner) for this evergreen browser.
    assert.equal(await page.evaluate(() => document.getElementById("capability-error").hidden), true);
    // Honest optional-capability fallback: the audio control's enabled state matches Web Audio
    // availability (some headless browsers, e.g. WebKit, provide no Web Audio — the emulator still
    // runs, only sound is disabled).
    const audioState = await page.evaluate(() => ({
      available: window.__c64.audioAvailable(),
      btnDisabled: document.getElementById("btn-audio").disabled,
    }));
    assert.equal(audioState.btnDisabled, !audioState.available, `${base}: audio control reflects Web Audio availability`);

    // Edit + build through the worker. The app auto-builds its starter program on load, so set a
    // known name + source and wait for the specific build that matches OURS (by buildId) — never a
    // stale starter build.
    await page.fill("#project-name", "matrixtest");
    await page.fill("#editor", OBSERVABLE_PROGRAM);
    await page.waitForFunction(
      (id) => {
        const b = window.__c64.lastBuild();
        return b !== null && b.buildId === id;
      },
      EXPECTED_BUILD_ID,
      { timeout: 8000 },
    );
    const build = await page.evaluate(() => window.__c64.lastBuild());
    assert.ok(build.buildId && build.prgLen > 0 && build.d64Len === 174848, `${base}: build produced PRG + full D64`);
    assert.equal(await page.evaluate(() => window.__c64.romSource()), "bundled", `${base}: bundled Pascual ROMs selected`);
    assert.equal(await page.evaluate(() => window.__c64.romReady()), true, `${base}: bundled Pascual ROMs verified`);
    assert.equal(await page.evaluate(() => window.__c64.runEnabled()), true, `${base}: Run enabled by default`);
    assert.equal(await page.evaluate(() => window.__c64.bootBasicEnabled()), true, `${base}: Boot BASIC enabled by default`);

    // Bundled and custom ROM bytes never touch browser storage.
    const storedHasRom = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        if ((localStorage.getItem(localStorage.key(i)) || "").length > 4096) return true;
      }
      return false;
    });
    assert.equal(storedHasRom, false, `${base}: no ROM blob in storage`);

    // Cold-start the bundled ROM reset vector to the real BASIC prompt.
    await page.click("#btn-boot-basic");
    await page.waitForFunction(
      () => window.__c64.running() && window.__c64.activeMode() === "basic"
        && window.__c64.screenText().includes("PASCUAL'S BASIC")
        && window.__c64.screenText().includes("READY."),
      null,
      { timeout: 15000 },
    );
    const basicSeq1 = await page.evaluate(() => window.__c64.frame().sequence);
    await page.waitForTimeout(250);
    const basicSeq2 = await page.evaluate(() => window.__c64.frame().sequence);
    assert.ok(Number(basicSeq2) > Number(basicSeq1), `${base}: BASIC frame sequence advances`);
    await page.click("#btn-stop");

    // Direct-entry Run remains deterministic and writes observable RAM.
    await page.click("#btn-build-run");
    await page.waitForFunction(() => window.__c64.running() === true, null, { timeout: 8000 });
    const seq1 = await page.evaluate(() => window.__c64.frame().sequence);
    await page.waitForTimeout(250);
    const seq2 = await page.evaluate(() => window.__c64.frame().sequence);
    assert.ok(Number(seq2) > Number(seq1), `${base}: frame sequence advances`);
    assert.equal(await page.evaluate(() => window.__c64.peek(0x0400)), 0x07, `${base}: program wrote $07 to $0400`);

    // Keyboard release on blur (stuck-key prevention).
    await page.focus("#screen-surface");
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyA" })));
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    const released = await page.evaluate(() => [...window.__c64.inputSnapshot().keyboardColumns]);
    assert.deepEqual(released, [255, 255, 255, 255, 255, 255, 255, 255], `${base}: blur releases all keys`);

    await page.click("#btn-stop");
    await page.waitForFunction(() => window.__c64.running() === false);

    // PRG download byte-equality.
    const dir = mkdtempSync(join(tmpdir(), "c64-matrix-"));
    try {
      const [download] = await Promise.all([page.waitForEvent("download"), page.click("#btn-dl-prg")]);
      const prgPath = join(dir, "out.prg");
      await download.saveAs(prgPath);
      // Byte-for-byte equality against the independently-assembled PRG (not just length): a
      // same-length corruption in the download path would still fail here.
      assert.deepEqual(new Uint8Array(readFileSync(prgPath)), EXPECTED_PRG, `${base}: downloaded PRG is byte-identical`);
      assert.equal(build.prgLen, EXPECTED_PRG.length, `${base}: reported PRG length matches`);
      if (expectedPrgLen !== null) assert.equal(build.prgLen, expectedPrgLen, `${base}: PRG length stable across bases`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    // Malformed ?code is a visible error, not a silent fallback.
    await page.goto(`${url}${base}?code=@@@@`);
    await page.waitForFunction(() => typeof window.__c64 === "object");
    await page.waitForFunction(() => window.__c64.errors().some((e) => e.category === "url"));

    assert.deepEqual(pageErrors, [], `${base}: no uncaught page errors: ${pageErrors.join("; ")}`);
    return build.prgLen;
  } finally {
    await page.close();
  }
}

test("browser matrix: production dist journey at '/' and '/c64/'", async (t) => {
  const { names, strict } = requiredBrowsers();

  if (!wasmArtifactExists()) {
    if (strict) assert.fail("C64_E2E_REQUIRE is set but the production WASM artifact is missing (build/wasm/c64core.mjs)");
    t.skip("WASM artifact not built (build/wasm/c64core.mjs)");
    return;
  }

  const distDir = buildTempDist();
  const { siteRoot } = stageDistBasePaths(distDir);
  const { server, url } = await startServer({ port: 0, root: siteRoot });
  let ran = 0;
  try {
    for (const name of names) {
      const browserType = await tryLoadBrowser(name);
      if (!browserType) {
        if (strict) assert.fail(`C64_E2E_REQUIRE lists '${name}' but Playwright for '${name}' is not installed`);
        continue; // best-effort locally
      }
      // The playwright package importing does not guarantee the browser BINARY is installed;
      // launch() throws when it is missing. Treat that as unavailable: skip locally, fail in
      // strict release mode.
      let browser;
      try {
        browser = await browserType.launch();
      } catch (err) {
        if (strict) assert.fail(`C64_E2E_REQUIRE lists '${name}' but its browser binary cannot launch: ${err && err.message ? err.message : err}`);
        continue;
      }
      try {
        await t.test(name, async () => {
          let prgLen = null;
          for (const base of ["/", "/c64/"]) {
            prgLen = await runJourney(browser, base, url, prgLen);
          }
        });
        ran += 1;
      } finally {
        await browser.close();
      }
    }
  } finally {
    server.close();
    safeRm(distDir);
    safeRm(siteRoot);
  }

  if (ran === 0) {
    if (strict) assert.fail("no required browser was available under C64_E2E_REQUIRE");
    t.skip("no Playwright browsers installed (npx playwright install chromium firefox webkit)");
  }
});
