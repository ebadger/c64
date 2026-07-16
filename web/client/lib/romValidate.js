// ROM validation and set identity. Environment-free and memory-only (see specs/ROM-ASSETS.md).
// Copyrighted Commodore ROMs are never committed, fetched, logged, or persisted. This module
// validates approved bundled replacements and locally selected bytes by size and digest and
// exposes only a digest + role for diagnostics.

import { sha256Hex } from "../../../src/hash.js";
import { ROM_SIZES } from "./config.js";

export const ROM_ROLES = Object.freeze(["basic", "kernal", "chargen"]);

/**
 * Validate a single ROM role's bytes. Never returns or logs the bytes themselves.
 * @param {"basic"|"kernal"|"chargen"} role
 * @param {Uint8Array} bytes
 * @param {{ expectedDigest?: string|null }} options
 * @returns {{ ok: boolean, role: string, size: number, digest: string|null,
 *            known: boolean, requiresConfirmation: boolean, error: object|null }}
 */
export function validateRomRole(role, bytes, { expectedDigest = null } = {}) {
  if (!ROM_ROLES.includes(role)) {
    return { ok: false, role, size: 0, digest: null, known: false, requiresConfirmation: false, error: romErr("rom-role", `Unknown ROM role '${role}'.`) };
  }
  if (!(bytes instanceof Uint8Array)) {
    return { ok: false, role, size: 0, digest: null, known: false, requiresConfirmation: false, error: romErr("rom-read", `Could not read bytes for the ${role} ROM.`) };
  }
  const expected = ROM_SIZES[role];
  if (bytes.length !== expected) {
    return {
      ok: false,
      role,
      size: bytes.length,
      digest: null,
      known: false,
      requiresConfirmation: false,
      error: romErr("rom-size", `The ${role} ROM must be ${expected} bytes but is ${bytes.length}.`),
    };
  }
  const digest = sha256Hex(bytes);
  if (expectedDigest !== null && digest !== expectedDigest) {
    return {
      ok: false,
      role,
      size: bytes.length,
      digest,
      known: false,
      requiresConfirmation: false,
      error: romErr("rom-integrity", `The bundled ${role} ROM failed its SHA-256 integrity check.`),
    };
  }
  const known = expectedDigest !== null;
  return { ok: true, role, size: bytes.length, digest, known, requiresConfirmation: !known, error: null };
}

function romErr(code, message) {
  return { category: "rom", code, message };
}

/**
 * Summarize a role→descriptor map into set readiness. `descriptors` values are results from
 * validateRomRole that have been accepted (size-valid and, when unknown, confirmed by the user).
 * @param {Partial<Record<"basic"|"kernal"|"chargen", {ok:boolean, confirmed?:boolean}>>} descriptors
 * @returns {{ complete: boolean, ready: boolean, missing: string[], unconfirmed: string[] }}
 */
export function romSetStatus(descriptors) {
  const missing = [];
  const unconfirmed = [];
  for (const role of ROM_ROLES) {
    const d = descriptors[role];
    if (!d || !d.ok) {
      missing.push(role);
    } else if (d.requiresConfirmation && !d.confirmed) {
      unconfirmed.push(role);
    }
  }
  const complete = missing.length === 0;
  const ready = complete && unconfirmed.length === 0;
  return { complete, ready, missing, unconfirmed };
}

const te = new TextEncoder();

/**
 * Compute the deterministic RomSet id exactly as specs/ROM-ASSETS.md defines it, so the JS-side
 * display matches the core's own digest. Preimage:
 *   "c64-romset\0" then for each role (basic,kernal,chargen): roleId "\0" LE32(len) "\0" bytes.
 * @param {{ basic: Uint8Array, kernal: Uint8Array, chargen: Uint8Array }} roms
 */
export function computeRomSetId({ basic, kernal, chargen }) {
  const roles = [["basic", basic], ["kernal", kernal], ["chargen", chargen]];
  const chunks = [te.encode("c64-romset\0")];
  for (const [id, bytes] of roles) {
    chunks.push(te.encode(id + "\0"));
    const len = new Uint8Array(4);
    new DataView(len.buffer).setUint32(0, bytes.length, true);
    chunks.push(len);
    chunks.push(te.encode("\0"));
    chunks.push(bytes);
  }
  let total = 0;
  for (const c of chunks) total += c.length;
  const preimage = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    preimage.set(c, o);
    o += c.length;
  }
  return sha256Hex(preimage);
}
