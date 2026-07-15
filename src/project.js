// Versioned SourceProject model: validation, defaults, line-ending normalization, canonical
// JSON, and the build-identity preimage. See specs/CODEGEN.md.

import { ASSEMBLER_VERSION } from "./version.js";
import { sha256Hex } from "./hash.js";
import { encodePetsciiString } from "./petscii.js";
import { error } from "./diagnostics.js";

// Canonical field order. Canonical JSON emits exactly these keys, in this order, with no
// insignificant whitespace, so byte-identical projects produce byte-identical JSON.
const FIELD_ORDER = [
  "schema",
  "name",
  "source",
  "target",
  "loadAddress",
  "runMode",
  "runAddress",
  "timingProfile",
  "diskName",
  "diskId",
  "outputName",
];

const SUPPORTED_TARGET = "nmos-6510";
const RUN_MODES = new Set(["basic-sys", "direct"]);
const TIMING_PROFILES = new Set(["pal-6569", "ntsc-6567r8"]);

// Production source-size limit. Matches the web client's 256 KiB decoded-source cap
// (specs/WEB-CLIENT.md) and bounds the assembler's worst-case work at the pipeline boundary.
export const MAX_SOURCE_BYTES = 256 * 1024;

export const DEFAULT_PROJECT = Object.freeze({
  schema: 1,
  name: "untitled",
  source: "",
  target: SUPPORTED_TARGET,
  loadAddress: 0x0801,
  runMode: "basic-sys",
  runAddress: 0x0801,
  timingProfile: "pal-6569",
  diskName: "c64 disk",
  diskId: "64",
  outputName: "program",
});

/** Normalize CRLF and lone CR line endings to LF. */
export function normalizeLineEndings(text) {
  return String(text).replace(/\r\n?/g, "\n");
}

function isUint16(value) {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff;
}

function petsciiRepresentable(text) {
  return encodePetsciiString(text).ok;
}

/**
 * Validate and normalize raw project input into a canonical SourceProject.
 *
 * Missing optional fields take documented defaults; `source` is required. Line endings are
 * normalized to LF. Returns `{ ok, project, diagnostics }`; on failure `project` is null and
 * diagnostics explain each problem with a stable code.
 *
 * @param {object} input
 */
export function validateProject(input) {
  const diagnostics = [];
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    diagnostics.push(error("invalid-project", "Project must be an object."));
    return { ok: false, project: null, diagnostics };
  }

  const project = { ...DEFAULT_PROJECT };

  if (input.schema !== undefined) {
    if (input.schema !== 1) {
      diagnostics.push(error("invalid-project", `Unsupported project schema: ${input.schema}. Expected 1.`));
    } else {
      project.schema = 1;
    }
  }

  if (input.source === undefined || input.source === null) {
    diagnostics.push(error("invalid-project", "Project is missing required field 'source'."));
  } else if (typeof input.source !== "string") {
    diagnostics.push(error("invalid-project", "Project field 'source' must be a string."));
  } else {
    project.source = normalizeLineEndings(input.source);
    const sourceBytes = new TextEncoder().encode(project.source).length;
    if (sourceBytes > MAX_SOURCE_BYTES) {
      diagnostics.push(
        error("invalid-project", `Source is ${sourceBytes} bytes, exceeding the ${MAX_SOURCE_BYTES}-byte limit.`),
      );
    }
  }

  if (input.name !== undefined) {
    if (typeof input.name !== "string") {
      diagnostics.push(error("invalid-project", "Project field 'name' must be a string."));
    } else {
      project.name = input.name;
    }
  }

  if (input.target !== undefined) {
    if (input.target !== SUPPORTED_TARGET) {
      diagnostics.push(
        error("unsupported-target", `Unsupported target '${input.target}'. Expected '${SUPPORTED_TARGET}'.`),
      );
    } else {
      project.target = SUPPORTED_TARGET;
    }
  }

  if (input.runMode !== undefined) {
    if (!RUN_MODES.has(input.runMode)) {
      diagnostics.push(error("invalid-project", `Invalid runMode '${input.runMode}'. Expected 'basic-sys' or 'direct'.`));
    } else {
      project.runMode = input.runMode;
    }
  }

  if (input.timingProfile !== undefined) {
    if (!TIMING_PROFILES.has(input.timingProfile)) {
      diagnostics.push(error("invalid-project", `Invalid timingProfile '${input.timingProfile}'.`));
    } else {
      project.timingProfile = input.timingProfile;
    }
  }

  for (const field of ["loadAddress", "runAddress"]) {
    if (input[field] !== undefined) {
      if (!isUint16(input[field])) {
        diagnostics.push(error("invalid-project", `Project field '${field}' must be an integer in 0..65535.`));
      } else {
        project[field] = input[field];
      }
    } else if (field === "runAddress" && input.loadAddress !== undefined && isUint16(input.loadAddress)) {
      // runAddress defaults to loadAddress when unspecified.
      project.runAddress = input.loadAddress;
    }
  }

  if (input.diskName !== undefined) {
    if (typeof input.diskName !== "string") {
      diagnostics.push(error("invalid-project", "Project field 'diskName' must be a string."));
    } else if (input.diskName.length > 16 || !petsciiRepresentable(input.diskName)) {
      diagnostics.push(error("invalid-project", "diskName must be <=16 PETSCII-representable characters."));
    } else {
      project.diskName = input.diskName;
    }
  }

  if (input.diskId !== undefined) {
    if (typeof input.diskId !== "string") {
      diagnostics.push(error("invalid-project", "Project field 'diskId' must be a string."));
    } else if (input.diskId.length !== 2 || !petsciiRepresentable(input.diskId)) {
      diagnostics.push(error("invalid-project", "diskId must be exactly 2 PETSCII-representable characters."));
    } else {
      project.diskId = input.diskId;
    }
  }

  if (input.outputName !== undefined) {
    if (typeof input.outputName !== "string") {
      diagnostics.push(error("invalid-project", "Project field 'outputName' must be a string."));
    } else if (input.outputName.length < 1 || input.outputName.length > 16 || !petsciiRepresentable(input.outputName)) {
      diagnostics.push(error("invalid-project", "outputName must be 1..16 PETSCII-representable characters."));
    } else {
      project.outputName = input.outputName;
    }
  }

  if (diagnostics.length > 0) {
    return { ok: false, project: null, diagnostics };
  }
  return { ok: true, project, diagnostics };
}

/**
 * Serialize a validated project to canonical JSON: fixed key order, UTF-8, LF-normalized
 * source, and no insignificant whitespace.
 * @param {object} project
 */
export function canonicalJson(project) {
  const ordered = {};
  for (const key of FIELD_ORDER) {
    ordered[key] = project[key];
  }
  return JSON.stringify(ordered);
}

/**
 * Build the deterministic build-id preimage bytes:
 *   utf8("c64-buildid\0" + version + "\0" + canonicalJson + "\0") ++ prgBytes
 * NUL separators make the field boundaries unambiguous regardless of content.
 * @param {object} project
 * @param {Uint8Array} prg
 */
export function buildIdPreimage(project, prg) {
  const header = new TextEncoder().encode(
    `c64-buildid\0${ASSEMBLER_VERSION}\0${canonicalJson(project)}\0`,
  );
  const preimage = new Uint8Array(header.length + prg.length);
  preimage.set(header, 0);
  preimage.set(prg, header.length);
  return preimage;
}

/**
 * Compute the lowercase SHA-256 build id over canonical project JSON, assembler version, and
 * output bytes.
 * @param {object} project
 * @param {Uint8Array} prg
 */
export function computeBuildId(project, prg) {
  return sha256Hex(buildIdPreimage(project, prg));
}
