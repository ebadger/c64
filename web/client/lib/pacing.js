// Deterministic browser pacing, kept entirely outside the core (see specs/WEB-CLIENT.md,
// specs/EMULATOR.md). requestAnimationFrame plus audio drain drive bounded runCycles calls sized
// from real elapsed time; the machine clock is never changed and no emulated cycle is skipped.
// Only presentation is adaptive: after running, the latest framebuffer is drawn (older completed
// frames are dropped) and produced audio is pushed to the audio scheduler.

const PROFILES = {
  "pal-6569": { cpuHz: 985248, cyclesPerFrame: 19656, fps: 50 },
  "ntsc-6567r8": { cpuHz: 1022727, cyclesPerFrame: 17095, fps: 60 },
};

export class Pacer {
  /**
   * @param {object} deps { machine, renderer, audio, input }
   * @param {{ timingProfile:string, onCrash?:Function, onStats?:Function }} opts
   */
  constructor({ machine, renderer, audio, input }, opts) {
    this._machine = machine;
    this._renderer = renderer;
    this._audio = audio;
    this._input = input;
    this._profile = PROFILES[opts.timingProfile] || PROFILES["pal-6569"];
    this._onCrash = opts.onCrash || (() => {});
    this._onStats = opts.onStats || (() => {});
    this._running = false;
    this._raf = 0;
    this._last = 0;
    this._cycleDebt = 0;
    this._maxDtMs = 100; // cap real-time catch-up after a tab pause
    this._maxCyclesPerTick = this._profile.cyclesPerFrame * 6;
    this._maxDebt = this._profile.cyclesPerFrame * 10;
    this._audioMax = Math.ceil((this._audioSampleRateGuess() / this._profile.fps) * 4) || 4096;
    this._tick = this._tick.bind(this);
  }

  _audioSampleRateGuess() {
    return 48000;
  }

  get running() {
    return this._running;
  }

  start() {
    if (this._running) return;
    this._running = true;
    this._last = performance.now();
    this._cycleDebt = 0;
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() {
    this._running = false;
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _tick(now) {
    if (!this._running) return;

    // 1) Feed current input state to the core (release-all is reflected here immediately).
    this._machine.setInput(this._input.snapshot());

    // 2) Convert bounded real elapsed time into a cycle budget.
    const dt = Math.min(now - this._last, this._maxDtMs);
    this._last = now;
    this._cycleDebt = Math.min(this._cycleDebt + (dt / 1000) * this._profile.cpuHz, this._maxDebt);
    let budget = Math.min(this._cycleDebt, this._maxCyclesPerTick);

    // 3) Run whole emulated frames' worth of cycles until the budget is spent or a fault stops us.
    let executed = 0;
    let crashed = false;
    while (budget > 0) {
      const batch = Math.min(budget, this._profile.cyclesPerFrame);
      const result = this._machine.runBatch(Math.ceil(batch));
      if (!result) break;
      const ran = Number(result.cyclesExecuted) || 0;
      executed += ran;
      budget -= ran;
      // Drain any audio produced this batch and push it to the scheduler.
      const audio = this._machine.drainAudio(this._audioMax);
      if (audio && audio.framesWritten > 0) this._audio.push(audio.samples, audio.sampleRate);
      if (result.stopReason === "fault") {
        crashed = true;
        break;
      }
    }
    this._cycleDebt = Math.max(this._cycleDebt - executed, -this._profile.cyclesPerFrame);

    // 4) Present the latest framebuffer only (older completed frames are dropped).
    const frame = this._machine.copyFramebuffer();
    if (frame) this._renderer.draw(frame);

    this._onStats({ frameSequence: frame ? frame.sequence : 0, executed });

    if (crashed) {
      this.stop();
      this._onCrash();
      return;
    }
    this._raf = requestAnimationFrame(this._tick);
  }
}
