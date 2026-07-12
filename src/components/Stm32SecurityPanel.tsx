import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useStm32Store } from '../state/stm32Store'
import { RefreshIcon } from './icons'
import { TypedConfirm } from './TypedConfirm'

// Standard STM32 RDP option-byte values — consistent across the F/G/L/H
// families per ST's reference manuals, unlike write-protection field names
// which vary too much per family to curate safely (see stm32.rs).
const RDP_LEVEL_VALUES: Record<0 | 1 | 2, string> = { 0: '0xAA', 1: '0xBB', 2: '0xCC' }

function parseRdpLevel(text: string | null): 0 | 1 | 2 | null {
  if (!text) return null
  const match = /RDP\s*[:=]?\s*(0x[0-9a-fA-F]+)/.exec(text)
  if (!match) return null
  const value = match[1].toUpperCase()
  if (value === '0XAA') return 0
  if (value === '0XCC') return 2
  return 1
}

/** Curated Readout Protection level selector, built on the same raw
 * `-ob RDP=...` write the generic option-bytes editor below already uses —
 * this just gives the three standard levels clear explanations and a
 * heavier, typed confirmation for Level 2 (permanent, cannot be undone). */
export function Stm32SecurityPanel() {
  const { t } = useTranslation()
  const optionBytesText = useStm32Store((s) => s.optionBytesText)
  const busy = useStm32Store((s) => s.busy)
  const readOptionBytes = useStm32Store((s) => s.readOptionBytes)
  const writeOptionByte = useStm32Store((s) => s.writeOptionByte)

  const currentLevel = useMemo(() => parseRdpLevel(optionBytesText), [optionBytesText])

  const applyLevel = (level: 0 | 1) => {
    if (window.confirm(t('stm32.security.confirmLevel', { level }))) {
      void writeOptionByte('RDP', RDP_LEVEL_VALUES[level])
    }
  }

  return (
    <div className="stm32-security">
      <div className="settings-row">
        <span className="ota-hint">{t('stm32.security.rdpHint')}</span>
        <button type="button" disabled={busy} onClick={() => void readOptionBytes()}>
          <RefreshIcon /> {t('stm32.read')}
        </button>
      </div>
      {currentLevel !== null && (
        <p className="stm32-security-current">
          {t('stm32.security.currentLevel', { level: currentLevel })}
        </p>
      )}

      <div className="stm32-security-levels">
        <div className="stm32-security-level">
          <div>
            <strong>{t('stm32.security.level0Title')}</strong>
            <p>{t('stm32.security.level0Desc')}</p>
          </div>
          <button type="button" disabled={busy} onClick={() => applyLevel(0)}>
            {t('stm32.security.apply')}
          </button>
        </div>
        <div className="stm32-security-level">
          <div>
            <strong>{t('stm32.security.level1Title')}</strong>
            <p>{t('stm32.security.level1Desc')}</p>
          </div>
          <button type="button" disabled={busy} onClick={() => applyLevel(1)}>
            {t('stm32.security.apply')}
          </button>
        </div>
        <div className="stm32-security-level stm32-security-level-danger">
          <div>
            <strong>{t('stm32.security.level2Title')}</strong>
            <p>{t('stm32.security.level2Desc')}</p>
          </div>
          <TypedConfirm
            keyword="LOCK"
            label={t('stm32.security.apply')}
            disabled={busy}
            onConfirm={() => void writeOptionByte('RDP', RDP_LEVEL_VALUES[2])}
          />
        </div>
      </div>
    </div>
  )
}
