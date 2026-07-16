// Web Audio playback for the core's mono float samples. Audio starts only after a user gesture
// (autoplay policy), schedules successive AudioBuffers just ahead of the clock, and exposes
// suspended/underrun state. Presentation timing never feeds back into machine state (see
// specs/IO.md, specs/WEB-CLIENT.md): dropped/underrun audio only affects what is heard.

export class AudioPlayer {
  constructor() {
    this._ctx = null;
    this._gain = null;
    this._enabled = false;
    this._nextStart = 0;
    this._underruns = 0;
    this._sampleRate = 0;
    this._volume = 0.6;
    // Small scheduling lookahead to smooth over frame jitter without adding perceptible latency.
    this._latency = 0.05;
  }

  get enabled() {
    return this._enabled;
  }

  get state() {
    return {
      enabled: this._enabled,
      contextState: this._ctx ? this._ctx.state : "none",
      underruns: this._underruns,
      sampleRate: this._sampleRate,
    };
  }

  /** Create/resume the AudioContext. MUST be called from a user-gesture handler. */
  async enable() {
    if (!this._ctx) {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) return { ok: false, error: { category: "audio", code: "no-web-audio", message: "Web Audio is unavailable." } };
      this._ctx = new Ctx();
      this._gain = this._ctx.createGain();
      this._gain.gain.value = this._volume;
      this._gain.connect(this._ctx.destination);
    }
    try {
      await this._ctx.resume();
    } catch {
      return { ok: false, error: { category: "audio", code: "resume-failed", message: "Could not start audio." } };
    }
    this._enabled = true;
    this._nextStart = this._ctx.currentTime + this._latency;
    return { ok: true, error: null };
  }

  /** Attempt to recover a suspended context (e.g., after a tab returns to the foreground). */
  async resumeIfSuspended() {
    if (this._ctx && this._ctx.state === "suspended") {
      try {
        await this._ctx.resume();
      } catch {
        /* leave suspended; state is surfaced to the UI */
      }
    }
  }

  setVolume(v) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this._gain) this._gain.gain.value = this._volume;
  }

  /**
   * Queue mono float samples for playback at the given sample rate. No-op when disabled (audio
   * simply is not heard; the core is unaffected).
   * @param {Float32Array} samples
   * @param {number} sampleRate
   */
  push(samples, sampleRate) {
    if (!this._enabled || !this._ctx || !samples || samples.length === 0 || sampleRate <= 0) return;
    this._sampleRate = sampleRate;
    const buffer = this._ctx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = this._ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this._gain);

    const now = this._ctx.currentTime;
    if (this._nextStart < now) {
      // We fell behind the clock: an underrun. Reset the schedule a little ahead of now.
      this._underruns += 1;
      this._nextStart = now + this._latency;
    }
    source.start(this._nextStart);
    this._nextStart += buffer.duration;
  }

  /** Suspend playback without discarding the context. */
  async disable() {
    this._enabled = false;
    if (this._ctx && this._ctx.state === "running") {
      try {
        await this._ctx.suspend();
      } catch {
        /* ignore */
      }
    }
  }

  close() {
    this._enabled = false;
    if (this._ctx) {
      try {
        this._ctx.close();
      } catch {
        /* ignore */
      }
      this._ctx = null;
      this._gain = null;
    }
  }
}
