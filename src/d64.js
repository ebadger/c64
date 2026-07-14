// Deterministic standard 1541 35-track D64 construction, parsing, and PRG extraction.
// See specs/MEDIA.md.
//
// Geometry (683 sectors, 174848 bytes, no appended error table):
//   tracks 1-17: 21 sectors   tracks 18-24: 19   tracks 25-30: 18   tracks 31-35: 17
//
// Allocation order for file data is a fixed, documented walk: ascending track
// 1,2,...,17,19,...,35 (track 18 reserved for BAM/directory), and within each track ascending
// sector 0..max, with no interleave. This is deterministic and standards-valid; interleave is
// a drive-performance optimization irrelevant to byte-exact artifacts.

import { encodePetsciiString } from "./petscii.js";

export const D64_SIZE = 174848;
export const D64_SIZE_WITH_ERRORS = 175531; // 174848 + 683 error bytes
export const TRACK_COUNT = 35;
export const BAM_TRACK = 18;
export const BAM_SECTOR = 0;
export const DIRECTORY_TRACK = 18;
export const DIRECTORY_FIRST_SECTOR = 1;
const BYTES_PER_SECTOR = 256;
const PAYLOAD_PER_SECTOR = 254;
const FILE_TYPE_CLOSED_PRG = 0x82;
const SHIFT_SPACE = 0xa0;

/** Sectors on a given one-based track number. */
export function sectorsInTrack(track) {
  if (track >= 1 && track <= 17) return 21;
  if (track >= 18 && track <= 24) return 19;
  if (track >= 25 && track <= 30) return 18;
  if (track >= 31 && track <= 35) return 17;
  return 0;
}

// Precompute the byte offset of the start of each track (one-based) within the image.
const TRACK_OFFSETS = (() => {
  const offsets = new Array(TRACK_COUNT + 1);
  let sectorCount = 0;
  for (let t = 1; t <= TRACK_COUNT; t++) {
    offsets[t] = sectorCount * BYTES_PER_SECTOR;
    sectorCount += sectorsInTrack(t);
  }
  return offsets;
})();

/** Byte offset of a track/sector within the image, or -1 if out of range. */
export function sectorOffset(track, sector) {
  if (track < 1 || track > TRACK_COUNT) return -1;
  if (sector < 0 || sector >= sectorsInTrack(track)) return -1;
  return TRACK_OFFSETS[track] + sector * BYTES_PER_SECTOR;
}

function mediaError(code, message) {
  return { ok: false, metadata: null, warnings: [], error: { code, message } };
}

function petsciiPadded(text, length) {
  const enc = encodePetsciiString(text);
  const out = new Uint8Array(length).fill(SHIFT_SPACE);
  for (let i = 0; i < Math.min(enc.bytes.length, length); i++) {
    out[i] = enc.bytes[i];
  }
  return out;
}

// The fixed allocation walk, skipping the directory track (18).
function* allocationOrder() {
  for (let t = 1; t <= TRACK_COUNT; t++) {
    if (t === BAM_TRACK) continue;
    for (let s = 0; s < sectorsInTrack(t); s++) {
      yield { track: t, sector: s };
    }
  }
}

/**
 * Build a deterministic 174848-byte D64 containing the assembled PRG as a single closed PRG
 * file. Rebuilding the same project + PRG yields byte-identical output.
 * @param {object} project validated SourceProject (uses diskName, diskId, outputName)
 * @param {Uint8Array} prg
 * @returns {{ ok: boolean, d64: Uint8Array|null, error: object|null }}
 */
export function buildD64(project, prg) {
  if (!(prg instanceof Uint8Array) || prg.length < 3) {
    return { ok: false, d64: null, error: { code: "invalid-prg", message: "PRG is too short to store." } };
  }
  const nameCheck = encodePetsciiString(project.outputName);
  if (!nameCheck.ok || project.outputName.length > 16 || project.outputName.length < 1) {
    return { ok: false, d64: null, error: { code: "invalid-name", message: "outputName is not representable as a PETSCII filename." } };
  }
  if (!encodePetsciiString(project.diskName).ok || project.diskName.length > 16) {
    return { ok: false, d64: null, error: { code: "invalid-name", message: "diskName is not representable." } };
  }
  if (!encodePetsciiString(project.diskId).ok || project.diskId.length !== 2) {
    return { ok: false, d64: null, error: { code: "invalid-name", message: "diskId must be two PETSCII characters." } };
  }

  const numDataSectors = Math.ceil(prg.length / PAYLOAD_PER_SECTOR);

  // Reserve directory (18/1) and BAM (18/0); allocate file data from the fixed walk.
  const dataSectors = [];
  const walker = allocationOrder();
  for (let i = 0; i < numDataSectors; i++) {
    const next = walker.next();
    if (next.done) {
      return { ok: false, d64: null, error: { code: "disk-full", message: "PRG does not fit on a 35-track disk." } };
    }
    dataSectors.push(next.value);
  }

  const image = new Uint8Array(D64_SIZE);

  // Write file data chain.
  for (let i = 0; i < dataSectors.length; i++) {
    const { track, sector } = dataSectors[i];
    const off = sectorOffset(track, sector);
    const chunkStart = i * PAYLOAD_PER_SECTOR;
    const chunk = prg.subarray(chunkStart, chunkStart + PAYLOAD_PER_SECTOR);
    if (i < dataSectors.length - 1) {
      const nextTs = dataSectors[i + 1];
      image[off] = nextTs.track;
      image[off + 1] = nextTs.sector;
    } else {
      // Final sector: link track 0, link "sector" = payload length + 1.
      image[off] = 0x00;
      image[off + 1] = chunk.length + 1;
    }
    image.set(chunk, off + 2);
  }

  // Directory sector 18/1 with a single entry.
  const dirOff = sectorOffset(DIRECTORY_TRACK, DIRECTORY_FIRST_SECTOR);
  image[dirOff] = 0x00; // no next directory sector
  image[dirOff + 1] = 0xff;
  const entryOff = dirOff; // entry 0 begins at the sector start
  image[entryOff + 2] = FILE_TYPE_CLOSED_PRG;
  image[entryOff + 3] = dataSectors[0].track;
  image[entryOff + 4] = dataSectors[0].sector;
  image.set(petsciiPadded(project.outputName, 16), entryOff + 5);
  image[entryOff + 30] = numDataSectors & 0xff;
  image[entryOff + 31] = (numDataSectors >> 8) & 0xff;

  // BAM sector 18/0.
  const bamOff = sectorOffset(BAM_TRACK, BAM_SECTOR);
  image[bamOff] = DIRECTORY_TRACK;
  image[bamOff + 1] = DIRECTORY_FIRST_SECTOR;
  image[bamOff + 2] = 0x41; // DOS version 'A'
  image[bamOff + 3] = 0x00;

  // Mark every sector free initially, then clear used sectors.
  const used = new Set();
  used.add(`${BAM_TRACK}/${BAM_SECTOR}`);
  used.add(`${DIRECTORY_TRACK}/${DIRECTORY_FIRST_SECTOR}`);
  for (const ts of dataSectors) {
    used.add(`${ts.track}/${ts.sector}`);
  }
  for (let t = 1; t <= TRACK_COUNT; t++) {
    const entryBase = bamOff + 4 + (t - 1) * 4;
    const count = sectorsInTrack(t);
    let bitmap = [0, 0, 0];
    let free = 0;
    for (let s = 0; s < count; s++) {
      if (!used.has(`${t}/${s}`)) {
        bitmap[s >> 3] |= 1 << (s & 7);
        free += 1;
      }
    }
    image[entryBase] = free;
    image[entryBase + 1] = bitmap[0];
    image[entryBase + 2] = bitmap[1];
    image[entryBase + 3] = bitmap[2];
  }

  // Disk header name / id / DOS type.
  image.set(petsciiPadded(project.diskName, 16), bamOff + 0x90);
  image[bamOff + 0xa0] = SHIFT_SPACE;
  image[bamOff + 0xa1] = SHIFT_SPACE;
  const idBytes = encodePetsciiString(project.diskId).bytes;
  image[bamOff + 0xa2] = idBytes[0];
  image[bamOff + 0xa3] = idBytes[1];
  image[bamOff + 0xa4] = SHIFT_SPACE;
  image[bamOff + 0xa5] = 0x32; // '2'
  image[bamOff + 0xa6] = 0x41; // 'A'
  image[bamOff + 0xa7] = SHIFT_SPACE;
  image[bamOff + 0xa8] = SHIFT_SPACE;
  image[bamOff + 0xa9] = SHIFT_SPACE;
  image[bamOff + 0xaa] = SHIFT_SPACE;

  return { ok: true, d64: image, error: null };
}

function readPetsciiName(bytes) {
  // Trim trailing shift-spaces ($A0) that pad D64 filenames.
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === SHIFT_SPACE) end -= 1;
  return bytes.subarray(0, end);
}

/**
 * Validate D64 geometry, BAM link, directory chain, and every file chain.
 * @param {Uint8Array} bytes
 * @returns {{ ok: boolean, metadata: object|null, warnings: object[], error: object|null }}
 */
export function parseD64(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    return mediaError("unsupported-geometry", "D64 input must be a Uint8Array.");
  }
  const warnings = [];
  if (bytes.length === D64_SIZE_WITH_ERRORS) {
    warnings.push({ code: "error-table-ignored", message: "683-byte error table present; it is ignored." });
  } else if (bytes.length !== D64_SIZE) {
    return mediaError("unsupported-geometry", `Unsupported image size ${bytes.length}; expected ${D64_SIZE}.`);
  }

  const bamOff = sectorOffset(BAM_TRACK, BAM_SECTOR);
  const dirTrack = bytes[bamOff];
  const dirSector = bytes[bamOff + 1];
  if (dirTrack !== DIRECTORY_TRACK) {
    return mediaError("invalid-bam", `BAM directory link points to track ${dirTrack}, expected ${DIRECTORY_TRACK}.`);
  }

  const entries = [];
  const visitedDir = new Set();
  let t = dirTrack;
  let s = dirSector;
  while (t !== 0) {
    const off = sectorOffset(t, s);
    if (off < 0) {
      return mediaError("invalid-track-sector", `Directory link references invalid sector ${t}/${s}.`);
    }
    const key = `${t}/${s}`;
    if (visitedDir.has(key)) {
      return mediaError("chain-cycle", `Directory chain cycles at ${t}/${s}.`);
    }
    visitedDir.add(key);
    for (let e = 0; e < 8; e++) {
      const eo = off + e * 32;
      const fileType = bytes[eo + 2];
      if (fileType === 0) continue;
      entries.push({
        index: entries.length,
        fileType,
        startTrack: bytes[eo + 3],
        startSector: bytes[eo + 4],
        name: [...readPetsciiName(bytes.subarray(eo + 5, eo + 21))],
        blocks: bytes[eo + 30] | (bytes[eo + 31] << 8),
      });
    }
    const nextT = bytes[off];
    const nextS = bytes[off + 1];
    t = nextT;
    s = nextS;
  }

  // Validate each file chain (bounds + cycle).
  for (const entry of entries) {
    const walk = walkFileChain(bytes, entry.startTrack, entry.startSector);
    if (!walk.ok) {
      return mediaError(walk.error.code, walk.error.message);
    }
  }

  return {
    ok: true,
    metadata: {
      diskName: [...readPetsciiName(bytes.subarray(bamOff + 0x90, bamOff + 0xa0))],
      diskId: [bytes[bamOff + 0xa2], bytes[bamOff + 0xa3]],
      dosType: [bytes[bamOff + 0xa5], bytes[bamOff + 0xa6]],
      entries,
    },
    warnings,
    error: null,
  };
}

// Walk a file sector chain, returning the collected payload bytes or an error.
function walkFileChain(bytes, startTrack, startSector) {
  const visited = new Set();
  const payload = [];
  let t = startTrack;
  let s = startSector;
  while (true) {
    const off = sectorOffset(t, s);
    if (off < 0) {
      return { ok: false, error: { code: "invalid-track-sector", message: `File link references invalid sector ${t}/${s}.` } };
    }
    const key = `${t}/${s}`;
    if (visited.has(key)) {
      return { ok: false, error: { code: "chain-cycle", message: `File chain cycles at ${t}/${s}.` } };
    }
    visited.add(key);
    const nextT = bytes[off];
    const nextS = bytes[off + 1];
    if (nextT === 0) {
      // Final sector: byte1 is payload length + 1 (valid payload at offsets 2..byte1).
      const lastOffset = nextS;
      if (lastOffset < 1 || lastOffset > 0xff) {
        return { ok: false, error: { code: "invalid-track-sector", message: `Invalid final-sector byte count ${lastOffset}.` } };
      }
      for (let i = 2; i <= lastOffset; i++) {
        payload.push(bytes[off + i]);
      }
      break;
    }
    for (let i = 2; i < BYTES_PER_SECTOR; i++) {
      payload.push(bytes[off + i]);
    }
    t = nextT;
    s = nextS;
  }
  return { ok: true, payload };
}

/**
 * Extract the exact file byte stream (including its two-byte PRG load address) for the
 * directory entry at `directoryIndex`.
 * @param {Uint8Array} bytes validated or unvalidated D64 image
 * @param {number} directoryIndex
 * @returns {{ ok: boolean, prg: Uint8Array|null, error: object|null }}
 */
export function extractPrg(bytes, directoryIndex) {
  const parsed = parseD64(bytes);
  if (!parsed.ok) {
    return { ok: false, prg: null, error: parsed.error };
  }
  const entry = parsed.metadata.entries[directoryIndex];
  if (!entry) {
    return { ok: false, prg: null, error: { code: "invalid-track-sector", message: `No directory entry at index ${directoryIndex}.` } };
  }
  const walk = walkFileChain(bytes, entry.startTrack, entry.startSector);
  if (!walk.ok) {
    return { ok: false, prg: null, error: walk.error };
  }
  return { ok: true, prg: Uint8Array.from(walk.payload), error: null };
}

/**
 * Validate an imported D64 and return an immutable copy for the (future) emulated drive. The
 * media layer hands the drive an immutable byte image; malformed media is never mounted.
 * @param {Uint8Array} bytes
 * @returns {{ ok: boolean, media: Uint8Array|null, warnings: object[], error: object|null }}
 */
export function mountD64(bytes) {
  const parsed = parseD64(bytes);
  if (!parsed.ok) {
    return { ok: false, media: null, warnings: [], error: parsed.error };
  }
  return { ok: true, media: Uint8Array.from(bytes), warnings: parsed.warnings, error: null };
}
