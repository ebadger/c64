import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const REQUIRED_MANIFEST_PATHS = [
  "index.html",
  "main.js",
  "styles.css",
  "wasm/c64core.mjs",
  "wasm/c64core.wasm",
  "roms/manifest.json",
  "roms/dos1541.rom",
];
const CRITICAL_ASSET_PATHS = ["wasm/c64core.wasm", "roms/dos1541.rom"];

export async function smokePagesDeployment({
  baseUrl,
  expectedManifestSha256,
  attempts = 12,
  delayMs = 10_000,
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms)),
  logger = console,
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const expectedSha256 = normalizeSha256(expectedManifestSha256);
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("attempts must be a positive integer");
  if (!Number.isInteger(delayMs) || delayMs < 0) throw new Error("delayMs must be a non-negative integer");
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await verifyDeploymentAttempt({
        baseUrl: normalizedBaseUrl,
        expectedManifestSha256: expectedSha256,
        attempt,
        fetchImpl,
      });
      logger.log(
        `pages-smoke: OK on attempt ${attempt}/${attempts} — exact manifest ${expectedSha256} and ${result.assetCount} critical assets verified`,
      );
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      logger.error(`pages-smoke: attempt ${attempt}/${attempts} failed: ${lastError.message}`);
      if (attempt < attempts && delayMs > 0) await sleep(delayMs);
    }
  }

  throw new Error(`deployment did not converge after ${attempts} attempts: ${lastError?.message ?? "unknown failure"}`);
}

async function verifyDeploymentAttempt({ baseUrl, expectedManifestSha256, attempt, fetchImpl }) {
  const manifestResponse = await fetchForAttempt(fetchImpl, baseUrl, "asset-manifest.json", attempt, expectedManifestSha256);
  requireHttpOk(manifestResponse, "asset-manifest.json");
  requireContentType(manifestResponse, "application/json", "asset-manifest.json");
  const manifestBytes = new Uint8Array(await manifestResponse.arrayBuffer());
  const actualManifestSha256 = sha256(manifestBytes);
  if (actualManifestSha256 !== expectedManifestSha256) {
    throw new Error(
      `asset-manifest.json sha256 ${actualManifestSha256} does not match built ${expectedManifestSha256}`,
    );
  }

  const manifest = parseAndValidateManifest(manifestBytes);
  const entriesByPath = new Map(manifest.files.map((entry) => [entry.path, entry]));
  const indexBytes = await fetchAndVerifyAsset({
    baseUrl,
    path: "index.html",
    entry: entriesByPath.get("index.html"),
    attempt,
    expectedManifestSha256,
    fetchImpl,
  });
  const indexReferences = validateIndexReferences(indexBytes, baseUrl, entriesByPath);
  const pathsToVerify = [...new Set([...indexReferences, ...CRITICAL_ASSET_PATHS])];

  for (const path of pathsToVerify) {
    await fetchAndVerifyAsset({
      baseUrl,
      path,
      entry: entriesByPath.get(path),
      attempt,
      expectedManifestSha256,
      fetchImpl,
    });
  }

  return {
    manifestSha256: actualManifestSha256,
    assetCount: pathsToVerify.length + 1,
  };
}

function parseAndValidateManifest(bytes) {
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error(`asset-manifest.json is not valid UTF-8 JSON: ${error.message}`);
  }

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("asset-manifest.json root must be an object");
  }
  for (const [field, expected] of [
    ["manifestVersion", 1],
    ["app", "c64"],
    ["basePathIndependent", true],
    ["wasmIncluded", true],
    ["bundledRomsIncluded", true],
  ]) {
    if (manifest[field] !== expected) {
      throw new Error(`asset-manifest.json ${field} must be ${JSON.stringify(expected)}`);
    }
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("asset-manifest.json files must be a non-empty array");
  }
  if (manifest.fileCount !== manifest.files.length) {
    throw new Error("asset-manifest.json fileCount does not match files.length");
  }

  const paths = new Set();
  for (const entry of manifest.files) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("asset-manifest.json contains a non-object file entry");
    }
    if (
      typeof entry.path !== "string"
      || entry.path.length === 0
      || entry.path.startsWith("/")
      || entry.path.includes("\\")
      || entry.path.split("/").includes("..")
    ) {
      throw new Error(`asset-manifest.json contains unsafe path ${JSON.stringify(entry.path)}`);
    }
    if (paths.has(entry.path)) throw new Error(`asset-manifest.json contains duplicate path ${entry.path}`);
    if (!Number.isInteger(entry.bytes) || entry.bytes < 0) {
      throw new Error(`asset-manifest.json ${entry.path} has invalid byte length`);
    }
    if (typeof entry.sha256 !== "string" || !SHA256_PATTERN.test(entry.sha256)) {
      throw new Error(`asset-manifest.json ${entry.path} has invalid sha256`);
    }
    if (typeof entry.contentType !== "string" || entry.contentType.length === 0) {
      throw new Error(`asset-manifest.json ${entry.path} has invalid contentType`);
    }
    paths.add(entry.path);
  }

  for (const path of REQUIRED_MANIFEST_PATHS) {
    if (!paths.has(path)) throw new Error(`asset-manifest.json is missing required production asset ${path}`);
  }
  return manifest;
}

function validateIndexReferences(indexBytes, baseUrl, entriesByPath) {
  let html;
  try {
    html = new TextDecoder("utf-8", { fatal: true }).decode(indexBytes);
  } catch (error) {
    throw new Error(`index.html is not valid UTF-8: ${error.message}`);
  }

  const paths = new Set();
  for (const match of html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi)) {
    const reference = match[1];
    if (reference.startsWith("#")) continue;
    const path = resolveAppRelativeReference(reference, baseUrl);
    if (!entriesByPath.has(path)) throw new Error(`index.html references unlisted asset ${reference}`);
    paths.add(path);
  }
  for (const required of ["main.js", "styles.css"]) {
    if (!paths.has(required)) throw new Error(`index.html is missing required direct reference ${required}`);
  }
  return [...paths].sort();
}

function resolveAppRelativeReference(reference, baseUrl) {
  if (
    reference.length === 0
    || reference.startsWith("/")
    || reference.includes("\\")
    || /^[a-z][a-z0-9+.-]*:/i.test(reference)
    || reference.startsWith("//")
  ) {
    throw new Error(`index.html contains non-relative asset reference ${JSON.stringify(reference)}`);
  }
  const base = new URL(baseUrl);
  const resolved = new URL(reference, base);
  if (resolved.origin !== base.origin || !resolved.pathname.startsWith(base.pathname)) {
    throw new Error(`index.html asset reference escapes the deployment root: ${reference}`);
  }
  return decodeURIComponent(resolved.pathname.slice(base.pathname.length));
}

async function fetchAndVerifyAsset({
  baseUrl,
  path,
  entry,
  attempt,
  expectedManifestSha256,
  fetchImpl,
}) {
  if (!entry) throw new Error(`manifest entry is missing for ${path}`);
  const response = await fetchForAttempt(fetchImpl, baseUrl, path, attempt, expectedManifestSha256);
  requireHttpOk(response, path);
  requireContentType(response, mediaType(entry.contentType), path);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength !== entry.bytes) {
    throw new Error(`${path} byte length ${bytes.byteLength} does not match manifest ${entry.bytes}`);
  }
  const actualSha256 = sha256(bytes);
  if (actualSha256 !== entry.sha256) {
    throw new Error(`${path} sha256 ${actualSha256} does not match manifest ${entry.sha256}`);
  }
  return bytes;
}

function fetchForAttempt(fetchImpl, baseUrl, path, attempt, expectedManifestSha256) {
  const url = new URL(path, baseUrl);
  url.searchParams.set("c64-deploy", expectedManifestSha256);
  url.searchParams.set("attempt", String(attempt));
  return fetchImpl(url, {
    cache: "no-store",
    headers: {
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
  });
}

function requireHttpOk(response, path) {
  if (!response || response.status !== 200) {
    throw new Error(`${path} returned HTTP ${response?.status ?? "no response"}`);
  }
}

function requireContentType(response, expected, path) {
  const actual = mediaType(response.headers.get("content-type"));
  const javascriptTypes = new Set(["text/javascript", "application/javascript"]);
  const equivalentJavascript = javascriptTypes.has(actual) && javascriptTypes.has(expected);
  if (actual !== expected && !equivalentJavascript) {
    throw new Error(`${path} content-type ${actual || "(missing)"} does not match ${expected}`);
  }
}

function mediaType(value) {
  return String(value ?? "").split(";", 1)[0].trim().toLowerCase();
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("baseUrl must use http or https");
  }
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

function normalizeSha256(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) throw new Error("expectedManifestSha256 must be 64 lowercase hex characters");
  return normalized;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`missing value for ${name}`);
    index += 1;
    if (name === "--url") options.baseUrl = value;
    else if (name === "--expected-manifest-sha256") options.expectedManifestSha256 = value;
    else if (name === "--attempts") options.attempts = Number(value);
    else if (name === "--delay-ms") options.delayMs = Number(value);
    else throw new Error(`unknown argument ${name}`);
  }
  if (!options.baseUrl) throw new Error("--url is required");
  if (!options.expectedManifestSha256) throw new Error("--expected-manifest-sha256 is required");
  return options;
}

async function main() {
  try {
    await smokePagesDeployment(parseArgs(process.argv.slice(2)));
  } catch (error) {
    console.error(`pages-smoke: FAILED: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
