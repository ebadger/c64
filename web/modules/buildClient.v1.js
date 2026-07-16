// Main-thread build client: owns the build worker and exposes a Promise-based `build`. Falls
// back to a synchronous main-thread build when module workers are unavailable, so Build always
// works on a capable-but-worker-limited browser. See specs/WEB-CLIENT.md.

export class BuildClient {
  /**
   * @param {object} [options]
   * @param {boolean} [options.useWorker=true]  set false to force the main-thread fallback
   */
  constructor(options = {}) {
    this.useWorker = options.useWorker !== false;
    this.worker = null;
    this.nextId = 1;
    this.pending = new Map();
    this.fallbackBuild = null;
  }

  _ensureWorker() {
    if (this.worker || !this.useWorker) return;
    try {
      this.worker = new Worker(new URL("./buildWorker.v1.js", import.meta.url), { type: "module" });
    } catch (cause) {
      // Module workers unsupported (synchronous failure): disable the worker path.
      this.useWorker = false;
      this.worker = null;
      return;
    }
    this.worker.onmessage = (event) => {
      const { id, outcome } = event.data ?? {};
      const entry = this.pending.get(id);
      if (!entry) return;
      this.pending.delete(id);
      entry.resolve(outcome);
    };
    this.worker.onerror = (event) => {
      // Some browsers accept `new Worker(..., { type: "module" })` but fail asynchronously when
      // the worker script hits its first `import` (no module-worker support). Disable the worker
      // path and re-run every in-flight build on the main thread so builds still succeed.
      this.useWorker = false;
      const stranded = [...this.pending.values()];
      this.pending.clear();
      if (this.worker) {
        this.worker.terminate();
        this.worker = null;
      }
      if (event?.preventDefault) event.preventDefault();
      for (const entry of stranded) {
        this._fallback(entry.project).then(entry.resolve, entry.reject);
      }
    };
  }

  async _fallback(project) {
    // Import lazily so the pipeline module graph only loads on the main thread when needed.
    if (!this.fallbackBuild) {
      const mod = await import("./buildCore.v1.js");
      this.fallbackBuild = mod.runBuild;
    }
    return this.fallbackBuild(project);
  }

  /**
   * Build a project. Resolves with a BuildOutcome (which may itself be `ok: false` with
   * diagnostics); rejects only on infrastructure failure.
   * @param {object} project
   * @returns {Promise<object>}
   */
  async build(project) {
    this._ensureWorker();
    if (this.useWorker && this.worker) {
      const id = this.nextId++;
      return new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject, project });
        this.worker.postMessage({ id, project });
      });
    }
    return this._fallback(project);
  }

  /** Tear down the worker. */
  dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
    }
    this.pending.clear();
  }
}
