// localStorage-backed autosave and preferences. Wraps the pure envelope format (autosaveFormat.js)
// with debounced writes, quota handling, and version-checked cross-tab storage events. Only
// canonical project JSON and non-sensitive preferences are stored — never binary ROM/D64 bytes
// (see specs/WEB-CLIENT.md, specs/ROM-ASSETS.md).

import { AUTOSAVE_KEY, PREFERENCES_KEY } from "./config.js";
import {
  serializeAutosave,
  parseAutosave,
  serializePreferences,
  parsePreferences,
} from "./autosaveFormat.js";

export class Storage {
  /**
   * @param {{ onExternalProject?:Function, onExternalPreferences?:Function, onQuotaError?:Function }} handlers
   */
  constructor(handlers = {}) {
    this._onExternalProject = handlers.onExternalProject || (() => {});
    this._onExternalPreferences = handlers.onExternalPreferences || (() => {});
    this._onQuotaError = handlers.onQuotaError || (() => {});
    this._autosaveEnabled = true;
    this._timer = 0;
    this._disposers = [];
  }

  get autosaveEnabled() {
    return this._autosaveEnabled;
  }

  attach() {
    const fn = (e) => this._onStorage(e);
    window.addEventListener("storage", fn);
    this._disposers.push(() => window.removeEventListener("storage", fn));
  }

  dispose() {
    if (this._timer) clearTimeout(this._timer);
    for (const d of this._disposers) d();
    this._disposers = [];
  }

  _onStorage(e) {
    if (e.key === AUTOSAVE_KEY && typeof e.newValue === "string") {
      const parsed = parseAutosave(e.newValue);
      if (parsed.ok) this._onExternalProject(parsed.project);
    } else if (e.key === PREFERENCES_KEY && typeof e.newValue === "string") {
      const parsed = parsePreferences(e.newValue);
      if (parsed.ok) this._onExternalPreferences(parsed.prefs);
    }
  }

  /** Debounced autosave of the current project. Skips invalid projects. */
  scheduleSave(project, delayMs = 400) {
    if (!this._autosaveEnabled) return;
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveProjectNow(project), delayMs);
  }

  saveProjectNow(project) {
    if (!this._autosaveEnabled) return;
    const text = serializeAutosave(project);
    if (text === null) return; // never persist an invalid project
    try {
      localStorage.setItem(AUTOSAVE_KEY, text);
    } catch (err) {
      this._autosaveEnabled = false;
      this._onQuotaError({ category: "storage", code: "quota", message: "Autosave is disabled: browser storage is full or unavailable." });
    }
  }

  loadProject() {
    let text;
    try {
      text = localStorage.getItem(AUTOSAVE_KEY);
    } catch {
      return null;
    }
    if (typeof text !== "string") return null;
    const parsed = parseAutosave(text);
    return parsed.ok ? parsed.project : null;
  }

  savePreferences(prefs) {
    try {
      localStorage.setItem(PREFERENCES_KEY, serializePreferences(prefs));
    } catch {
      this._onQuotaError({ category: "storage", code: "quota", message: "Preferences could not be saved: storage is full or unavailable." });
    }
  }

  loadPreferences() {
    let text;
    try {
      text = localStorage.getItem(PREFERENCES_KEY);
    } catch {
      return {};
    }
    if (typeof text !== "string") return {};
    const parsed = parsePreferences(text);
    return parsed.ok ? parsed.prefs : {};
  }
}
