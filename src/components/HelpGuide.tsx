import { Trans, useTranslation } from 'react-i18next'
import { BookOpenIcon, XIcon } from './icons'

const SCRIPT_EXAMPLE = `function on_data(line)
  local temp = line:match("temp=(%d+%.%d+)")
  if temp then
    plot("temp", tonumber(temp))
  end
  if line:match("READY") then
    send("AT+INFO\\r\\n")
  end
end

-- runs every 5s regardless of incoming data
timer(5000, function()
  log("still connected")
end)`

const WAIT_FOR_EXAMPLE = `send("AT\\r\\n")
local reply = wait_for("OK", 2000)
if reply then
  log("got: " .. reply)
else
  alert("device did not reply within 2s")
end`

// Shared tag map for every <Trans> below — the translation strings in
// src/i18n/locales/*.json use these same tag names (<b>, <code>, <kbd>) so
// one map covers the whole guide instead of repeating it per call.
const G = { b: <b />, code: <code />, kbd: <kbd /> }

/** Opened from Settings — the detailed reference with worked examples for
 * every feature. The short (i) popovers next to each control are the
 * quick reminder; this is the "read the manual" version. */
export function HelpGuide({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="help-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">
            <BookOpenIcon /> {t('help.title')}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('help.closeAriaLabel')}
            onClick={onClose}
          >
            <XIcon />
          </button>
        </div>

        <div className="help-body">
          <section className="guide-section">
            <h3>{t('help.layout.heading')}</h3>
            <p>
              <Trans i18nKey="help.layout.p1" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.layout.p2" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.layout.p3" components={G} />
            </p>
          </section>

          <section className="guide-section">
            <h3>{t('help.monitor.heading')}</h3>
            <p>
              <Trans i18nKey="help.monitor.intro" components={G} />
            </p>
            <ul>
              <li>
                <Trans i18nKey="help.monitor.li1" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.monitor.li2" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.monitor.li3" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.monitor.li4" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.monitor.li5" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.monitor.li6" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.monitor.li7" components={G} />
              </li>
            </ul>
            <p>
              <Trans i18nKey="help.monitor.autoReconnect" components={G} />
            </p>
          </section>

          <section className="guide-section">
            <h3>{t('help.network.heading')}</h3>
            <p>
              <Trans i18nKey="help.network.intro" components={G} />
            </p>
            <ul>
              <li>
                <Trans i18nKey="help.network.tcpClient" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.network.tcpServer" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.network.udp" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.network.ws" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.network.mqtt" components={G} />
              </li>
            </ul>
            <p>
              <Trans i18nKey="help.network.mqttExample" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.network.findingDevices" components={G} />
            </p>
          </section>

          <section className="guide-section">
            <h3>{t('help.ssh.heading')}</h3>
            <p>
              <Trans i18nKey="help.ssh.p1" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.ssh.p2" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.ssh.p3" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.ssh.p4" components={G} />
            </p>
          </section>

          <section className="guide-section">
            <h3>{t('help.modbus.heading')}</h3>
            <p>
              <Trans i18nKey="help.modbus.rs485" components={G} />
            </p>
            <p>{t('help.modbus.toolsIntro')}</p>
            <ul>
              <li>
                <Trans i18nKey="help.modbus.master" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.modbus.slave" components={G} />
              </li>
            </ul>
            <p>
              <Trans i18nKey="help.modbus.example" components={G} />
            </p>
          </section>

          <section className="guide-section">
            <h3>{t('help.presets.heading')}</h3>
            <p>
              <Trans i18nKey="help.presets.p1" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.presets.p2" components={G} />
            </p>
          </section>

          <section className="guide-section">
            <h3>{t('help.projectProfiles.heading')}</h3>
            <p>
              <Trans i18nKey="help.projectProfiles.p1" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.projectProfiles.p2" components={G} />
            </p>
          </section>

          <section className="guide-section">
            <h3>{t('help.search.heading')}</h3>
            <p>
              <Trans i18nKey="help.search.p1" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.search.p2" components={G} />
            </p>
          </section>

          <section className="guide-section">
            <h3>{t('help.sendMacro.heading')}</h3>
            <p>
              <Trans i18nKey="help.sendMacro.p1" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.sendMacro.p2" components={G} />
            </p>
            <p>{t('help.sendMacro.p3')}</p>
            <p>
              <b>
                <Trans i18nKey="help.sendMacro.exampleLabel" components={G} />
              </b>
            </p>
            <ol>
              <li>
                <Trans i18nKey="help.sendMacro.step1" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.sendMacro.step2" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.sendMacro.step3" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.sendMacro.step4" components={G} />
              </li>
            </ol>
          </section>

          <section className="guide-section">
            <h3>{t('help.quickCommands.heading')}</h3>
            <p>{t('help.quickCommands.p1')}</p>
            <p>
              <Trans i18nKey="help.quickCommands.p2" components={G} />
            </p>
            <ul>
              <li>
                <Trans i18nKey="help.quickCommands.li1" components={G} />
              </li>
              <li>{t('help.quickCommands.li2')}</li>
              <li>{t('help.quickCommands.li3')}</li>
            </ul>
          </section>

          <section className="guide-section">
            <h3>{t('help.filters.heading')}</h3>
            <p>
              <Trans i18nKey="help.filters.p1" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.filters.example" components={G} />
            </p>
          </section>

          <section className="guide-section">
            <h3>{t('help.triggers.heading')}</h3>
            <p>
              <Trans i18nKey="help.triggers.p1" components={G} />
            </p>
            <ul>
              <li>
                <Trans i18nKey="help.triggers.li1" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.triggers.li2" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.triggers.li3" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.triggers.li4" components={G} />
              </li>
            </ul>
          </section>

          <section className="guide-section">
            <h3>{t('help.script.heading')}</h3>
            <p>
              <Trans i18nKey="help.script.intro" components={G} />
            </p>
            <ul>
              <li>
                <Trans i18nKey="help.script.li1" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.script.li2" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.script.li3" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.script.li4" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.script.li5" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.script.li6" components={G} />
              </li>
            </ul>
            <p>
              <b>
                <Trans i18nKey="help.script.example1Label" components={G} />
              </b>
            </p>
            <pre className="guide-code">{SCRIPT_EXAMPLE}</pre>
            <p>
              <b>
                <Trans i18nKey="help.script.example2Label" components={G} />
              </b>
            </p>
            <pre className="guide-code">{WAIT_FOR_EXAMPLE}</pre>
            <p>
              <Trans i18nKey="help.script.sandboxNote" components={G} />
            </p>
          </section>

          <section className="guide-section">
            <h3>{t('help.plotter.heading')}</h3>
            <p>
              <Trans i18nKey="help.plotter.p1" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.plotter.p2" components={G} />
            </p>
            <p>{t('help.plotter.toolsIntro')}</p>
            <ul>
              <li>
                <Trans i18nKey="help.plotter.math" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.plotter.levels" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.plotter.stats" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.plotter.fft" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.plotter.csvPng" components={G} />
              </li>
            </ul>
          </section>

          <section className="guide-section">
            <h3>{t('help.flashEsp32.heading')}</h3>
            <ol>
              <li>
                <Trans i18nKey="help.flashEsp32.step1" components={G} />
              </li>
              <li>{t('help.flashEsp32.step2')}</li>
              <li>
                <Trans i18nKey="help.flashEsp32.step3" components={G} />
              </li>
              <li>{t('help.flashEsp32.step4')}</li>
            </ol>
            <p>
              <Trans i18nKey="help.flashEsp32.smartAdd" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.flashEsp32.batch" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.flashEsp32.autoFlash" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.flashEsp32.provision" components={G} />
            </p>
          </section>

          <section className="guide-section">
            <h3>{t('help.ota.heading')}</h3>
            <p>
              <Trans i18nKey="help.ota.p1" components={G} />
            </p>
            <p>
              <Trans i18nKey="help.ota.p2" components={G} />
            </p>
            <p>{t('help.ota.toastNote')}</p>
          </section>

          <section className="guide-section">
            <h3>{t('help.flashStm32.heading')}</h3>
            <p>{t('help.flashStm32.intro')}</p>
            <ul>
              <li>
                <Trans i18nKey="help.flashStm32.stLink" components={G} />
              </li>
              <li>
                <Trans i18nKey="help.flashStm32.uart" components={G} />
              </li>
            </ul>
            <p>{t('help.flashStm32.optionBytes')}</p>
          </section>
        </div>
      </div>
    </div>
  )
}
