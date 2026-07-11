// USB vendor IDs of the serial bridges commonly used on ESP32 dev boards —
// a cheap pre-filter before paying for a real espflash handshake (which
// opens the port exclusively and takes hundreds of ms to seconds). This is
// a heuristic, not a guarantee: other boards (Arduino Uno, random USB-serial
// adapters) share the same bridge chips. That's fine because the flash
// handshake itself validates the chip is really in the ESP-ROM bootloader
// and fails harmlessly if not — this filter only decides what's worth trying.
const ESP32_LIKELY_VENDOR_IDS = new Set<number>([
  0x10c4, // Silicon Labs CP210x
  0x1a86, // WCH CH340/CH341
  0x0403, // FTDI FT232/FT2232
  0x303a, // Espressif native USB (JTAG/Serial on S2/S3/C3/C6...)
])

export function isLikelyEsp32Vid(vid: number | null): boolean {
  return vid !== null && ESP32_LIKELY_VENDOR_IDS.has(vid)
}
