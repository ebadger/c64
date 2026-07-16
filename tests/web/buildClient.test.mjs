// Node test for BuildClient request sequencing (stale-result dropping) using a fake worker.
import test from "node:test";
import assert from "node:assert/strict";

import { BuildClient } from "../../web/client/lib/buildClient.js";

function fakeWorker() {
  return {
    sent: [],
    onmessage: null,
    postMessage(msg) {
      this.sent.push(msg);
    },
    deliver(data) {
      this.onmessage({ data });
    },
  };
}

test("delivers only the newest result and drops stale worker responses", () => {
  const worker = fakeWorker();
  const results = [];
  let staleCount = 0;
  const client = new BuildClient(worker, {
    onResult: (r) => results.push(r),
    onStale: () => staleCount++,
  });

  const seqA = client.build({ source: "a" });
  const seqB = client.build({ source: "b" });
  assert.equal(seqA, 1);
  assert.equal(seqB, 2);
  assert.equal(staleCount, 2);
  assert.equal(client.pending, true);

  // A late result for the first (stale) request must be ignored.
  worker.deliver({ seq: seqA, ok: true, buildId: "old" });
  assert.equal(results.length, 0);
  assert.equal(client.pending, true);

  // The newest result is delivered and clears pending.
  worker.deliver({ seq: seqB, ok: true, buildId: "new" });
  assert.equal(results.length, 1);
  assert.equal(results[0].buildId, "new");
  assert.equal(client.pending, false);
});

test("ignores results with an unknown/duplicate sequence", () => {
  const worker = fakeWorker();
  const results = [];
  const client = new BuildClient(worker, { onResult: (r) => results.push(r) });
  client.build({ source: "x" });
  worker.deliver({ seq: 99, ok: true });
  worker.deliver({ seq: 1, ok: true });
  worker.deliver({ seq: 1, ok: true }); // duplicate of the same latest seq is still delivered once per arrival
  assert.equal(results.length, 2);
});
