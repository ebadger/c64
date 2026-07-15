; border-flash.asm — canonical c64 pipeline example.
;
; This example needs no Commodore ROM bytes. It exercises the full documented path:
; symbol assignment, zero-page vs absolute selection, immediate operands, absolute,X
; indexing, a relative branch, a forward-referenced subroutine call, and the .byte, .text,
; and .word directives. In basic-sys run mode the assembler prepends a "10 SYS <addr>" stub
; so the resulting PRG starts with RUN on a stock C64.

BORDER  = $d020            ; VIC-II border colour register (absolute)
ZPTMP   = $02              ; a zero-page scratch byte

        ldx #$00           ; immediate
next
        lda palette,x      ; absolute,X table lookup (palette is a 16-bit label)
        sta BORDER         ; absolute store
        stx ZPTMP          ; zero-page store
        inx
        cpx #$05           ; immediate compare
        bne next           ; relative branch, backward
        jsr flash          ; forward-referenced subroutine (absolute)
done
        jmp done           ; halt loop

flash                      ; subroutine defined after its call site
        lda #$01
        sta BORDER
        rts

palette .byte $00, $06, $0e, $01, $02
banner  .text "HELLO C64"
        .word done, flash  ; little-endian address table
