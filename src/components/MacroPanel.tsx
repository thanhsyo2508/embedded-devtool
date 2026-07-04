import { useTabsStore, type TabState } from '../state/tabsStore'
import { CircleIcon, PlayIcon, TrashIcon } from './icons'

export function MacroPanel({ tab }: { tab: TabState }) {
  const startMacroRecording = useTabsStore((s) => s.startMacroRecording)
  const stopMacroRecording = useTabsStore((s) => s.stopMacroRecording)
  const playMacro = useTabsStore((s) => s.playMacro)
  const removeMacroStep = useTabsStore((s) => s.removeMacroStep)
  const updateMacroStepDelay = useTabsStore((s) => s.updateMacroStepDelay)
  const clearMacro = useTabsStore((s) => s.clearMacro)

  const handleClearMacro = () => {
    if (window.confirm(`Clear all ${tab.macroSteps.length} recorded step(s)?`)) {
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
          <CircleIcon /> {tab.macroRecording ? 'Recording…' : 'Record'}
        </button>
        <button
          type="button"
          disabled={tab.macroSteps.length === 0 || tab.macroPlaying || tab.macroRecording}
          onClick={() => void playMacro(tab.id)}
        >
          <PlayIcon /> {tab.macroPlaying ? 'Playing…' : 'Play'}
        </button>
      </div>
      {tab.macroSteps.length === 0 && (
        <div className="flash-log-empty">
          No steps recorded yet — click Record, then send commands normally.
        </div>
      )}
      {tab.macroSteps.map((step, i) => (
        <div className="filter-row" key={i}>
          <span className="mono macro-step-index">{i + 1}</span>
          <span className={`mode-tag ${step.isHex ? 'exclude' : 'include'}`}>
            {step.isHex ? 'hex' : 'text'}
          </span>
          <span className="mono macro-step-text">{step.text}</span>
          <label className="field-caption">delay (ms)</label>
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
            aria-label="Remove step"
            onClick={() => removeMacroStep(tab.id, i)}
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      {tab.macroSteps.length > 0 && (
        <div className="filter-actions">
          <button type="button" onClick={handleClearMacro}>
            Clear macro
          </button>
        </div>
      )}
    </div>
  )
}
