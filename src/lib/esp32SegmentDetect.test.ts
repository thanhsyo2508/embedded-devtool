import { describe, expect, it } from 'vitest'
import { detectSegments } from './esp32SegmentDetect'
import type { PartitionEntry } from '../api/flash'

const OTA_PARTITIONS: PartitionEntry[] = [
  { label: 'nvs', partType: 0x01, subtype: 0x02, offset: 0x9000, size: 0x5000 },
  { label: 'otadata', partType: 0x01, subtype: 0x00, offset: 0xe000, size: 0x2000 },
  { label: 'app0', partType: 0x00, subtype: 0x10, offset: 0x10000, size: 0x140000 },
  { label: 'app1', partType: 0x00, subtype: 0x11, offset: 0x150000, size: 0x140000 },
  { label: 'spiffs', partType: 0x01, subtype: 0x82, offset: 0x290000, size: 0x160000 },
]

describe('detectSegments', () => {
  it('matches bootloader/partition-table/app/fs and auto-adds bundled boot_app0 for an OTA table', () => {
    const result = detectSegments({
      filePaths: [
        'C:\\build\\bootloader.bin',
        'C:\\build\\partitions.bin',
        'C:\\build\\firmware.bin',
        'C:\\build\\spiffs.bin',
      ],
      partitions: OTA_PARTITIONS,
      chipFamily: 'other',
      bootApp0Path: 'C:\\temp\\edt-boot_app0.bin',
    })

    expect(result).toEqual([
      { offset: 0x0, path: 'C:\\build\\bootloader.bin', label: 'bootloader', source: 'convention' },
      {
        offset: 0x8000,
        path: 'C:\\build\\partitions.bin',
        label: 'partition table',
        source: 'convention',
      },
      // Two app-type entries (app0/app1) with one candidate file is
      // ambiguous, so it's left unmatched rather than guessed.
      { offset: null, path: 'C:\\build\\firmware.bin', label: '', source: 'unmatched' },
      {
        offset: 0x290000,
        path: 'C:\\build\\spiffs.bin',
        label: 'spiffs',
        source: 'partition-table',
      },
      {
        offset: 0xe000,
        path: 'C:\\temp\\edt-boot_app0.bin',
        label: 'otadata (bundled boot_app0.bin)',
        source: 'partition-table',
      },
    ])
  })

  it('uses offset 0x1000 for the original ESP32 bootloader, not S2/S3/C3', () => {
    const esp32 = detectSegments({
      filePaths: ['bootloader.bin'],
      partitions: null,
      chipFamily: 'esp32',
      bootApp0Path: null,
    })
    expect(esp32[0].offset).toBe(0x1000)

    const s3 = detectSegments({
      filePaths: ['bootloader.bin'],
      partitions: null,
      chipFamily: 'other',
      bootApp0Path: null,
    })
    expect(s3[0].offset).toBe(0x0)
  })

  it('falls back to the 0x10000 app convention when no table is given and exactly one app file is selected', () => {
    const result = detectSegments({
      filePaths: ['firmware.bin'],
      partitions: null,
      chipFamily: null,
      bootApp0Path: null,
    })
    expect(result).toEqual([
      { offset: 0x10000, path: 'firmware.bin', label: 'app', source: 'convention' },
    ])
  })

  it('never guesses a filesystem image offset without a partition table', () => {
    const result = detectSegments({
      filePaths: ['spiffs.bin'],
      partitions: null,
      chipFamily: null,
      bootApp0Path: null,
    })
    expect(result).toEqual([{ offset: null, path: 'spiffs.bin', label: '', source: 'unmatched' }])
  })

  it('leaves a manually-selected boot_app0.bin unmatched-offset-wise only in convention form when no otadata entry exists', () => {
    const noOtaTable: PartitionEntry[] = [
      { label: 'nvs', partType: 0x01, subtype: 0x02, offset: 0x9000, size: 0x5000 },
      { label: 'factory', partType: 0x00, subtype: 0x00, offset: 0x10000, size: 0x100000 },
    ]
    const result = detectSegments({
      filePaths: ['boot_app0.bin'],
      partitions: noOtaTable,
      chipFamily: null,
      bootApp0Path: null,
    })
    expect(result).toEqual([
      { offset: 0xe000, path: 'boot_app0.bin', label: 'otadata', source: 'convention' },
    ])
  })

  it('does not double-count a manually selected boot_app0.bin alongside the bundled one', () => {
    const result = detectSegments({
      filePaths: ['boot_app0.bin'],
      partitions: OTA_PARTITIONS,
      chipFamily: null,
      bootApp0Path: 'C:\\temp\\edt-boot_app0.bin',
    })
    expect(result).toEqual([
      { offset: 0xe000, path: 'boot_app0.bin', label: 'otadata', source: 'partition-table' },
    ])
  })
})
