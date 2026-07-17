// Minimal bus contract shared by the C64 6510 and 1541 6502.
#ifndef C64_CPU_BUS_HPP
#define C64_CPU_BUS_HPP

#include "c64/types.hpp"

namespace c64 {

class CpuBus {
 public:
  virtual ~CpuBus() = default;

  virtual u8 readCycle(u16 addr) = 0;
  virtual void writeCycle(u16 addr, u8 value) = 0;
  virtual u8 peek(u16 addr) const = 0;
};

}  // namespace c64

#endif  // C64_CPU_BUS_HPP
