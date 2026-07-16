// Build client: owns request sequencing so a stale worker result can never replace a newer edit
// (see specs/WEB-CLIENT.md, specs/CODEGEN.md). The worker is injected so the sequencing logic is
// unit-testable in Node with a fake worker.

/**
 * Create the real module worker for the build pipeline.
 * @param {URL|string} clientBaseUrl the web/client/ directory URL (e.g. new URL("./", import.meta.url))
 */
export function createBuildWorker(clientBaseUrl) {
  return new Worker(new URL("buildWorker.js", clientBaseUrl), { type: "module" });
}

export class BuildClient {
  /**
   * @param {{ postMessage: Function, terminate?: Function }} worker
   * @param {{ onResult?: (result: object) => void, onStale?: () => void }} handlers
   */
  constructor(worker, { onResult, onStale } = {}) {
    this._worker = worker;
    this._onResult = onResult || (() => {});
    this._onStale = onStale || (() => {});
    this._seq = 0;
    this._latest = 0;
    this._pending = false;
    worker.onmessage = (event) => this._handle(event.data);
  }

  /** True while a build for the newest request has not yet returned. */
  get pending() {
    return this._pending;
  }

  /**
   * Request a build of the given raw project. Increments the sequence, marks prior artifacts
   * stale, and posts to the worker. Only the result matching the newest sequence is delivered.
   * @param {object} project
   */
  build(project) {
    this._seq += 1;
    this._latest = this._seq;
    this._pending = true;
    this._onStale();
    this._worker.postMessage({ seq: this._seq, project });
    return this._seq;
  }

  _handle(data) {
    if (!data || (data.seq | 0) !== this._latest) return; // drop stale/out-of-order results
    this._pending = false;
    this._onResult(data);
  }

  terminate() {
    if (this._worker && typeof this._worker.terminate === "function") this._worker.terminate();
  }
}
