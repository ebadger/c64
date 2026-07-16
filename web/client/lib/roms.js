// ROM manager (browser). Reads locally selected ROM files, validates size + digest, tracks the
// three roles with unknown-digest confirmation, and holds bytes in memory ONLY. ROM bytes never
// enter storage, URLs, shares, logs, analytics, or network requests (see specs/ROM-ASSETS.md).
// Only a role + digest are ever surfaced for diagnostics.

import { validateRomRole, romSetStatus, computeRomSetId, ROM_ROLES } from "./romValidate.js";

export class RomManager {
  constructor() {
    // Public descriptors (no bytes). Bytes live in a private map, never exposed in status.
    this._descriptors = {};
    this._bytes = new Map();
  }

  /** Set a role from raw bytes (used by the file picker and by tests). */
  setRoleBytes(role, bytes) {
    const result = validateRomRole(role, bytes);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    // Keep only role/size/digest/known publicly; bytes stay private and memory-only. `ok: true`
    // marks the descriptor as an accepted (size-valid) role: romSetStatus() keys readiness off it,
    // so it must be present or the set never becomes ready and Run can never enable.
    this._descriptors[role] = {
      ok: true,
      role,
      size: result.size,
      digest: result.digest,
      known: result.known,
      requiresConfirmation: result.requiresConfirmation,
      confirmed: !result.requiresConfirmation,
    };
    this._bytes.set(role, bytes);
    return { ok: true, descriptor: { ...this._descriptors[role] } };
  }

  /** Set a role from a File/Blob (reads bytes in memory only). */
  async setRoleFile(role, file) {
    let bytes;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      return { ok: false, error: { category: "rom", code: "rom-read", message: `Could not read the ${role} ROM file.` } };
    }
    return this.setRoleBytes(role, bytes);
  }

  /** Confirm an unknown-digest role (the user asserts this file is the given role). */
  confirmRole(role) {
    if (this._descriptors[role]) this._descriptors[role].confirmed = true;
  }

  clearRole(role) {
    delete this._descriptors[role];
    this._bytes.delete(role);
  }

  /** Public status: readiness plus per-role digest summaries (never bytes). */
  status() {
    const set = romSetStatus(this._descriptors);
    const roles = {};
    for (const role of ROM_ROLES) {
      roles[role] = this._descriptors[role] ? { ...this._descriptors[role] } : null;
    }
    return { ...set, roles };
  }

  ready() {
    return this.status().ready;
  }

  /** The in-memory ROM byte set when ready, plus its deterministic id; null otherwise. */
  getRomSet() {
    if (!this.ready()) return null;
    const basic = this._bytes.get("basic");
    const kernal = this._bytes.get("kernal");
    const chargen = this._bytes.get("chargen");
    return { basic, kernal, chargen, id: computeRomSetId({ basic, kernal, chargen }) };
  }
}
