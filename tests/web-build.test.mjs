import { test } from "node:test";
import assert from "node:assert/strict";
import { runBuild } from "../web/modules/buildCore.v1.js";
import { BuildClient } from "../web/modules/buildClient.v1.js";
import { loadExample } from "../examples/load-example.mjs";

test("runBuild assembles a valid project into PRG + D64", () => {
  const outcome = runBuild(loadExample("border-flash"));
  assert.ok(outcome.ok);
  assert.ok(outcome.prg instanceof Uint8Array && outcome.prg.length > 0);
  assert.ok(outcome.d64 instanceof Uint8Array && outcome.d64.length === 174848);
  assert.equal(outcome.prgName, "border-flash.prg");
  assert.equal(outcome.d64Name, "border-flash.d64");
  assert.match(outcome.buildId, /^[0-9a-f]{64}$/);
  assert.deepEqual(outcome.diagnostics, []);
});

test("runBuild reports diagnostics and no artifacts on a bad build", () => {
  const outcome = runBuild({ schema: 1, source: "  nope #$00\n", runMode: "direct", loadAddress: 0x1000 });
  assert.equal(outcome.ok, false);
  assert.ok(outcome.diagnostics.length >= 1);
  assert.equal(outcome.prg, null);
  assert.equal(outcome.d64, null);
  assert.equal(outcome.buildId, null);
});

test("BuildClient main-thread fallback matches runBuild", async () => {
  const client = new BuildClient({ useWorker: false });
  const project = loadExample("border-flash");
  const viaClient = await client.build(project);
  const viaCore = runBuild(project);
  assert.equal(viaClient.ok, true);
  assert.equal(viaClient.buildId, viaCore.buildId);
  client.dispose();
});

test("BuildClient falls back when a worker cannot be constructed", async () => {
  // In Node there is no Worker global, so the default (useWorker:true) client must fall back to
  // the main thread instead of throwing — mirroring a browser without module-worker support.
  const client = new BuildClient();
  const outcome = await client.build(loadExample("border-flash"));
  assert.equal(outcome.ok, true);
  assert.match(outcome.buildId, /^[0-9a-f]{64}$/);
  client.dispose();
});
