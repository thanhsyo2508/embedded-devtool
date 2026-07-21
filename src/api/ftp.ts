import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface FtpEntry {
  name: string
  /** Full path, joined server-side (backend-side) from the listed directory
   * + name — see `FtpEntry::path`'s doc comment in `ftp/client.rs`. */
  path: string
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

export function ftpReadFile(id: string, path: string): Promise<number[]> {
  return invoke('ftp_read_file', { id, path })
}

export function ftpWriteFile(id: string, path: string, content: number[]): Promise<void> {
  return invoke('ftp_write_file', { id, path, content })
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

export interface FtpTransferProgressEvent {
  id: string
  operation: FtpTransferOperation
  transferred: number
  total: number
}

export function onFtpTransferProgress(
  cb: (event: FtpTransferProgressEvent) => void,
): Promise<UnlistenFn> {
  return listen<FtpTransferProgressEvent>('ftp://transferProgress', (event) => cb(event.payload))
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
