import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { onUsbPlugged, type PortInfo } from '../api/serial'
import type { LineEnding } from '../state/tabsStore'
import { useProvisionStore, type ProvisionDevice } from '../state/provisionStore'
import { useTabsStore } from '../state/tabsStore'
import { isLikelyEsp32Vid } from '../lib/esp32VidPid'
import { PlusIcon, TrashIcon, ZapIcon } from './icons'

const BAUD_OPTIONS = [9_600, 57_600, 115_200, 230_400, 460_800, 921_600]

/** Serial-command provisioning: a short scripted sequence of writes (send
 * WiFi creds, set a device ID, whatever a device's own firmware expects
 * over its command line) run automatically when a matching device is
 * plugged in — independent of ESP32 flashing, since it just writes to an
 * already-flashed device's serial port. Rendered inline in FlashPanel's
 * ESP32 tab as a third Single/Batch/Provision mode. */
export function ProvisionPanel({ ports }: { ports: PortInfo[] }) {
  const { t } = useTranslation()
  const steps = useProvisionStore((s) => s.steps)
  const baudRate = useProvisionStore((s) => s.baudRate)
  const armed = useProvisionStore((s) => s.armed)
  const devices = useProvisionStore((s) => s.devices)
  const wireEventsOnce = useProvisionStore((s) => s.wireEventsOnce)
  const addStep = useProvisionStore((s) => s.addStep)
  const removeStep = useProvisionStore((s) => s.removeStep)
  const updateStep = useProvisionStore((s) => s.updateStep)
  const setBaudRate = useProvisionStore((s) => s.setBaudRate)
  const setArmed = useProvisionStore((s) => s.setArmed)
  const runOnDevice = useProvisionStore((s) => s.runOnDevice)
  const [manualPort, setManualPort] = useState('')

  useEffect(() => {
    wireEventsOnce()
  }, [wireEventsOnce])

  // Same auto-on-plug wiring as FlashBatchPanel's auto-flash: only while
  // armed, skip a port already open in another tab (writing to it would
  // race whatever that tab is doing).
  useEffect(() => {
    if (!armed) return
    const unlisten = onUsbPlugged((event) => {
      if (!isLikelyEsp32Vid(event.vid)) return
      const portOpenElsewhere = useTabsStore
        .getState()
        .tabs.some((t) => t.portName === event.portName && t.status === 'open')
      if (portOpenElsewhere) return
      runOnDevice(event.portName)
    })
    return () => {
      void unlisten.then((f) => f())
    }
  }, [armed, runOnDevice])

  const statusLabel = (device: ProvisionDevice) => {
    if (device.status === 'running')
      return t('provision.statusRunning', { step: device.stepIndex + 1, total: steps.length })
    if (device.status === 'done') return t('provision.statusDone')
    if (device.status === 'error') return t('provision.statusError')
    return t('provision.statusIdle')
  }

  return (
    <div className="provision-panel">
      <label className="flash-batch-autoflash">
        <input type="checkbox" checked={armed} onChange={(e) => setArmed(e.target.checked)} />
        {t('provision.autoRunLabel')}
      </label>

      <div className="field-row">
        <span className="field-caption">{t('connect.baud')}</span>
        <select value={baudRate} onChange={(e) => setBaudRate(Number(e.target.value))}>
          {BAUD_OPTIONS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>

      <div className="provision-steps">
        {steps.map((step, i) => (
          <div className="provision-step-row" key={step.id}>
            <span className="provision-step-index">{i + 1}</span>
            <input
              className="provision-step-payload"
              value={step.payload}
              placeholder={t('provision.payloadPlaceholder')}
              onChange={(e) => updateStep(step.id, { payload: e.target.value })}
            />
            <select
              value={step.lineEnding}
              onChange={(e) => updateStep(step.id, { lineEnding: e.target.value as LineEnding })}
            >
              <option value="none">{t('common.none')}</option>
              <option value="cr">CR</option>
              <option value="lf">LF</option>
              <option value="crlf">CRLF</option>
            </select>
            <label className="provision-step-wait">
              <input
                type="checkbox"
                checked={step.waitForResponse}
                onChange={(e) => updateStep(step.id, { waitForResponse: e.target.checked })}
              />
              {t('provision.wait')}
            </label>
            {step.waitForResponse ? (
              <>
                <input
                  className="provision-step-match"
                  value={step.responseMatch}
                  placeholder={t('provision.matchPlaceholder')}
                  onChange={(e) => updateStep(step.id, { responseMatch: e.target.value })}
                />
                <input
                  type="number"
                  className="provision-step-ms"
                  value={step.timeoutMs}
                  min={0}
                  title={t('provision.timeoutTitle')}
                  onChange={(e) => updateStep(step.id, { timeoutMs: Number(e.target.value) })}
                />
              </>
            ) : (
              <input
                type="number"
                className="provision-step-ms"
                value={step.delayMs}
                min={0}
                title={t('provision.delayTitle')}
                onChange={(e) => updateStep(step.id, { delayMs: Number(e.target.value) })}
              />
            )}
            <button
              type="button"
              className="icon-button"
              aria-label={t('provision.removeStep')}
              title={t('common.remove')}
              onClick={() => removeStep(step.id)}
            >
              <TrashIcon />
            </button>
          </div>
        ))}
        <button type="button" className="flash-add-segment" onClick={addStep}>
          <PlusIcon /> {t('provision.addStep')}
        </button>
      </div>

      <div className="provision-run-now">
        <select value={manualPort} onChange={(e) => setManualPort(e.target.value)}>
          <option value="">{t('flash.selectPort')}</option>
          {ports.map((p) => (
            <option key={p.portName} value={p.portName}>
              {p.portName}
              {p.product ? ` — ${p.product}` : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="connect-button"
          disabled={!manualPort || steps.length === 0}
          onClick={() => runOnDevice(manualPort)}
        >
          <ZapIcon /> {t('provision.runNow')}
        </button>
      </div>

      <div className="provision-devices">
        {devices.length === 0 && (
          <div className="flash-log-empty">{t('provision.noDevicesYet')}</div>
        )}
        {devices.map((d) => (
          <div key={d.portName} className="provision-device-row">
            <span className="flash-batch-port">{d.portName}</span>
            <span className={`flash-batch-status status-${d.status}`}>{statusLabel(d)}</span>
            <span className="provision-device-log">{d.log[d.log.length - 1] ?? ''}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
