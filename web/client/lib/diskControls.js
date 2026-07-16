const FILE_TYPE_NAMES = ["DEL", "SEQ", "PRG", "USR", "REL"];

export function isPrgEntry(entry) {
  return !!entry && (entry.fileType & 0x0f) === 0x02;
}

export function petsciiToDisplay(bytes) {
  let text = "";
  for (const byte of bytes || []) {
    if (byte >= 0x20 && byte <= 0x5a) {
      text += String.fromCharCode(byte);
    } else if (byte >= 0xc1 && byte <= 0xda) {
      text += String.fromCharCode(byte - 0x60);
    } else {
      text += "?";
    }
  }
  return text || "(unnamed)";
}

export function directoryEntryLabel(entry) {
  const type = FILE_TYPE_NAMES[entry.fileType & 0x0f] || `$${entry.fileType.toString(16).padStart(2, "0")}`;
  return `"${petsciiToDisplay(entry.name)}" ${type} — ${entry.blocks} block${entry.blocks === 1 ? "" : "s"}`;
}

export function formatEntryAddress(address) {
  return `$${Number(address).toString(16).toUpperCase().padStart(4, "0")}`;
}

/**
 * Accept familiar C64 hexadecimal forms ($C000, 0xC000, C000) and unprefixed decimal.
 * @returns {number|null}
 */
export function parseEntryAddress(value) {
  const raw = String(value ?? "").trim();
  let digits;
  let radix;
  if (/^\$[0-9a-f]{1,4}$/i.test(raw)) {
    digits = raw.slice(1);
    radix = 16;
  } else if (/^0x[0-9a-f]{1,4}$/i.test(raw)) {
    digits = raw.slice(2);
    radix = 16;
  } else if (/^[0-9]+$/.test(raw)) {
    digits = raw;
    radix = 10;
  } else if (/^[0-9a-f]{1,4}$/i.test(raw)) {
    digits = raw;
    radix = 16;
  } else {
    return null;
  }
  const address = Number.parseInt(digits, radix);
  return Number.isInteger(address) && address >= 0 && address <= 0xffff ? address : null;
}
