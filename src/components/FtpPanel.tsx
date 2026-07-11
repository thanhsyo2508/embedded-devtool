import { useEffect, useState } from 'react'
import { open, save } from '@tauri-apps/plugin-dialog'
import { useTranslation } from 'react-i18next'
import { useFtpStore } from '../state/ftpStore'
import type { FtpEntry } from '../api/ftp'
import {
  DownloadIcon,
  FolderIcon,
  PlugIcon,
  PlusIcon,
  RefreshIcon,
  ServerIcon,
  StopIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from './icons'

type Target = 'client' | 'server'

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function formatModified(ms: number): string {
  return ms === 0 ? '—' : new Date(ms).toLocaleString()
}

function localFileName(localPath: string): string {
  return localPath.split(/[\\/]/).pop() ?? localPath
}

/** FTP client file browser + local FTP server config, opened as one modal
 * with a client/server switcher (mirrors FlashPanel's ESP32/STM32/OTA
 * target switcher). Deliberately not a tab like Serial/TCP/SSH — FTP is a
 * stateful request/response file browser, not a byte stream, so it doesn't
 * fit the tabsStore/MonitorView machinery those connection kinds share. */
export function FtpPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const [target, setTarget] = useState<Target>('client')
  const {
    host,
    port,
    username,
    password,
    connected,
    connecting,
    connectError,
    currentPath,
    entries,
    listing,
    transferBusy,
    serverRootDir,
    serverPort,
    serverUsername,
    serverPassword,
    serverRunning,
    serverBusy,
    serverError,
    wireEventsOnce,
    setHost,
    setPort,
    setUsername,
    setPassword,
    connect,
    disconnect,
    refresh,
    openDir,
    goUp,
    mkdir,
    deleteEntry,
    download,
    upload,
    loadServerStatus,
    setServerRootDir,
    setServerPort,
    setServerUsername,
    setServerPassword,
    startServer,
    stopServer,
  } = useFtpStore()

  useEffect(() => {
    wireEventsOnce()
    void loadServerStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleUpload = async () => {
    const picked = await open({ multiple: false })
    if (typeof picked !== 'string') return
    await upload(picked, localFileName(picked))
  }

  const handleDownload = async (entry: FtpEntry) => {
    const path = await save({ defaultPath: entry.name })
    if (!path) return
    await download(entry, path)
  }

  const handleMkdir = async () => {
    const name = window.prompt(t('ftp.newFolderPrompt'))
    if (name) await mkdir(name)
  }

  const handleDelete = (entry: FtpEntry) => {
    if (window.confirm(t('ftp.deleteConfirm', { name: entry.name }))) {
      void deleteEntry(entry)
    }
  }

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

        <div className="seg">
          <span className={target === 'client' ? 'on' : ''} onClick={() => setTarget('client')}>
            {t('ftp.clientTab')}
          </span>
          <span className={target === 'server' ? 'on' : ''} onClick={() => setTarget('server')}>
            {t('ftp.serverTab')}
          </span>
        </div>

        {target === 'client' &&
          (!connected ? (
            <>
              <div className="field-grid">
                <label className="field-group">
                  <span className="field-caption">{t('connect.host')}</span>
                  <input
                    type="text"
                    value={host}
                    placeholder="192.168.1.50"
                    onChange={(e) => setHost(e.target.value)}
                  />
                </label>
                <label className="field-group">
                  <span className="field-caption">{t('connect.port')}</span>
                  <input
                    type="number"
                    value={port}
                    onChange={(e) => setPort(Number(e.target.value))}
                  />
                </label>
              </div>
              <div className="field-grid">
                <label className="field-group">
                  <span className="field-caption">{t('connect.username')}</span>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </label>
                <label className="field-group">
                  <span className="field-caption">{t('connect.password')}</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
              </div>
              {connectError && <p className="connect-error">{connectError}</p>}
              <div className="flash-actions">
                <button
                  type="button"
                  className="connect-button flash-go"
                  disabled={!host || connecting}
                  onClick={() => void connect()}
                >
                  <PlugIcon /> {connecting ? t('flash.working') : t('ftp.connect')}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="field-row">
                <span className="mono ftp-path">{currentPath}</span>
                <button
                  type="button"
                  className="icon-button"
                  title={t('common.refresh')}
                  onClick={() => void refresh()}
                >
                  <RefreshIcon />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title={t('ftp.newFolder')}
                  onClick={() => void handleMkdir()}
                >
                  <PlusIcon />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  title={t('ftp.upload')}
                  disabled={transferBusy}
                  onClick={() => void handleUpload()}
                >
                  <UploadIcon />
                </button>
                <button type="button" onClick={() => void disconnect()}>
                  {t('ftp.disconnect')}
                </button>
              </div>

              {connectError && <p className="connect-error">{connectError}</p>}

              <div className="netscan-table-wrap ftp-table-wrap">
                <table className="netscan-table ftp-table">
                  <thead>
                    <tr>
                      <th>{t('ftp.name')}</th>
                      <th>{t('ftp.size')}</th>
                      <th>{t('ftp.modified')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {currentPath !== '/' && (
                      <tr className="ftp-row" onDoubleClick={() => void goUp()}>
                        <td colSpan={4}>..</td>
                      </tr>
                    )}
                    {entries.length === 0 && !listing && (
                      <tr>
                        <td colSpan={4} className="netscan-empty">
                          {t('ftp.emptyDir')}
                        </td>
                      </tr>
                    )}
                    {entries.map((entry) => (
                      <tr
                        key={entry.name}
                        className="ftp-row"
                        onDoubleClick={() => entry.isDir && void openDir(entry.name)}
                      >
                        <td>
                          {entry.isDir && <FolderIcon />} {entry.name}
                        </td>
                        <td>{entry.isDir ? '—' : formatSize(entry.size)}</td>
                        <td>{formatModified(entry.modifiedMs)}</td>
                        <td className="ftp-row-actions">
                          {!entry.isDir && (
                            <button
                              type="button"
                              className="icon-button"
                              title={t('ftp.download')}
                              disabled={transferBusy}
                              onClick={() => void handleDownload(entry)}
                            >
                              <DownloadIcon />
                            </button>
                          )}
                          <button
                            type="button"
                            className="icon-button"
                            title={t('common.delete')}
                            onClick={() => handleDelete(entry)}
                          >
                            <TrashIcon />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ))}

        {target === 'server' && (
          <>
            <p className="ota-hint">{t('ftp.serverHint')}</p>
            <label className="field-group">
              <span className="field-caption">{t('ftp.rootDir')}</span>
              <div className="field-row">
                <input
                  className="flash-path"
                  value={serverRootDir}
                  placeholder={t('ftp.selectRootDir')}
                  readOnly
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
              <p className="ota-hint">{t('ftp.serverRunningHint', { port: serverPort })}</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
