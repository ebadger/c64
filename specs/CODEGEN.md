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
| Source project schema | Specified | Implementation not started |
| Lexer/parser and NMOS instruction table | Not started | No 65C02 extensions |
| Multi-pass symbol resolution | Not started | Stable diagnostics required |
| PRG serializer and BASIC SYS stub | Not started | Byte-exact vectors required |
| Browser/Node dual-use packaging | Not started | Single implementation |
