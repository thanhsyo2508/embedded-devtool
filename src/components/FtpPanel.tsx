import { useEffect } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { useTranslation } from 'react-i18next'
import { useFtpStore } from '../state/ftpStore'
import { CopyButton } from './CopyButton'
import { FolderIcon, ServerIcon, StopIcon, XIcon } from './icons'

/** Local FTP server config — hosts a plain-FTP server on this computer so a
 * device can read/write files here. File *browsing* of a remote FTP server
 * used to live in this same modal as a "Client" tab, but that's now the
 * tab-based FTP workspace (ConnectPanel's "FTP" family, mirroring SSH's own
 * tab) instead — see FtpWorkspacePanel. This modal is server-hosting only. */
export function FtpPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const {
    serverRootDir,
    serverPort,
    serverUsername,
    serverPassword,
    serverRunning,
    serverBusy,
    serverError,
    serverAddress,
    loadServerStatus,
    setServerRootDir,
    setServerPort,
    setServerUsername,
    setServerPassword,
    startServer,
    stopServer,
  } = useFtpStore()

  useEffect(() => {
    void loadServerStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleServerBrowse = async () => {
    const picked = await open({ directory: true })
    if (typeof picked === 'string') setServerRootDir(picked)
  }

  return (
    <div className="settings-overlay netscan-overlay" onClick={onClose}>
      <div className="netscan-panel ftp-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <span className="settings-title">
            <ServerIcon /> {t('ftp.title')}
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label={t('common.close')}
            onClick={onClose}
          >
            <XIcon />
          </button>
        </div>

        <p className="ota-hint">{t('ftp.serverHint')}</p>
        <label className="field-group">
          <span className="field-caption">{t('ftp.rootDir')}</span>
          <div className="field-row">
            <input
              className="flash-path"
              value={serverRootDir}
              placeholder={t('ftp.selectRootDir')}
              disabled={serverRunning}
              onChange={(e) => setServerRootDir(e.target.value)}
            />
            <button
              type="button"
              className="icon-button"
              title={t('common.browse')}
              disabled={serverRunning}
              onClick={() => void handleServerBrowse()}
            >
              <FolderIcon />
            </button>
          </div>
        </label>
        <div className="field-grid">
          <label className="field-group">
            <span className="field-caption">{t('connect.port')}</span>
            <input
              type="number"
              value={serverPort}
              disabled={serverRunning}
              onChange={(e) => setServerPort(Number(e.target.value))}
            />
          </label>
        </div>
        <div className="field-grid">
          <label className="field-group">
            <span className="field-caption">{t('ftp.serverUsername')}</span>
            <input
              type="text"
              value={serverUsername}
              disabled={serverRunning}
              onChange={(e) => setServerUsername(e.target.value)}
            />
          </label>
          <label className="field-group">
            <span className="field-caption">{t('connect.password')}</span>
            <input
              type="password"
              value={serverPassword}
              disabled={serverRunning || !serverUsername}
              onChange={(e) => setServerPassword(e.target.value)}
            />
          </label>
        </div>
        {serverError && <p className="connect-error">{serverError}</p>}
        <div className="flash-actions">
          {!serverRunning ? (
            <button
              type="button"
              className="connect-button flash-go"
              disabled={!serverRootDir || serverBusy}
              onClick={() => void startServer()}
            >
              <ServerIcon /> {serverBusy ? t('flash.working') : t('ftp.startServer')}
            </button>
          ) : (
            <button
              type="button"
              className="connect-button flash-go"
              onClick={() => void stopServer()}
            >
              <StopIcon /> {t('ftp.stopServer')}
            </button>
          )}
        </div>
        {serverRunning && (
          <>
            <p className="ota-hint">{t('ftp.serverRunningHint', { port: serverPort })}</p>
            {serverAddress && (
              <div className="field-row">
                <span className="mono">{`ftp://${serverAddress}:${serverPort}`}</span>
                <CopyButton
                  getText={() => `ftp://${serverAddress}:${serverPort}`}
                  writeText={writeText}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
