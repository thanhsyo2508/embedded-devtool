import Editor from 'react-simple-code-editor'
import { highlight, languages } from 'prismjs'
import 'prismjs/components/prism-lua'
import { useTranslation } from 'react-i18next'
import { useTabsStore, type TabState } from '../state/tabsStore'
import { useScriptLibraryStore } from '../state/scriptLibraryStore'
import { PlayIcon, StopIcon, TrashIcon } from './icons'
import { LibraryRow } from './LibraryRow'

const PLACEHOLDER = `-- Lua API: on_data(line), send(text), send_hex(hex), wait_for(pattern, timeout_ms),
-- log(msg), alert(msg), plot(channel, value), timer(interval_ms, fn)
function on_data(line)
  if line:match("ERROR") then
    alert("Device reported an error: " .. line)
  end
end`

function formatConsoleTime(atMs: number): string {
  return new Date(atMs).toLocaleTimeString()
}

export function ScriptPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const setScriptCode = useTabsStore((s) => s.setScriptCode)
  const runScript = useTabsStore((s) => s.runScript)
  const stopScript = useTabsStore((s) => s.stopScript)
  const clearScriptConsole = useTabsStore((s) => s.clearScriptConsole)
  const scripts = useScriptLibraryStore((s) => s.items)
  const saveScript = useScriptLibraryStore((s) => s.save)
  const deleteScript = useScriptLibraryStore((s) => s.remove)

  return (
    <div className="script-panel">
      <div className="script-editor">
        <LibraryRow
          label={t('script.libraryLabel')}
          items={scripts}
          onLoad={(s) => setScriptCode(tab.id, s.code)}
          onSave={(name) => saveScript(name, { code: tab.scriptCode })}
          onDelete={deleteScript}
        />
        <Editor
          className="script-code-editor"
          style={{ overflow: 'auto' }}
          value={tab.scriptCode}
          onValueChange={(code) => setScriptCode(tab.id, code)}
          highlight={(code) => highlight(code, languages.lua, 'lua')}
          padding={10}
          tabSize={2}
          placeholder={PLACEHOLDER}
          disabled={tab.scriptRunning}
        />
        <div className="script-actions">
          <button
            type="button"
            className="connect-button"
            disabled={tab.scriptRunning || tab.scriptCode.trim().length === 0}
            onClick={() => void runScript(tab.id)}
          >
            <PlayIcon /> {t('script.run')}
          </button>
          <button
            type="button"
            disabled={!tab.scriptRunning}
            onClick={() => void stopScript(tab.id)}
          >
            <StopIcon /> {t('script.stop')}
          </button>
          {tab.scriptRunning && <span className="script-running-badge">{t('script.running')}</span>}
        </div>
      </div>
      <div className="script-console">
        <div className="script-console-header">
          <span>{t('script.console')}</span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('script.clearConsole')}
            onClick={() => clearScriptConsole(tab.id)}
          >
            <TrashIcon />
          </button>
        </div>
        <div className="script-console-body">
          {tab.scriptConsole.length === 0 && (
            <div className="flash-log-empty">{t('script.noOutputYet')}</div>
          )}
          {tab.scriptConsole.map((entry, i) => (
            <div key={i} className={`script-console-line script-${entry.kind}`}>
              <span className="mono">{formatConsoleTime(entry.atMs)}</span>
              <span>{entry.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
