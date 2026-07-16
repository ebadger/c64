#include "c64/cia.hpp"

#include <array>

#include "test_framework.hpp"

using namespace c64;

namespace {
// Tick a CIA a given number of cycles.
void run(Cia& cia, u32 cycles) {
  for (u32 i = 0; i < cycles; ++i) cia.tickCycle();
}
constexpr u32 kPalFrame = 19656;
}  // namespace

TEST(cia_ports_ddr_readback) {
  Cia cia(Cia::Variant::Cia2);  // CIA2 has no keyboard, clean port semantics
  cia.configure(kPalFrame);
  cia.reset();
  // All-input: reads the pull-ups.
  cia.write(0x2, 0x00);  // DDRA = input
  CHECK_EQ(cia.read(0x0, true), 0xFFu);
  // Output some bits, read back the latched output value on output bits.
  cia.write(0x2, 0xFF);  // DDRA = output
  cia.write(0x0, 0x5A);
  CHECK_EQ(cia.read(0x0, true), 0x5Au);
  // Mixed DDR: low nibble output, high nibble input (pull-ups).
  cia.write(0x2, 0x0F);
  cia.write(0x0, 0xA5);
  CHECK_EQ(cia.read(0x0, true), 0xF5u);  // (0xA5 & 0x0F) | (0xFF & 0xF0)
}

TEST(cia2_vic_bank_selection) {
  Cia cia(Cia::Variant::Cia2);
  cia.configure(kPalFrame);
  cia.reset();
  cia.write(0x2, 0x03);  // PA0/PA1 outputs
  cia.write(0x0, 0x03);  // %11 -> bank 0
  CHECK_EQ(cia.vicBank(), 0u);
  cia.write(0x0, 0x00);  // %00 -> bank 3
  CHECK_EQ(cia.vicBank(), 3u);
  cia.write(0x0, 0x02);  // %10 -> bank 1
  CHECK_EQ(cia.vicBank(), 1u);
}

TEST(cia_keyboard_matrix_scan) {
  Cia cia(Cia::Variant::Cia1);
  cia.configure(kPalFrame);
  cia.reset();
  cia.write(0x2, 0xFF);  // PRA = output (column select)
  cia.write(0x3, 0x00);  // PRB = input (row read)
  // Press key at column 2, row 5 (active-low: clear bit 5 of column 2).
  std::array<u8, 8> cols;
  cols.fill(0xFF);
  cols[2] = static_cast<u8>(~(1u << 5) & 0xFF);
  cia.setKeyboard(cols);
  // Select only column 2 (drive it low).
  cia.write(0x0, static_cast<u8>(~(1u << 2) & 0xFF));
  CHECK_EQ(cia.read(0x1, true), static_cast<u8>(~(1u << 5) & 0xFF));  // row 5 pulled low
  // Select a different column: key not seen.
  cia.write(0x0, static_cast<u8>(~(1u << 0) & 0xFF));
  CHECK_EQ(cia.read(0x1, true), 0xFFu);
}

TEST(cia_joystick_ports) {
  Cia cia(Cia::Variant::Cia1);
  cia.configure(kPalFrame);
  cia.reset();
  cia.write(0x2, 0x00);  // PRA input
  cia.write(0x3, 0x00);  // PRB input
  // Joystick 2 fire (bit4) engaged on PRA; joystick 1 left (bit2) engaged on PRB.
  cia.setJoysticks(static_cast<u8>(~(1u << 2) & 0xFF), static_cast<u8>(~(1u << 4) & 0xFF));
  CHECK_EQ(cia.read(0x0, true) & 0x10, 0x00u);  // PRA bit4 low
  CHECK_EQ(cia.read(0x1, true) & 0x04, 0x00u);  // PRB bit2 low
}

TEST(cia_timer_a_oneshot_underflow_irq) {
  Cia cia(Cia::Variant::Cia1);
  cia.configure(kPalFrame);
  cia.reset();
  cia.write(0xD, 0x81);  // enable timer A interrupt (bit7 set + bit0)
  cia.write(0x4, 0x03);  // latch A lo = 3
  cia.write(0x5, 0x00);  // latch A hi = 0 -> counter loaded (stopped)
  cia.write(0xE, 0x09);  // CRA: start (bit0) + one-shot (bit3)
  CHECK(!cia.irqAsserted());
  run(cia, 3);           // counts 3,2,1 -> reaches 0
  CHECK(!cia.irqAsserted());
  run(cia, 1);           // underflow: reload + IRQ + stop
  CHECK(cia.irqAsserted());
  // ICR read returns the pending bit + IR and clears it.
  const u8 icr = cia.read(0xD, true);
  CHECK_EQ(icr & 0x01, 0x01u);
  CHECK_EQ(icr & 0x80, 0x80u);
  CHECK(!cia.irqAsserted());
  // One-shot stopped the timer (CRA bit0 cleared).
  CHECK_EQ(cia.read(0xE, true) & 0x01, 0x00u);
}

TEST(cia_timer_continuous_period) {
  Cia cia(Cia::Variant::Cia1);
  cia.configure(kPalFrame);
  cia.reset();
  cia.write(0xD, 0x81);
  cia.write(0x4, 0x01);  // latch lo = 1
  cia.write(0x5, 0x00);
  cia.write(0xE, 0x01);  // start, continuous
  run(cia, 2);           // period = latch+1 = 2 -> one underflow
  CHECK(cia.irqAsserted());
  cia.read(0xD, true);   // clear
  run(cia, 2);           // next underflow
  CHECK(cia.irqAsserted());
}

TEST(cia_timer_b_chains_timer_a) {
  Cia cia(Cia::Variant::Cia1);
  cia.configure(kPalFrame);
  cia.reset();
  cia.write(0xD, 0x82);  // enable timer B interrupt
  cia.write(0x4, 0x01);  // TA latch lo = 1 (period 2)
  cia.write(0x5, 0x00);
  cia.write(0x6, 0x02);  // TB latch lo = 2 (counts 2 TA underflows)
  cia.write(0x7, 0x00);
  cia.write(0xF, 0x41);  // CRB: INMODE=10 (TA underflow), start
  cia.write(0xE, 0x01);  // CRA: start timer A
  // TA underflows every 2 cycles; TB needs 3 TA underflows to underflow (period latch+1=3).
  run(cia, 6);           // 3 TA underflows
  CHECK(cia.irqAsserted());
  const u8 icr = cia.read(0xD, true);
  CHECK_EQ(icr & 0x02, 0x02u);  // timer B flagged
}

TEST(cia_tod_advances_and_alarm) {
  Cia cia(Cia::Variant::Cia1);
  cia.configure(kPalFrame);
  cia.reset();
  cia.write(0xE, 0x80);  // CRA bit7 = 50 Hz TOD input (divide by 5)
  // Set clock to 00:00:00.0 (writing hours halts, writing 10ths restarts).
  cia.write(0xB, 0x12);  // hours = 12 (AM)
  cia.write(0xA, 0x00);
  cia.write(0x9, 0x00);
  cia.write(0x8, 0x00);  // restart
  // Program an alarm at 10ths = 2.
  cia.write(0xF, 0x80);  // CRB bit7 -> writes target the alarm
  cia.write(0xB, 0x12);
  cia.write(0xA, 0x00);
  cia.write(0x9, 0x00);
  cia.write(0x8, 0x02);
  cia.write(0xF, 0x00);  // back to clock writes
  cia.write(0xD, 0x84);  // enable alarm interrupt (bit2)
  // 5 frames per 10th. Advance 2 tenths' worth of cycles.
  run(cia, 5u * kPalFrame);         // 10ths -> 1
  CHECK_EQ(cia.read(0x8, true), 0x01u);
  run(cia, 5u * kPalFrame);         // 10ths -> 2 (alarm)
  CHECK(cia.irqAsserted());
}

TEST(cia_icr_mask_set_clear) {
  Cia cia(Cia::Variant::Cia1);
  cia.configure(kPalFrame);
  cia.reset();
  cia.write(0x4, 0x01);
  cia.write(0x5, 0x00);
  cia.write(0xE, 0x01);  // start continuous
  run(cia, 2);           // underflow sets data bit but mask is 0 -> no IRQ
  CHECK(!cia.irqAsserted());
  // Enable the mask for an already-pending source -> IRQ asserts immediately.
  cia.write(0xD, 0x81);
  CHECK(cia.irqAsserted());
  // Clear the mask bit.
  cia.write(0xD, 0x01);  // bit7=0 -> clear listed bits
  CHECK(!cia.irqAsserted());
}
