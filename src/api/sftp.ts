import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export interface SftpEntry {
  name: string
  path: string
  isDir: boolean
  isSymlink: boolean
  size: number
  modifiedMs: number
}

export function sftpConnect(
  id: string,
  host: string,
  port: number,
  username: string,
  password: string,
): Promise<void> {
  return invoke('sftp_connect', { id, host, port, username, password })
}

export function sftpDisconnect(id: string): Promise<void> {
  return invoke('sftp_disconnect', { id })
}

export function sftpList(id: string, path: string): Promise<SftpEntry[]> {
  return invoke('sftp_list', { id, path })
}

export function sftpReadFile(id: string, path: string): Promise<number[]> {
  return invoke('sftp_read_file', { id, path })
}

export function sftpWriteFile(id: string, path: string, content: number[]): Promise<void> {
  return invoke('sftp_write_file', { id, path, content })
}

export function sftpMkdir(id: string, path: string): Promise<void> {
  return invoke('sftp_mkdir', { id, path })
}

export function sftpRmdir(id: string, path: string): Promise<void> {
  return invoke('sftp_rmdir', { id, path })
}

export function sftpDelete(id: string, path: string): Promise<void> {
  return invoke('sftp_delete', { id, path })
}

export function sftpRename(id: string, from: string, to: string): Promise<void> {
  return invoke('sftp_rename', { id, from, to })
}

/** Runs on the backend's own async task; success/failure arrives via
 * onSftpTransferDone rather than this call's promise (matches FTP's
 * "fire and wait for the done event" pattern). */
export function sftpDownload(id: string, remotePath: string, localPath: string): Promise<void> {
  return invoke('sftp_download', { id, remotePath, localPath })
}

export function sftpUpload(id: string, localPath: string, remotePath: string): Promise<void> {
  return invoke('sftp_upload', { id, localPath, remotePath })
}

export type SftpTransferOperation = 'download' | 'upload'

export interface SftpTransferDoneEvent {
  id: string
  operation: SftpTransferOperation
  success: boolean
  message: string
}

export function onSftpTransferDone(
  cb: (event: SftpTransferDoneEvent) => void,
): Promise<UnlistenFn> {
  return listen<SftpTransferDoneEvent>('sftp://transferDone', (event) => cb(event.payload))
}
