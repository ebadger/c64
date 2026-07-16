// Same-origin bundled ROM manifest loading. The loader validates the manifest before fetching any
// role, then verifies every downloaded byte count and SHA-256. It returns a detached candidate set;
// RomManager decides whether to replace the active set atomically.

import { ROM_SIZES } from "./config.js";
import { ROM_ROLES, validateRomRole } from "./romValidate.js";

const SHA256 = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validateBundledRomManifest(value) {
  if (!isRecord(value) || value.schema !== 1) return manifestError("The bundled ROM manifest schema is invalid.");
  for (const key of ["id", "title", "upstreamRepository", "revision", "licenseId", "licensePath", "sourceUrl"]) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      return manifestError(`The bundled ROM manifest field '${key}' is invalid.`);
    }
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id)) return manifestError("The bundled ROM manifest id is invalid.");
  if (!REVISION.test(value.revision)) return manifestError("The bundled ROM revision is not a full commit id.");
  if (!ASSET_NAME.test(value.licensePath)) return manifestError("The bundled ROM license path is unsafe.");
  if (
    !isRecord(value.sourceArchive) ||
    !ASSET_NAME.test(value.sourceArchive.path || "") ||
    !Number.isSafeInteger(value.sourceArchive.bytes) ||
    value.sourceArchive.bytes <= 0 ||
    !SHA256.test(value.sourceArchive.sha256 || "")
  ) {
    return manifestError("The bundled ROM source archive entry is invalid.");
  }
  if (!isRecord(value.roles)) return manifestError("The bundled ROM role map is invalid.");
  if (Object.keys(value.roles).sort().join(",") !== [...ROM_ROLES].sort().join(",")) {
    return manifestError("The bundled ROM manifest must contain exactly the required roles.");
  }

  const roles = {};
  for (const role of ROM_ROLES) {
    const entry = value.roles[role];
    if (!isRecord(entry) || !ASSET_NAME.test(entry.path || "")) {
      return manifestError(`The bundled ${role} ROM path is invalid.`);
    }
    if (entry.bytes !== ROM_SIZES[role]) {
      return manifestError(`The bundled ${role} ROM manifest size must be ${ROM_SIZES[role]} bytes.`);
    }
    if (typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) {
      return manifestError(`The bundled ${role} ROM digest is invalid.`);
    }
    roles[role] = { path: entry.path, bytes: entry.bytes, sha256: entry.sha256 };
  }

  return {
    ok: true,
    manifest: {
      schema: 1,
      id: value.id,
      title: value.title,
      upstreamRepository: value.upstreamRepository,
      revision: value.revision,
      licenseId: value.licenseId,
      licensePath: value.licensePath,
      sourceUrl: value.sourceUrl,
      sourceArchive: {
        path: value.sourceArchive.path,
        bytes: value.sourceArchive.bytes,
        sha256: value.sourceArchive.sha256,
      },
      roles,
    },
  };
}

export async function loadBundledRomSet(manifestUrl, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(String(manifestUrl));
  } catch (error) {
    return fetchError(`Could not load the bundled ROM manifest: ${messageOf(error)}.`);
  }
  if (!response || !response.ok) {
    return fetchError(`Could not load the bundled ROM manifest (HTTP ${response ? response.status : "unknown"}).`);
  }

  let rawManifest;
  try {
    rawManifest = await response.json();
  } catch (error) {
    return manifestError(`Could not parse the bundled ROM manifest: ${messageOf(error)}.`);
  }
  const checked = validateBundledRomManifest(rawManifest);
  if (!checked.ok) return checked;

  const manifest = checked.manifest;
  const baseUrl = new URL(".", String(manifestUrl));
  const roles = {};
  for (const role of ROM_ROLES) {
    const entry = manifest.roles[role];
    const assetUrl = new URL(entry.path, baseUrl);
    if (assetUrl.origin !== baseUrl.origin) return manifestError(`The bundled ${role} ROM path escapes the app origin.`);

    let roleResponse;
    try {
      roleResponse = await fetchImpl(assetUrl.href);
    } catch (error) {
      return fetchError(`Could not load the bundled ${role} ROM: ${messageOf(error)}.`);
    }
    if (!roleResponse || !roleResponse.ok) {
      return fetchError(`Could not load the bundled ${role} ROM (HTTP ${roleResponse ? roleResponse.status : "unknown"}).`);
    }

    let bytes;
    try {
      bytes = new Uint8Array(await roleResponse.arrayBuffer());
    } catch (error) {
      return fetchError(`Could not read the bundled ${role} ROM: ${messageOf(error)}.`);
    }
    const validated = validateRomRole(role, bytes, { expectedDigest: entry.sha256 });
    if (!validated.ok) return { ok: false, error: validated.error };
    roles[role] = { bytes, sha256: entry.sha256 };
  }

  return {
    ok: true,
    set: {
      id: manifest.id,
      title: manifest.title,
      revision: manifest.revision,
      licenseId: manifest.licenseId,
      licenseUrl: new URL(manifest.licensePath, baseUrl).href,
      lgplUrl: new URL("COPYING.LESSER", baseUrl).href,
      gplUrl: new URL("COPYING", baseUrl).href,
      provenanceUrl: new URL("PROVENANCE.md", baseUrl).href,
      sourceArchiveUrl: new URL(manifest.sourceArchive.path, baseUrl).href,
      roles,
    },
    manifest,
  };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function manifestError(message) {
  return { ok: false, error: { category: "rom", code: "rom-manifest", message } };
}

function fetchError(message) {
  return { ok: false, error: { category: "rom", code: "rom-fetch", message } };
}

function messageOf(error) {
  return String(error && error.message ? error.message : error);
}
