import { describe, expect, it } from 'vitest'
import { isNumeric, parseTelemetry } from './telemetryParse'

describe('parseTelemetry', () => {
  it('parses key=value pairs', () => {
    expect(parseTelemetry('temp=21.5 hum=60')).toEqual({ temp: '21.5', hum: '60' })
  })

  it('parses key: value pairs', () => {
    expect(parseTelemetry('rssi: -70 state: OK')).toEqual({ rssi: '-70', state: 'OK' })
  })

  it('parses flat JSON', () => {
    expect(parseTelemetry('{"v":3.3,"on":true,"name":"node1"}')).toEqual({
      v: '3.3',
      on: 'true',
      name: 'node1',
    })
  })

  it('unquotes quoted values in pair form', () => {
    expect(parseTelemetry('id="abc 123"')).toEqual({ id: 'abc 123' })
  })

  it('returns nothing for prose without pairs', () => {
    expect(parseTelemetry('the quick brown fox')).toEqual({})
  })

  it('detects numeric values', () => {
    expect(isNumeric('21.5')).toBe(true)
    expect(isNumeric('-70')).toBe(true)
    expect(isNumeric('OK')).toBe(false)
    expect(isNumeric('')).toBe(false)
  })
})
