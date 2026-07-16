; border-flash.asm — canonical c64 pipeline example.
;
; This example needs no Commodore ROM bytes. It exercises the full documented path:
; symbol assignment, zero-page vs absolute selection, immediate operands, absolute,X
; indexing, relative branches, a forward-referenced subroutine call, and the .byte, .text,
; and .word directives. Each colour remains visible for several PAL frames. In basic-sys
; run mode the assembler prepends a "10 SYS <addr>" stub so the resulting PRG starts with
; RUN on a stock C64.

BORDER  = $d020            ; VIC-II border colour register (absolute)
ZPTMP   = $02              ; a zero-page scratch byte

        ldx #$00           ; immediate
next
        lda palette,x      ; absolute,X table lookup (palette is a 16-bit label)
        sta BORDER         ; absolute store
        jsr delay          ; forward-referenced subroutine (absolute)
        inx
        cpx #$05           ; immediate compare
        bne next           ; relative branch, backward
        ldx #$00
        jmp next           ; repeat forever

delay                      ; about three PAL frames at the documented CPU clock
        ldy #$1e
outer
        lda #$00
        sta ZPTMP          ; zero-page store; zero means 256 decrements
inner
        dec ZPTMP
        bne inner
        dey
        bne outer
        rts

palette .byte $00, $06, $0e, $01, $02
banner  .text "HELLO C64"
        .word next, delay  ; little-endian address table
