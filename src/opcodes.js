// Complete documented NMOS 6502/6510 instruction table.
//
// This covers only the official (documented) instructions. Undocumented ("illegal") opcodes
// and 65C02-only instructions are intentionally absent; the assembler reports an unknown
// mnemonic for them. Each mnemonic maps to the opcode byte for every addressing mode it
// supports. Addressing-mode keys:
//
//   imp  implied (no operand)                acc  accumulator (bare or explicit `A`)
//   imm  immediate  #value                   rel  relative (branch target)
//   zp   zero page  value                    abs  absolute  value
//   zpx  zero page,X                         abx  absolute,X
//   zpy  zero page,Y                         aby  absolute,Y
//   ind  indirect  (value)                   izx  indexed indirect  (value,X)
//   izy  indirect indexed  (value),Y

export const OPCODES = {
  // Load / store
  LDA: { imm: 0xa9, zp: 0xa5, zpx: 0xb5, abs: 0xad, abx: 0xbd, aby: 0xb9, izx: 0xa1, izy: 0xb1 },
  LDX: { imm: 0xa2, zp: 0xa6, zpy: 0xb6, abs: 0xae, aby: 0xbe },
  LDY: { imm: 0xa0, zp: 0xa4, zpx: 0xb4, abs: 0xac, abx: 0xbc },
  STA: { zp: 0x85, zpx: 0x95, abs: 0x8d, abx: 0x9d, aby: 0x99, izx: 0x81, izy: 0x91 },
  STX: { zp: 0x86, zpy: 0x96, abs: 0x8e },
  STY: { zp: 0x84, zpx: 0x94, abs: 0x8c },

  // Register transfers
  TAX: { imp: 0xaa },
  TAY: { imp: 0xa8 },
  TXA: { imp: 0x8a },
  TYA: { imp: 0x98 },
  TSX: { imp: 0xba },
  TXS: { imp: 0x9a },

  // Stack
  PHA: { imp: 0x48 },
  PLA: { imp: 0x68 },
  PHP: { imp: 0x08 },
  PLP: { imp: 0x28 },

  // Logic
  AND: { imm: 0x29, zp: 0x25, zpx: 0x35, abs: 0x2d, abx: 0x3d, aby: 0x39, izx: 0x21, izy: 0x31 },
  ORA: { imm: 0x09, zp: 0x05, zpx: 0x15, abs: 0x0d, abx: 0x1d, aby: 0x19, izx: 0x01, izy: 0x11 },
  EOR: { imm: 0x49, zp: 0x45, zpx: 0x55, abs: 0x4d, abx: 0x5d, aby: 0x59, izx: 0x41, izy: 0x51 },
  BIT: { zp: 0x24, abs: 0x2c },

  // Arithmetic and comparison
  ADC: { imm: 0x69, zp: 0x65, zpx: 0x75, abs: 0x6d, abx: 0x7d, aby: 0x79, izx: 0x61, izy: 0x71 },
  SBC: { imm: 0xe9, zp: 0xe5, zpx: 0xf5, abs: 0xed, abx: 0xfd, aby: 0xf9, izx: 0xe1, izy: 0xf1 },
  CMP: { imm: 0xc9, zp: 0xc5, zpx: 0xd5, abs: 0xcd, abx: 0xdd, aby: 0xd9, izx: 0xc1, izy: 0xd1 },
  CPX: { imm: 0xe0, zp: 0xe4, abs: 0xec },
  CPY: { imm: 0xc0, zp: 0xc4, abs: 0xcc },

  // Increment / decrement
  INC: { zp: 0xe6, zpx: 0xf6, abs: 0xee, abx: 0xfe },
  DEC: { zp: 0xc6, zpx: 0xd6, abs: 0xce, abx: 0xde },
  INX: { imp: 0xe8 },
  INY: { imp: 0xc8 },
  DEX: { imp: 0xca },
  DEY: { imp: 0x88 },

  // Shifts and rotates (accumulator + memory)
  ASL: { acc: 0x0a, zp: 0x06, zpx: 0x16, abs: 0x0e, abx: 0x1e },
  LSR: { acc: 0x4a, zp: 0x46, zpx: 0x56, abs: 0x4e, abx: 0x5e },
  ROL: { acc: 0x2a, zp: 0x26, zpx: 0x36, abs: 0x2e, abx: 0x3e },
  ROR: { acc: 0x6a, zp: 0x66, zpx: 0x76, abs: 0x6e, abx: 0x7e },

  // Jumps and subroutines
  JMP: { abs: 0x4c, ind: 0x6c },
  JSR: { abs: 0x20 },
  RTS: { imp: 0x60 },
  RTI: { imp: 0x40 },

  // Branches (relative)
  BPL: { rel: 0x10 },
  BMI: { rel: 0x30 },
  BVC: { rel: 0x50 },
  BVS: { rel: 0x70 },
  BCC: { rel: 0x90 },
  BCS: { rel: 0xb0 },
  BNE: { rel: 0xd0 },
  BEQ: { rel: 0xf0 },

  // Status flags
  CLC: { imp: 0x18 },
  SEC: { imp: 0x38 },
  CLI: { imp: 0x58 },
  SEI: { imp: 0x78 },
  CLV: { imp: 0xb8 },
  CLD: { imp: 0xd8 },
  SED: { imp: 0xf8 },

  // System
  NOP: { imp: 0xea },
  BRK: { imp: 0x00 },
};

// Deep-freeze the table and every nested mode entry so the exported constant cannot be
// mutated by a consumer to alter deterministic assembler output.
for (const entry of Object.values(OPCODES)) {
  Object.freeze(entry);
}
Object.freeze(OPCODES);

/** True when `name` (any case) is a documented NMOS mnemonic. */
export function isMnemonic(name) {
  return Object.prototype.hasOwnProperty.call(OPCODES, name.toUpperCase());
}
