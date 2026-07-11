import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTabsStore, type TabState } from '../state/tabsStore'
import { PlusIcon, TrashIcon } from './icons'

function RegisterTable({
  title,
  registers,
  onSet,
  onRemove,
}: {
  title: string
  registers: Record<number, number>
  onSet: (addr: number, value: number) => void
  onRemove: (addr: number) => void
}) {
  const { t } = useTranslation()
  const [newAddr, setNewAddr] = useState(0)
  const [newValue, setNewValue] = useState(0)

  const addresses = Object.keys(registers)
    .map(Number)
    .sort((a, b) => a - b)

  return (
    <div className="modbus-register-table">
      <h4>{title}</h4>
      {addresses.map((addr) => (
        <div className="filter-row" key={addr}>
          <span className="field-caption">{addr}</span>
          <input
            type="number"
            value={registers[addr]}
            onChange={(e) => onSet(addr, Number(e.target.value))}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={t('modbus.removeRegister')}
            title={t('modbus.removeRegister')}
            onClick={() => onRemove(addr)}
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      <div className="filter-row">
        <input
          type="number"
          value={newAddr}
          placeholder={t('modbus.address')}
          onChange={(e) => setNewAddr(Number(e.target.value))}
        />
        <input
          type="number"
          value={newValue}
          placeholder={t('modbus.value')}
          onChange={(e) => setNewValue(Number(e.target.value))}
        />
        <button type="button" onClick={() => onSet(newAddr, newValue)}>
          <PlusIcon /> {t('common.add')}
        </button>
      </div>
    </div>
  )
}

// The actual listening/responding logic runs centrally in tabsStore's
// event pipeline (handleModbusBytes), not here — this component is pure UI
// so the emulator keeps running in the background even while this flyout
// is closed, exactly like Filters/Triggers keep matching regardless of
// whether their panel is open.
export function ModbusSlavePanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const setEnabled = useTabsStore((s) => s.setModbusSlaveEnabled)
  const setAddress = useTabsStore((s) => s.setModbusSlaveAddress)
  const setRegister = useTabsStore((s) => s.setModbusRegister)
  const removeRegister = useTabsStore((s) => s.removeModbusRegister)
  const clearLog = useTabsStore((s) => s.clearModbusSlaveLog)

  const slave = tab.modbusSlave
  const pollingActive = tab.modbusMasterPolls.some((r) => r.enabled)

  return (
    <div className="filter-bar">
      <div className="filter-row">
        <label className="field-group">
          <span className="field-caption">{t('modbus.slaveAddress')}</span>
          <input
            type="number"
            value={slave.slaveAddr}
            onChange={(e) => setAddress(tab.id, Number(e.target.value))}
          />
        </label>
        <button
          type="button"
          className={slave.enabled ? 'on' : ''}
          onClick={() => setEnabled(tab.id, !slave.enabled)}
          disabled={tab.status !== 'open' || pollingActive}
          title={pollingActive ? t('modbus.disabledWhilePollingActive') : undefined}
        >
          {slave.enabled ? t('modbus.listening') : t('modbus.startListening')}
        </button>
      </div>

      <RegisterTable
        title={t('modbus.coils')}
        registers={slave.coils}
        onSet={(addr, value) => setRegister(tab.id, 'coils', addr, value ? 1 : 0)}
        onRemove={(addr) => removeRegister(tab.id, 'coils', addr)}
      />
      <RegisterTable
        title={t('modbus.discreteInputs')}
        registers={slave.discreteInputs}
        onSet={(addr, value) => setRegister(tab.id, 'discreteInputs', addr, value ? 1 : 0)}
        onRemove={(addr) => removeRegister(tab.id, 'discreteInputs', addr)}
      />
      <RegisterTable
        title={t('modbus.holdingRegisters')}
        registers={slave.holdingRegisters}
        onSet={(addr, value) => setRegister(tab.id, 'holdingRegisters', addr, value)}
        onRemove={(addr) => removeRegister(tab.id, 'holdingRegisters', addr)}
      />
      <RegisterTable
        title={t('modbus.inputRegisters')}
        registers={slave.inputRegisters}
        onSet={(addr, value) => setRegister(tab.id, 'inputRegisters', addr, value)}
        onRemove={(addr) => removeRegister(tab.id, 'inputRegisters', addr)}
      />

      <div className="filter-actions">
        <button
          type="button"
          className="icon-button"
          aria-label={t('modbus.clearLog')}
          onClick={() => clearLog(tab.id)}
        >
          <TrashIcon /> {t('modbus.clearLog')}
        </button>
      </div>
      <div className="modbus-log">
        {slave.log.length === 0 && <p className="modbus-log-empty">{t('modbus.noRequestsYet')}</p>}
        {slave.log
          .slice()
          .reverse()
          .map((entry, i) => (
            <div key={i} className={`modbus-log-entry modbus-log-${entry.kind}`}>
              <span className="modbus-log-time">{new Date(entry.atMs).toLocaleTimeString()}</span>
              <span>{entry.message}</span>
            </div>
          ))}
      </div>
    </div>
  )
}
