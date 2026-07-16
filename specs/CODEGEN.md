# c64 — Code Generation Spec

> Dependency-light NMOS 6510 assembler and deterministic source-to-artifact contract.

---

## Purpose

Code generation turns an editable source project into diagnostics, a standard C64 PRG, and
the inputs for a standard D64. One ES module implementation must run unchanged in modern
browsers and Node.js so tests exercise the same assembler used by the UI.

## Contracts / Interfaces

The initial project model is deliberately small and serializable:

```text
SourceProject {
  schema: 1
  name: string
  source: string
  target: "nmos-6510"
  loadAddress: uint16
  runMode: "basic-sys" | "direct"
  runAddress: uint16
  timingProfile: "pal-6569" | "ntsc-6567r8"
  diskName: string
  diskId: string
  outputName: string
}

Diagnostic {
  severity: "error" | "warning"
  code: string
  message: string
  line: uint32
  column: uint32
  length: uint32
}

AssemblyResult {
  ok: boolean
  prg: Uint8Array | null
  loadAddress: uint16 | null
  runAddress: uint16 | null
  symbols: readonly Symbol[]
  diagnostics: readonly Diagnostic[]
  buildId: string | null
}
```

`buildId` is a lowercase SHA-256 over canonical project JSON, assembler version, and output
bytes. Canonical JSON uses fixed key order, UTF-8, normalized `\n` line endings, and no
insignificant whitespace.

The build-id preimage is constructed deterministically as the UTF-8 bytes of
`"c64-buildid\0" + assemblerVersion + "\0" + canonicalJson + "\0"` followed by the raw PRG
bytes; the NUL separators keep the field boundaries unambiguous. The pipeline uses a
dependency-light synchronous SHA-256 (no `node:crypto`, no `crypto.subtle`) so one
implementation produces the same `buildId` in browsers and Node.js.

## Source language

- Target documented NMOS 6502/6510 opcodes and addressing modes. 65C02-only instructions are
  errors. Undocumented opcodes remain unsupported until individually specified and tested.
- Identifiers are ASCII letters, digits, and underscore; they are case-insensitive and
  preserve original spelling in diagnostics.
- Numeric literals support `$ffff` hexadecimal, `%1010` binary, and decimal. Character and
  text literals have an explicitly documented PETSCII mapping; unsupported Unicode is an
  error rather than a lossy conversion.
- Initial directives: `* =` or `.org`, `.byte`, `.word`, `.text`, `.fill`, `.align`, and
  symbol assignment. Macros, linkers, and host-file includes are outside the initial scope.
- Comments begin with `;`. Labels may precede an instruction or directive on the same line.
- A deterministic multi-pass resolver supports forward labels and reports undefined,
  duplicate, phase-changing, overflow, branch-range, and addressing-mode errors.

### Expression grammar (as implemented)

Operand and directive expressions use a small, unambiguous grammar:

```text
expression := [ '<' | '>' ] additive          ; '<' = low byte, '>' = high byte of the result
additive   := primary ( ('+' | '-') primary )*
primary    := number | charLiteral | identifier | '*'   ; '*' = current program counter
```

Parentheses are reserved for indirect addressing and are not expression grouping, and there
is no `*`/`/` operator (so `*` is always the program counter). Numbers are `$hex`, `%binary`,
or decimal. A character literal `'c'` evaluates to its PETSCII byte.

### PETSCII text mapping (as implemented)

`.text` and character literals use a fixed, documented mapping. Rendering depends on the
active C64 charset, but the byte mapping is deterministic:

| Input code points | PETSCII byte |
|-------------------|--------------|
| `0x20..0x5A` (space, digits, punctuation, `@`, `A`–`Z`) | identity |
| `[` and `]` | `0x5B`, `0x5D` |
| `a`–`z` (`0x61..0x7A`) | `0xC1..0xDA` (add `0x60`) |

Every other input — control characters, `\ ^ _ ` { | } ~`, and any non-ASCII/Unicode code
point — is an `unsupported-character` error rather than a lossy conversion.

### Directives (as implemented)

`* =`/`.org` set the program counter; `.byte`, `.word`, and `.text` emit data; `.fill count
[, value]` emits repeated bytes; `.align n` advances the program counter to the next multiple
of `n` (the gap is `$00`-filled by the image serializer). Instruction size selection between
zero page and absolute is a grow-only multi-pass fixpoint: an unresolved zero-page-capable
operand begins at zero-page width and grows to absolute once its resolved value requires it,
never shrinking, so the layout converges deterministically. Final zero-page selection requires
a resolved value `<= $FF` and a supported zero-page addressing mode; otherwise the absolute
form is used. Because forward references are resolved (not forced wide), a forward reference to
a zero-page address encodes as zero page.

### Limits and bounds (as implemented)

- The normalized canonical source (after line-ending normalization) is capped at 256 KiB
  UTF-8 at the pipeline boundary (`invalid-project` above that). The cap is measured on the
  normalized source, not on raw pre-normalization bytes. The web client separately rejects
  oversized decoded payloads before allocation per [`WEB-CLIENT.md`](./WEB-CLIENT.md); that is
  a distinct client-side limit.
- The multi-pass resolver uses a deterministic bounded pass limit (`statements*3 + 64`, over
  content-bearing statements only; blank and comment lines do not count). Ordinary source
  converges in a few passes. **Accepted limitation:** a pathologically deep chain of forward
  width-dependent dependencies whose true convergence would need a super-linear number of
  passes is reported as `phase-error` rather than assembled. This is deliberate: an unbounded
  or quadratic pass limit would create a CPU-exhaustion risk for a browser-hosted assembler,
  and real 6502 source does not require it.

## PRG and entry rules

- Every PRG begins with the two-byte little-endian load address, followed by a contiguous
  memory image. Gaps between emitted ranges are filled with `$00`; overlaps are errors.
- The image may end at `$10000` but may not wrap. Empty output is an error.
- `direct` mode emits source exactly at the configured origins and records `runAddress`.
  Browser Run loads the PRG then starts the CPU at `runAddress`. The downloaded PRG does not
  claim to auto-start on a stock C64.
- `basic-sys` mode is the default for examples. It requires load address `$0801`, emits a
  tokenized one-line BASIC program equivalent to `10 SYS <runAddress>`, terminates the BASIC
  program correctly, and places machine code after the stub unless source explicitly
  selects a non-overlapping later origin. Browser Run uses the same stub through the BASIC
  environment. The resulting PRG can be loaded and started with `RUN` on a standard C64.
- In basic-sys mode the assembler derives `runAddress` from final addresses: it equals the
  first emitted machine-code byte. By default that is the byte immediately after the stub
  (`$080D` for a 4-digit SYS target), computed as the fixed point of
  `origin = $0801 + stubLength(origin)`; if the source relocates to a higher origin, the SYS
  target and the recorded `runAddress` follow it and the gap is `$00`-filled. The
  `SourceProject.runAddress` field is authoritative only in `direct` mode.
- The SYS decimal text, BASIC next-line pointer, terminators, and machine-code origin are
  generated from final addresses and covered by byte-exact vectors.

## Determinism and rebuild rules

- The assembler has no access to wall-clock time, locale-sensitive formatting, randomness,
  network resources, or browser-only APIs.
- A shared project must rebuild byte-identical PRG and D64 output for the same version.
- Gallery entries declare the expected `buildId`; CI/headless tests fail when committed
  source and expected artifacts diverge.
- Diagnostics are sorted by source position, then stable code, independent of map iteration
  order.
- Assembly failure produces diagnostics and no PRG/D64. The UI must retain the last source
  but must not label stale artifacts as the current build.

## Data flow

`editor/gallery/URL source -> canonical SourceProject -> lexer/parser/pass resolver ->
contiguous memory image -> PRG serializer -> emulator + MEDIA D64 builder + downloads`.

## Error handling

Diagnostic codes are stable public contracts. At minimum:

- `syntax`, `unknown-opcode`, `invalid-addressing-mode`
- `undefined-symbol`, `duplicate-symbol`, `phase-error`
- `range`, `branch-range`, `overlap`, `empty-output`
- `invalid-project`, `unsupported-character`, `unsupported-target`

Unexpected exceptions reject the build as `internal` and preserve the source. They are not
converted to empty successful artifacts.

## Dependencies

- Upstream: [`WEB-CLIENT.md`](./WEB-CLIENT.md) project input and examples.
- Downstream: [`MEDIA.md`](./MEDIA.md), [`EMULATOR.md`](./EMULATOR.md), downloads, native
  and headless golden-vector tests.

## Implementation Status

| Item | Status | Notes |
|------|--------|-------|
| Source project schema | Implemented | Validation, defaults, LF normalization, canonical JSON, SHA-256 buildId |
| Lexer/parser and NMOS instruction table | Implemented | Complete 151-opcode documented set; no 65C02/undocumented opcodes |
| Multi-pass symbol resolution | Implemented | Grow-only zero-page/absolute fixpoint; stable sorted diagnostics |
| PRG serializer and BASIC SYS stub | Implemented | Byte-exact stub and gap/overlap/range handling under golden vectors |
| Browser/Node dual-use packaging | Implemented | Single ES module in `src/`; no runtime deps or environment globals |
| Worker integration and UI wiring | Implemented | The `web/client/` module worker imports these same `src/` modules; see `WEB-CLIENT.md` |
