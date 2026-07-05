import { useState } from 'react'
import { useTabsStore, type TabState } from '../state/tabsStore'
import { FUNCTION_CODES, READ_FUNCTION_CODES, type ModbusFunctionCode } from '../lib/modbus'
import { PlusIcon, TrashIcon } from './icons'

const WRITE_MULTIPLE_CODES: ModbusFunctionCode[] = [0x0f, 0x10]
const READ_FUNCTION_CODE_OPTIONS = FUNCTION_CODES.filter((f) =>
  READ_FUNCTION_CODES.includes(f.value),
)

function quantityOrValueLabel(functionCode: ModbusFunctionCode): string {
  switch (functionCode) {
    case 0x05:
      return 'Coil value (0/1)'
    case 0x06:
      return 'Register value'
    default:
      return 'Quantity'
  }
}

function parseValues(text: string): number[] {
  return text
    .split(/[\s,]+/)
    .filter((s) => s.length > 0)
    .map((s) => Number(s))
    .filter((n) => !Number.isNaN(n))
}

export function ModbusMasterPanel({ tab }: { tab: TabState }) {
  const sendModbusRequest = useTabsStore((s) => s.sendModbusRequest)
  const clearLog = useTabsStore((s) => s.clearModbusMasterLog)
  const addPoll = useTabsStore((s) => s.addModbusPoll)
  const removePoll = useTabsStore((s) => s.removeModbusPoll)
  const updatePoll = useTabsStore((s) => s.updateModbusPoll)
  const togglePoll = useTabsStore((s) => s.toggleModbusPollEnabled)

  const [slaveAddr, setSlaveAddr] = useState(1)
  const [functionCode, setFunctionCode] = useState<ModbusFunctionCode>(0x03)
  const [startAddr, setStartAddr] = useState(0)
  const [quantityOrValue, setQuantityOrValue] = useState(1)
  const [valuesText, setValuesText] = useState('')
  const [timeoutMs, setTimeoutMs] = useState(1000)
  const [sending, setSending] = useState(false)

  const handleSend = async () => {
    if (sending) return
    setSending(true)
    const values = WRITE_MULTIPLE_CODES.includes(functionCode) ? parseValues(valuesText) : undefined
    await sendModbusRequest(
      tab.id,
      slaveAddr,
      functionCode,
      startAddr,
      quantityOrValue,
      values,
      timeoutMs,
    )
    setSending(false)
  }

  const disabledReason = tab.modbusSlave.enabled
    ? 'Disabled while the Modbus Slave emulator is listening on this tab'
    : undefined

  return (
    <div className="filter-bar">
      <div className="filter-row">
        <label className="field-group">
          <span className="field-caption">
            {tab.connectionKind === 'tcp-client' ? 'Unit ID' : 'Slave address'}
          </span>
          <input
            type="number"
            value={slaveAddr}
            onChange={(e) => setSlaveAddr(Number(e.target.value))}
          />
        </label>
        <label className="field-group">
          <span className="field-caption">Function</span>
          <select
            value={functionCode}
            onChange={(e) => setFunctionCode(Number(e.target.value) as ModbusFunctionCode)}
          >
            {FUNCTION_CODES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="filter-row">
        <label className="field-group">
          <span className="field-caption">Start address</span>
          <input
            type="number"
            value={startAddr}
            onChange={(e) => setStartAddr(Number(e.target.value))}
          />
        </label>
        <label className="field-group">
          <span className="field-caption">{quantityOrValueLabel(functionCode)}</span>
          <input
            type="number"
            value={quantityOrValue}
            onChange={(e) => setQuantityOrValue(Number(e.target.value))}
          />
        </label>
      </div>
      {WRITE_MULTIPLE_CODES.includes(functionCode) && (
        <label className="field-group">
          <span className="field-caption">
            Values ({functionCode === 0x0f ? '0/1 per coil' : 'per register'}, comma-separated)
          </span>
          <input
            type="text"
            value={valuesText}
            placeholder="1, 0, 1"
            onChange={(e) => setValuesText(e.target.value)}
          />
        </label>
      )}
      <div className="filter-row">
        <label className="field-group">
          <span className="field-caption">Timeout (ms)</span>
          <input
            type="number"
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="filter-actions">
        <button
          type="button"
          disabled={sending || tab.status !== 'open' || tab.modbusSlave.enabled}
          title={disabledReason}
          onClick={() => void handleSend()}
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Clear log"
          title="Clear log"
          onClick={() => clearLog(tab.id)}
        >
          <TrashIcon />
        </button>
      </div>
      <div className="modbus-log">
        {tab.modbusMasterLog.length === 0 && <p className="modbus-log-empty">No requests yet.</p>}
        {tab.modbusMasterLog
          .slice()
          .reverse()
          .map((entry, i) => (
            <div key={i} className={`modbus-log-entry modbus-log-${entry.kind}`}>
              <span className="modbus-log-time">{new Date(entry.atMs).toLocaleTimeString()}</span>
              <span>{entry.message}</span>
            </div>
          ))}
      </div>

      <h4>Poll rules</h4>
      {tab.modbusMasterPolls.map((rule) => (
        <div className="filter-row" key={rule.id}>
          <input
            type="checkbox"
            checked={rule.enabled}
            onChange={() => togglePoll(tab.id, rule.id)}
          />
          <input
            type="text"
            className="mono"
            value={rule.label}
            title="Label — also used as the plotter channel name"
            onChange={(e) => updatePoll(tab.id, rule.id, { label: e.target.value })}
          />
          <select
            value={rule.functionCode}
            onChange={(e) =>
              updatePoll(tab.id, rule.id, {
                functionCode: Number(e.target.value) as ModbusFunctionCode,
              })
            }
          >
            {READ_FUNCTION_CODE_OPTIONS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={rule.startAddr}
            title="Start address"
            onChange={(e) => updatePoll(tab.id, rule.id, { startAddr: Number(e.target.value) })}
          />
          <input
            type="number"
            value={rule.intervalMs}
            title="Interval (ms)"
            onChange={(e) => updatePoll(tab.id, rule.id, { intervalMs: Number(e.target.value) })}
          />
          <button
            type="button"
            className="icon-button"
            aria-label="Remove poll rule"
            onClick={() => removePoll(tab.id, rule.id)}
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      <div className="filter-actions">
        <button type="button" onClick={() => addPoll(tab.id)}>
          <PlusIcon /> Add poll rule
        </button>
      </div>
    </div>
  )
}
