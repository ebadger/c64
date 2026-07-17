// ROM manager. Atomically accepts a verified bundled set or a complete user-selected replacement
// set and owns the bytes in memory. Custom bytes never enter storage, URLs, shares, logs, analytics,
// or network requests (see specs/ROM-ASSETS.md). Only role/digest/source metadata is public.

import { validateRomRole, romSetStatus, computeRomSetId, ROM_ROLES } from "./romValidate.js";
import { sha256Hex } from "../../../src/hash.js";

export class RomManager {
  constructor() {
    // Public descriptors (no bytes). Bytes live in a private map, never exposed in status.
    this._descriptors = {};
    this._bytes = new Map();
    this._source = null;
    this._setMetadata = null;
    this._driveBytes = null;
    this._driveDescriptor = null;
  }

  /** Set a role from raw bytes (used by the file picker and by tests). */
  setRoleBytes(role, bytes) {
    const result = validateRomRole(role, bytes);
    if (!result.ok) {
      return { ok: false, error: result.error };
    }
    if (this._source === "bundled") this.clear();
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
      source: "user-supplied",
      licenseId: null,
    };
    this._bytes.set(role, new Uint8Array(bytes));
    this._source = "custom";
    this._setMetadata = null;
    return { ok: true, descriptor: { ...this._descriptors[role] } };
  }

  /**
   * Replace the active set atomically with a manifest-verified bundled set.
   * @param {{ id:string, title:string, revision:string, licenseIds:string[],
   *           roles:Record<string,{bytes:Uint8Array,sha256:string,licenseId:string}>,
   *           drive:{bytes:Uint8Array,sha256:string,licenseId:string} }} set
   */
  setBundledSet(set) {
    if (
      !set ||
      typeof set.id !== "string" ||
      typeof set.title !== "string" ||
      typeof set.revision !== "string" ||
      !Array.isArray(set.licenseIds) ||
      set.licenseIds.some((id) => typeof id !== "string")
    ) {
      return { ok: false, error: bundledSetError("The bundled ROM set metadata is invalid.") };
    }
    const descriptors = {};
    const ownedBytes = new Map();
    for (const role of ROM_ROLES) {
      const entry = set && set.roles && set.roles[role];
      if (
        !entry ||
        !(entry.bytes instanceof Uint8Array) ||
        typeof entry.sha256 !== "string" ||
        typeof entry.licenseId !== "string"
      ) {
        return { ok: false, error: bundledSetError(`The bundled ROM set is missing a valid ${role} entry.`) };
      }
      const result = validateRomRole(role, entry.bytes, { expectedDigest: entry.sha256 });
      if (!result.ok) return { ok: false, error: result.error };
      descriptors[role] = {
        ok: true,
        role,
        size: result.size,
        digest: result.digest,
        known: true,
        requiresConfirmation: false,
        confirmed: true,
        source: "bundled-replacement",
        licenseId: entry.licenseId,
      };
      ownedBytes.set(role, new Uint8Array(entry.bytes));
    }
    if (
      !set.drive ||
      !(set.drive.bytes instanceof Uint8Array) ||
      set.drive.bytes.length !== 16384 ||
      typeof set.drive.sha256 !== "string" ||
      sha256Hex(set.drive.bytes) !== set.drive.sha256 ||
      typeof set.drive.licenseId !== "string"
    ) {
      return { ok: false, error: bundledSetError("The bundled ROM set is missing a valid drive entry.") };
    }

    this._descriptors = descriptors;
    this._bytes = ownedBytes;
    this._driveBytes = new Uint8Array(set.drive.bytes);
    this._driveDescriptor = {
      size: set.drive.bytes.length,
      digest: set.drive.sha256,
      source: "bundled-replacement",
      licenseId: set.drive.licenseId,
    };
    this._source = "bundled";
    this._setMetadata = {
      id: set.id,
      title: set.title,
      revision: set.revision,
      licenseIds: [...set.licenseIds],
    };
    return { ok: true, set: { ...this._setMetadata } };
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
    if (this._source === "bundled") {
      this.clear();
      return;
    }
    delete this._descriptors[role];
    this._bytes.delete(role);
    this._source = "custom";
    this._setMetadata = null;
  }

  clear() {
    this._descriptors = {};
    this._bytes = new Map();
    this._source = null;
    this._setMetadata = null;
  }

  /** Public status: readiness plus per-role digest summaries (never bytes). */
  status() {
    const set = romSetStatus(this._descriptors);
    const roles = {};
    for (const role of ROM_ROLES) {
      roles[role] = this._descriptors[role] ? { ...this._descriptors[role] } : null;
    }
    return {
      ...set,
      source: this._source,
      set: this._setMetadata ? { ...this._setMetadata } : null,
      roles,
      drive: this._driveDescriptor ? { ...this._driveDescriptor } : null,
    };
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
    return {
      basic,
      kernal,
      chargen,
      drive: this._driveBytes,
      id: computeRomSetId({ basic, kernal, chargen }),
    };
  }
}

function bundledSetError(message) {
  return { category: "rom", code: "rom-manifest", message };
}
