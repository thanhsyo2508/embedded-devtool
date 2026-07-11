import type { PartitionEntry } from '../api/flash'

export interface DetectedSegment {
  /** `null` means "couldn't determine — needs manual entry", never a guess.
   * Can't reuse 0 as that sentinel: 0x0 is the real bootloader offset on
   * S2/S3/C3/C6/H2. */
  offset: number | null
  path: string
  label: string
  /** 'partition-table' = read from a real parsed partitions.bin (trust
   * fully). 'convention' = a hardware/near-universal-default constant
   * (bootloader offset by chip family, or 0x10000/0x8000/0xe000 when no
   * table was provided — safe because these don't vary with flash
   * size/partition scheme). 'unmatched' = a selected file whose role/offset
   * couldn't be determined; left for the user to fill in by hand rather
   * than guessed. */
  source: 'partition-table' | 'convention' | 'unmatched'
}

const FS_NAME_HINT = /spiffs|littlefs|fatfs|storage|\bfs\b|www|data/i
const FS_SUBTYPES = new Set([0x80, 0x81, 0x82, 0x83]) // esphttpd/fat/spiffs/littlefs
const OTADATA_TYPE = 0x01
const OTADATA_SUBTYPE = 0x00
const APP_TYPE = 0x00

function baseName(path: string): string {
  return path.split(/[/\\]/).pop() ?? path
}

function isBootloaderFile(name: string): boolean {
  return /bootloader/i.test(name) && /\.bin$/i.test(name)
}

function isPartitionTableFile(name: string): boolean {
  return /partition/i.test(name) && /\.bin$/i.test(name)
}

function isBootApp0File(name: string): boolean {
  return /boot_?app0/i.test(name) && /\.bin$/i.test(name)
}

function isFsLike(name: string): boolean {
  return FS_NAME_HINT.test(name)
}

function isFsPartition(entry: PartitionEntry): boolean {
  return entry.partType === 0x01 && FS_SUBTYPES.has(entry.subtype)
}

/** Matches a set of user-selected build-output files to their flash
 * offsets. Trusts a parsed partition table (`partitions`) as the source of
 * truth whenever one was selected — never guesses a filesystem image's
 * offset without one, since that varies with flash size/partition scheme
 * and a wrong guess could overwrite the app. Bootloader/app/partition-table
 * offsets are safe to fall back to well-known conventions even without a
 * table. */
export function detectSegments(params: {
  filePaths: string[]
  partitions: PartitionEntry[] | null
  /** 'esp32' = original ESP32 (bootloader @ 0x1000); anything else
   * (S2/S3/C2/C3/C6/H2, or unknown) starts its bootloader @ 0x0. */
  chipFamily: 'esp32' | 'other' | null
  bootApp0Path: string | null
}): DetectedSegment[] {
  const { filePaths, partitions, chipFamily, bootApp0Path } = params
  const segments: DetectedSegment[] = []
  const bootloaderOffset = chipFamily === 'esp32' ? 0x1000 : 0x0

  const bootloaderFile = filePaths.find((p) => isBootloaderFile(baseName(p)))
  const partitionTableFile = filePaths.find((p) => isPartitionTableFile(baseName(p)))
  const manualBootApp0File = filePaths.find((p) => isBootApp0File(baseName(p)))

  if (bootloaderFile) {
    segments.push({
      offset: bootloaderOffset,
      path: bootloaderFile,
      label: 'bootloader',
      source: 'convention',
    })
  }
  if (partitionTableFile) {
    segments.push({
      offset: 0x8000,
      path: partitionTableFile,
      label: 'partition table',
      source: 'convention',
    })
  }

  const claimed = new Set([bootloaderFile, partitionTableFile, manualBootApp0File])
  const remaining = filePaths.filter((p) => !claimed.has(p))
  const fsFiles = remaining.filter((p) => isFsLike(baseName(p)))
  const appFiles = remaining.filter((p) => !isFsLike(baseName(p)))

  if (partitions) {
    const appEntries = partitions.filter((e) => e.partType === APP_TYPE)
    const fsEntries = partitions.filter(isFsPartition)
    const otadataEntry = partitions.find(
      (e) => e.partType === OTADATA_TYPE && e.subtype === OTADATA_SUBTYPE,
    )

    // Only auto-match when there's exactly one candidate file *and* exactly
    // one matching partition entry — with more of either, which file goes
    // where is ambiguous, and guessing could put two files at the same
    // offset. Leave all of them unmatched for manual assignment instead.
    if (appFiles.length === 1 && appEntries.length === 1) {
      segments.push({
        offset: appEntries[0].offset,
        path: appFiles[0],
        label: appEntries[0].label,
        source: 'partition-table',
      })
    } else {
      for (const file of appFiles) {
        segments.push({ offset: null, path: file, label: '', source: 'unmatched' })
      }
    }
    if (fsFiles.length === 1 && fsEntries.length === 1) {
      segments.push({
        offset: fsEntries[0].offset,
        path: fsFiles[0],
        label: fsEntries[0].label,
        source: 'partition-table',
      })
    } else {
      for (const file of fsFiles) {
        segments.push({ offset: null, path: file, label: '', source: 'unmatched' })
      }
    }

    if (manualBootApp0File) {
      segments.push({
        offset: otadataEntry?.offset ?? 0xe000,
        path: manualBootApp0File,
        label: otadataEntry?.label ?? 'otadata',
        source: otadataEntry ? 'partition-table' : 'convention',
      })
    } else if (otadataEntry && bootApp0Path) {
      segments.push({
        offset: otadataEntry.offset,
        path: bootApp0Path,
        label: `${otadataEntry.label} (bundled boot_app0.bin)`,
        source: 'partition-table',
      })
    }
  } else {
    // No table selected — only fall back to convention offsets for the app
    // when there's exactly one unambiguous candidate; a filesystem image's
    // offset is never guessed without a table.
    if (appFiles.length === 1) {
      segments.push({ offset: 0x10000, path: appFiles[0], label: 'app', source: 'convention' })
    } else {
      for (const file of appFiles) {
        segments.push({ offset: null, path: file, label: '', source: 'unmatched' })
      }
    }
    for (const file of fsFiles) {
      segments.push({ offset: null, path: file, label: '', source: 'unmatched' })
    }
    if (manualBootApp0File) {
      segments.push({
        offset: 0xe000,
        path: manualBootApp0File,
        label: 'otadata',
        source: 'convention',
      })
    }
  }

  return segments
}
