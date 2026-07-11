import { useTranslation } from 'react-i18next'
import { useTabsStore, type TabState } from '../state/tabsStore'
import { CircleIcon, PlayIcon, TrashIcon } from './icons'

export function MacroPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const startMacroRecording = useTabsStore((s) => s.startMacroRecording)
  const stopMacroRecording = useTabsStore((s) => s.stopMacroRecording)
  const playMacro = useTabsStore((s) => s.playMacro)
  const removeMacroStep = useTabsStore((s) => s.removeMacroStep)
  const updateMacroStepDelay = useTabsStore((s) => s.updateMacroStepDelay)
  const clearMacro = useTabsStore((s) => s.clearMacro)

  const handleClearMacro = () => {
    if (window.confirm(t('macro.clearConfirm', { count: tab.macroSteps.length }))) {
      clearMacro(tab.id)
    }
  }

  return (
    <div className="filter-bar">
      <div className="filter-actions">
        <button
          type="button"
          className={`macro-record ${tab.macroRecording ? 'on' : ''}`}
          onClick={() =>
            tab.macroRecording ? stopMacroRecording(tab.id) : startMacroRecording(tab.id)
          }
        >
          <CircleIcon /> {tab.macroRecording ? t('macro.recording') : t('macro.record')}
        </button>
        <button
          type="button"
          disabled={tab.macroSteps.length === 0 || tab.macroPlaying || tab.macroRecording}
          onClick={() => void playMacro(tab.id)}
        >
          <PlayIcon /> {tab.macroPlaying ? t('macro.playing') : t('macro.play')}
        </button>
      </div>
      {tab.macroSteps.length === 0 && (
        <div className="flash-log-empty">{t('macro.noStepsYet')}</div>
      )}
      {tab.macroSteps.map((step, i) => (
        <div className="filter-row" key={i}>
          <span className="mono macro-step-index">{i + 1}</span>
          <span className={`mode-tag ${step.isHex ? 'exclude' : 'include'}`}>
            {step.isHex ? t('send.hex') : t('send.text')}
          </span>
          <span className="mono macro-step-text">{step.text}</span>
          <label className="field-caption">{t('macro.delayMs')}</label>
          <input
            type="number"
            className="macro-delay"
            min={0}
            value={step.delayMs}
            onChange={(e) => updateMacroStepDelay(tab.id, i, Number(e.target.value))}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={t('macro.removeStep')}
            onClick={() => removeMacroStep(tab.id, i)}
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      {tab.macroSteps.length > 0 && (
        <div className="filter-actions">
          <button type="button" onClick={handleClearMacro}>
            {t('macro.clearMacro')}
          </button>
        </div>
      )}
    </div>
  )
}
