import { describe, expect, it } from 'vitest'
import { isLikelyEsp32Vid } from './esp32VidPid'

describe('isLikelyEsp32Vid', () => {
  it('matches known ESP32 USB-serial bridge vendor ids', () => {
    expect(isLikelyEsp32Vid(0x10c4)).toBe(true) // Silicon Labs CP210x
    expect(isLikelyEsp32Vid(0x1a86)).toBe(true) // WCH CH340/CH341
    expect(isLikelyEsp32Vid(0x0403)).toBe(true) // FTDI
    expect(isLikelyEsp32Vid(0x303a)).toBe(true) // Espressif native USB
  })

  it('rejects unrelated or missing vendor ids', () => {
    expect(isLikelyEsp32Vid(0x046d)).toBe(false) // Logitech, e.g. a USB mouse
    expect(isLikelyEsp32Vid(null)).toBe(false)
  })
})
