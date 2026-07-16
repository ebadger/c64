// Machine-level and critical-path tests. The border/background test protects the product
// critical path: a direct-mode PRG assembled by the merged src/ pipeline is loaded into the
// core, run for a frame, and the resulting indexed framebuffer plus VIC registers are observed.
// The PRG bytes and expectations come from the committed, assembler-generated fixture header.
#include "c64/errors.hpp"
#include "c64/machine.hpp"
#include "fixtures/border_bg_fixture.hpp"
#include "test_framework.hpp"

using namespace c64;

TEST(border_bg_fixture_renders_framebuffer) {
  Machine m;
  const LoadResult lr = m.loadPrg(c64_fixture::kBorderBgPrg, sizeof(c64_fixture::kBorderBgPrg));
  REQUIRE(lr.ok);
  REQUIRE_EQ(lr.loadAddress, c64_fixture::kBorderBgLoadAddress);

  m.setPc(c64_fixture::kBorderBgRunAddress);
  m.runFrame();

  // VIC register state set by the program.
  REQUIRE_EQ(m.vic().borderColor(), c64_fixture::kExpectedBorder);
  REQUIRE_EQ(m.vic().backgroundColor0(), c64_fixture::kExpectedBackground);

  // CPU-visible register read (I/O banked in): colour registers read back with high nibble set.
  REQUIRE_EQ(m.readMem(0xD020) & 0x0F, c64_fixture::kExpectedBorder);
  REQUIRE_EQ(m.readMem(0xD021) & 0x0F, c64_fixture::kExpectedBackground);

  // Rendered indexed framebuffer.
  const std::vector<u8>& fb = m.framebuffer();
  REQUIRE_EQ(static_cast<long>(fb.size()),
             static_cast<long>(c64_fixture::kFrameWidth) * c64_fixture::kFrameHeight);
  REQUIRE_EQ(fb[c64_fixture::kBorderSampleIndex], c64_fixture::kExpectedBorder);
  REQUIRE_EQ(fb[c64_fixture::kCentreSampleIndex], c64_fixture::kExpectedBackground);

  // A full frame completed deterministically.
  REQUIRE(m.frameInfo().sequence >= 1);
}

TEST(loadprg_validates_header) {
  Machine m;
  const u8 tooShort[] = {0x00, 0x08};
  REQUIRE(!m.loadPrg(tooShort, sizeof(tooShort)).ok);

  // Load address $FFFF with two data bytes wraps past $FFFF.
  const u8 overflow[] = {0xFF, 0xFF, 0x01, 0x02};
  const LoadResult r = m.loadPrg(overflow, sizeof(overflow));
  REQUIRE(!r.ok);
  REQUIRE_EQ(r.errorCode, static_cast<int>(ErrorCode::InvalidPrg));

  // A valid minimal image.
  const u8 ok[] = {0x00, 0xC0, 0xEA};
  const LoadResult good = m.loadPrg(ok, sizeof(ok));
  REQUIRE(good.ok);
  REQUIRE_EQ(good.loadAddress, 0xC000);
  REQUIRE_EQ(static_cast<long>(good.endAddressExclusive), 0xC001);
  REQUIRE_EQ(m.readMem(0xC000), 0xEA);
}

TEST(processor_port_banks_io_in_and_out) {
  Machine m;
  // Default port ($37) banks I/O in: a $D020 write reaches the VIC register.
  m.writeMem(0xD020, 0x05);
  REQUIRE_EQ(m.readMem(0xD020) & 0x0F, 0x05);
  REQUIRE_EQ(m.vic().borderColor(), 0x05);

  // Bank I/O out (CHAREN set but LORAM/HIRAM clear): $D020 becomes plain RAM.
  m.writeMem(0x0001, 0x34);
  m.writeMem(0xD020, 0xAB);
  REQUIRE_EQ(m.readMem(0xD020), 0xAB);   // reads underlying RAM now
  REQUIRE_EQ(m.vic().borderColor(), 0x05); // VIC register untouched by the RAM write
}

TEST(runframe_advances_frame_sequence) {
  Machine m;
  m.bus().loadRam(0xC000, 0x4C); // JMP $C000 (spin)
  m.bus().loadRam(0xC001, 0x00);
  m.bus().loadRam(0xC002, 0xC0);
  m.setPc(0xC000);
  REQUIRE_EQ(static_cast<long>(m.frameInfo().sequence), 0);
  m.runFrame();
  REQUIRE(m.frameInfo().sequence >= 1);
}
