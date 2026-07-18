// Optional monitor fullscreen presentation. This controller owns only browser UI state; the canvas
// framebuffer and deterministic machine remain unchanged.

const ENTER_TEXT = "Full screen";
const EXIT_TEXT = "Exit full screen";
const UNAVAILABLE_TEXT = "Full screen unavailable";

function errorMessage(action, error) {
  const detail = error && typeof error.message === "string" ? error.message.trim() : "";
  return `Could not ${action} full screen${detail ? `: ${detail}` : "."}`;
}

export class FullscreenController {
  /**
   * @param {HTMLElement} target element expanded by the Fullscreen API
   * @param {HTMLButtonElement} button visible enter/exit toggle
   * @param {{ document?: Document, onError?: (message:string) => void }} [options]
   */
  constructor(target, button, options = {}) {
    this._target = target;
    this._button = button;
    this._document = options.document || (typeof document === "undefined" ? null : document);
    this._onError = options.onError || (() => {});
    this._mounted = false;
    this._pending = false;
    this._onButtonClick = () => {
      void this.toggle();
    };
    this._onFullscreenChange = () => this._sync();
  }

  get supported() {
    return !!(
      this._document
      && this._document.fullscreenEnabled !== false
      && typeof this._document.exitFullscreen === "function"
      && this._target
      && typeof this._target.requestFullscreen === "function"
    );
  }

  get active() {
    return !!this._document && this._document.fullscreenElement === this._target;
  }

  mount() {
    if (this._mounted) return;
    this._mounted = true;
    if (!this.supported) {
      this._renderUnavailable();
      return;
    }
    this._button.addEventListener("click", this._onButtonClick);
    this._document.addEventListener("fullscreenchange", this._onFullscreenChange);
    this._sync();
  }

  dispose() {
    if (!this._mounted) return;
    this._button.removeEventListener("click", this._onButtonClick);
    if (this._document) {
      this._document.removeEventListener("fullscreenchange", this._onFullscreenChange);
    }
    this._mounted = false;
  }

  async toggle() {
    if (!this.supported || this._pending) return false;

    const exiting = this.active;
    this._pending = true;
    this._sync();
    try {
      if (exiting) await this._document.exitFullscreen();
      else await this._target.requestFullscreen();
      return true;
    } catch (error) {
      this._onError(errorMessage(exiting ? "exit" : "enter", error));
      return false;
    } finally {
      this._pending = false;
      this._sync();
    }
  }

  _sync() {
    if (!this.supported) {
      this._renderUnavailable();
      return;
    }
    const active = this.active;
    this._button.disabled = this._pending;
    this._button.textContent = active ? EXIT_TEXT : ENTER_TEXT;
    this._button.title = active ? "Return monitor to the page" : "Expand monitor to full screen";
    this._button.setAttribute("aria-pressed", String(active));
  }

  _renderUnavailable() {
    this._button.disabled = true;
    this._button.textContent = UNAVAILABLE_TEXT;
    this._button.title = "Full screen is unavailable in this browser";
    this._button.setAttribute("aria-pressed", "false");
  }
}
