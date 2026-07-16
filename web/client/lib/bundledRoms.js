// Same-origin bundled ROM manifest loading. The loader validates the manifest before fetching any
// role, then verifies every downloaded byte count and SHA-256. It returns a detached candidate set;
// RomManager decides whether to replace the active set atomically.

import { ROM_SIZES } from "./config.js";
import { ROM_ROLES, validateRomRole } from "./romValidate.js";
import { sha256Hex } from "../../../src/hash.js";

const SHA256 = /^[0-9a-f]{64}$/;
const REVISION = /^[0-9a-f]{40}$/;
const ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const UPSTREAM_PATH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function validateBundledRomManifest(value) {
  if (!isRecord(value) || value.schema !== 2) return manifestError("The bundled ROM manifest schema is invalid.");
  for (const key of ["id", "title", "upstreamRepository", "revision", "sourceUrl"]) {
    if (typeof value[key] !== "string" || value[key].length === 0) {
      return manifestError(`The bundled ROM manifest field '${key}' is invalid.`);
    }
  }
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(value.id)) return manifestError("The bundled ROM manifest id is invalid.");
  if (!REVISION.test(value.revision)) return manifestError("The bundled ROM revision is not a full commit id.");
  if (
    !isRecord(value.sourceArchive) ||
    !ASSET_NAME.test(value.sourceArchive.path || "") ||
    !Number.isSafeInteger(value.sourceArchive.bytes) ||
    value.sourceArchive.bytes <= 0 ||
    !SHA256.test(value.sourceArchive.sha256 || "")
  ) {
    return manifestError("The bundled ROM source archive entry is invalid.");
  }
  const licenses = validateLicenses(value.licenses);
  if (!licenses.ok) return licenses;
  if (!Array.isArray(value.redistributionFiles)) {
    return manifestError("The bundled ROM redistribution file list is invalid.");
  }
  const redistributionFiles = [];
  for (const entry of value.redistributionFiles) {
    if (
      !isRecord(entry) ||
      !ASSET_NAME.test(entry.path || "") ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes <= 0 ||
      !SHA256.test(entry.sha256 || "")
    ) {
      return manifestError("A bundled ROM redistribution file entry is invalid.");
    }
    redistributionFiles.push({ path: entry.path, bytes: entry.bytes, sha256: entry.sha256 });
  }
  const requiredRedistributionPaths = [
    licenses.licenses.package.path,
    licenses.licenses.basic.path,
    licenses.licenses.chargen.path,
    ...licenses.licenses.chargen.companionPaths,
    "PROVENANCE.md",
  ].sort();
  const redistributionPaths = redistributionFiles.map((entry) => entry.path).sort();
  if (
    new Set(redistributionPaths).size !== redistributionPaths.length ||
    redistributionPaths.join(",") !== requiredRedistributionPaths.join(",")
  ) {
    return manifestError("The bundled ROM redistribution file list is incomplete or contains extras.");
  }
  if (!isRecord(value.roles)) return manifestError("The bundled ROM role map is invalid.");
  if (Object.keys(value.roles).sort().join(",") !== [...ROM_ROLES].sort().join(",")) {
    return manifestError("The bundled ROM manifest must contain exactly the required roles.");
  }

  const roles = {};
  for (const role of ROM_ROLES) {
    const entry = value.roles[role];
    if (
      !isRecord(entry) ||
      !ASSET_NAME.test(entry.path || "") ||
      !UPSTREAM_PATH.test(entry.upstreamPath || "") ||
      entry.upstreamPath.includes("..") ||
      entry.upstreamPath.includes("//")
    ) {
      return manifestError(`The bundled ${role} ROM path is invalid.`);
    }
    if (entry.bytes !== ROM_SIZES[role]) {
      return manifestError(`The bundled ${role} ROM manifest size must be ${ROM_SIZES[role]} bytes.`);
    }
    if (typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) {
      return manifestError(`The bundled ${role} ROM digest is invalid.`);
    }
    roles[role] = {
      path: entry.path,
      upstreamPath: entry.upstreamPath,
      bytes: entry.bytes,
      sha256: entry.sha256,
    };
  }

  return {
    ok: true,
    manifest: {
      schema: 2,
      id: value.id,
      title: value.title,
      upstreamRepository: value.upstreamRepository,
      revision: value.revision,
      sourceUrl: value.sourceUrl,
      sourceArchive: {
        path: value.sourceArchive.path,
        bytes: value.sourceArchive.bytes,
        sha256: value.sourceArchive.sha256,
      },
      licenses: licenses.licenses,
      redistributionFiles,
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
    const loaded = await fetchVerifiedAsset(baseUrl, entry, `${role} ROM`, fetchImpl);
    if (!loaded.ok) return loaded;
    const bytes = loaded.bytes;
    const validated = validateRomRole(role, bytes, { expectedDigest: entry.sha256 });
    if (!validated.ok) return { ok: false, error: validated.error };
    roles[role] = { bytes, sha256: entry.sha256 };
  }
  const packageAssets = [
    { ...manifest.sourceArchive, label: "corresponding source archive" },
    ...manifest.redistributionFiles.map((entry) => ({
      ...entry,
      label: `redistribution file ${entry.path}`,
    })),
  ];
  for (const asset of packageAssets) {
    const loaded = await fetchVerifiedAsset(baseUrl, asset, asset.label, fetchImpl);
    if (!loaded.ok) return loaded;
  }

  return {
    ok: true,
    set: {
      id: manifest.id,
      title: manifest.title,
      revision: manifest.revision,
      licenseIds: [...new Set(Object.values(manifest.licenses).map((entry) => entry.id))],
      licenseUrl: new URL(manifest.licenses.package.path, baseUrl).href,
      basicLicenseUrl: new URL(manifest.licenses.basic.path, baseUrl).href,
      lgplUrl: new URL(manifest.licenses.chargen.path, baseUrl).href,
      gplUrl: new URL(
        manifest.licenses.chargen.companionPaths.find((path) => path === "COPYING"),
        baseUrl,
      ).href,
      chargenNoticeUrl: new URL(
        manifest.licenses.chargen.companionPaths.find((path) => path === "NOTICE.md"),
        baseUrl,
      ).href,
      provenanceUrl: new URL("PROVENANCE.md", baseUrl).href,
      sourceArchiveUrl: new URL(manifest.sourceArchive.path, baseUrl).href,
      roles: {
        basic: { ...roles.basic, licenseId: manifest.licenses.basic.id },
        kernal: { ...roles.kernal, licenseId: manifest.licenses.package.id },
        chargen: { ...roles.chargen, licenseId: manifest.licenses.chargen.id },
      },
    },
    manifest,
  };
}

async function fetchVerifiedAsset(baseUrl, entry, label, fetchImpl) {
  const assetUrl = new URL(entry.path, baseUrl);
  if (assetUrl.origin !== baseUrl.origin) {
    return manifestError(`The bundled ${label} path escapes the app origin.`);
  }
  let response;
  try {
    response = await fetchImpl(assetUrl.href);
  } catch (error) {
    return fetchError(`Could not load the bundled ${label}: ${messageOf(error)}.`);
  }
  if (!response || !response.ok) {
    return fetchError(`Could not load the bundled ${label} (HTTP ${response ? response.status : "unknown"}).`);
  }
  let bytes;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    return fetchError(`Could not read the bundled ${label}: ${messageOf(error)}.`);
  }
  if (bytes.length !== entry.bytes || sha256Hex(bytes) !== entry.sha256) {
    return {
      ok: false,
      error: {
        category: "rom",
        code: "rom-integrity",
        message: `The bundled ${label} failed size or SHA-256 verification.`,
      },
    };
  }
  return { ok: true, bytes };
}

function validateLicenses(value) {
  if (
    !isRecord(value) ||
    Object.keys(value).sort().join(",") !== "basic,chargen,package"
  ) {
    return manifestError("The bundled ROM license map is invalid.");
  }
  for (const key of ["package", "basic"]) {
    if (
      !isRecord(value[key]) ||
      value[key].id !== "MIT" ||
      !ASSET_NAME.test(value[key].path || "")
    ) {
      return manifestError(`The bundled ROM ${key} license entry is invalid.`);
    }
  }
  if (
    !isRecord(value.chargen) ||
    value.chargen.id !== "LGPL-3.0-or-later" ||
    !ASSET_NAME.test(value.chargen.path || "") ||
    !Array.isArray(value.chargen.companionPaths) ||
    value.chargen.companionPaths.length !== 3 ||
    value.chargen.companionPaths.some((path) => !ASSET_NAME.test(path))
  ) {
    return manifestError("The bundled ROM chargen license entry is invalid.");
  }
  return {
    ok: true,
    licenses: {
      package: { id: value.package.id, path: value.package.path },
      basic: { id: value.basic.id, path: value.basic.path },
      chargen: {
        id: value.chargen.id,
        path: value.chargen.path,
        companionPaths: [...value.chargen.companionPaths],
      },
    },
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
