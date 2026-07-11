import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface FtpEntry {
  name: string
  isDir: boolean
  size: number
  modifiedMs: number
}

export function ftpConnect(
  id: string,
  host: string,
  port: number,
  username: string,
  password: string,
): Promise<void> {
  return invoke('ftp_connect', { id, host, port, username, password })
}

export function ftpDisconnect(id: string): Promise<void> {
  return invoke('ftp_disconnect', { id })
}

export function ftpList(id: string, path: string): Promise<FtpEntry[]> {
  return invoke('ftp_list', { id, path })
}

export function ftpPwd(id: string): Promise<string> {
  return invoke('ftp_pwd', { id })
}

export function ftpCwd(id: string, path: string): Promise<void> {
  return invoke('ftp_cwd', { id, path })
}

export function ftpMkdir(id: string, path: string): Promise<void> {
  return invoke('ftp_mkdir', { id, path })
}

export function ftpRmdir(id: string, path: string): Promise<void> {
  return invoke('ftp_rmdir', { id, path })
}

export function ftpDelete(id: string, path: string): Promise<void> {
  return invoke('ftp_delete', { id, path })
}

export function ftpRename(id: string, from: string, to: string): Promise<void> {
  return invoke('ftp_rename', { id, from, to })
}

/** Runs on the backend's own thread; success/failure arrives via
 * onFtpTransferDone rather than this call's promise (matches the
 * flash/OTA "fire and wait for the done event" pattern). */
export function ftpDownload(id: string, remotePath: string, localPath: string): Promise<void> {
  return invoke('ftp_download', { id, remotePath, localPath })
}

export function ftpUpload(id: string, localPath: string, remotePath: string): Promise<void> {
  return invoke('ftp_upload', { id, localPath, remotePath })
}

export type FtpTransferOperation = 'download' | 'upload'

export interface FtpTransferDoneEvent {
  id: string
  operation: FtpTransferOperation
  success: boolean
  message: string
}

export function onFtpTransferDone(cb: (event: FtpTransferDoneEvent) => void): Promise<UnlistenFn> {
  return listen<FtpTransferDoneEvent>('ftp://transferDone', (event) => cb(event.payload))
}

export function ftpServerStart(
  rootDir: string,
  port: number,
  username?: string,
  password?: string,
): Promise<void> {
  return invoke('ftp_server_start', { rootDir, port, username, password })
}

export function ftpServerStop(): Promise<void> {
  return invoke('ftp_server_stop')
}

export function ftpServerIsRunning(): Promise<boolean> {
  return invoke('ftp_server_is_running')
}
