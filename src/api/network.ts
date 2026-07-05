import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { SerialDataBatch } from './serial'

export function openTcpClient(id: string, host: string, port: number): Promise<void> {
  return invoke('open_tcp_client', { id, host, port })
}

export function openTcpServer(id: string, port: number): Promise<void> {
  return invoke('open_tcp_server', { id, port })
}

export function openUdp(
  id: string,
  localPort: number,
  remoteHost?: string,
  remotePort?: number,
): Promise<void> {
  return invoke('open_udp', { id, localPort, remoteHost, remotePort })
}

export function openWsClient(id: string, url: string): Promise<void> {
  return invoke('open_ws_client', { id, url })
}

export function openWsServer(id: string, port: number): Promise<void> {
  return invoke('open_ws_server', { id, port })
}

export interface MqttParams {
  brokerHost: string
  brokerPort: number
  clientId: string
  username?: string
  password?: string
  subscribeTopic: string
  publishTopic: string
}

export function openMqtt(id: string, params: MqttParams): Promise<void> {
  return invoke('open_mqtt', {
    id,
    brokerHost: params.brokerHost,
    brokerPort: params.brokerPort,
    clientId: params.clientId,
    username: params.username,
    password: params.password,
    subscribeTopic: params.subscribeTopic,
    publishTopic: params.publishTopic,
  })
}

export function closeNetworkStream(id: string): Promise<void> {
  return invoke('close_network_stream', { id })
}

export function writeNetworkStream(id: string, data: number[]): Promise<void> {
  return invoke('write_network_stream', { id, data })
}

// Lifecycle (open/close/error) rides the existing onSerialLifecycle listener
// — that event is transport-agnostic despite its name, see lib.rs.
export function onNetworkData(cb: (batch: SerialDataBatch) => void): Promise<UnlistenFn> {
  return listen<SerialDataBatch>('network://data', (event) => cb(event.payload))
}

export interface MdnsService {
  fullname: string
  hostname: string
  port: number
  addresses: string[]
}

/** Blocks for ~timeoutMs while the backend browses the LAN — callers should
 * show a scanning indicator. */
export function mdnsScan(serviceType: string, timeoutMs: number): Promise<MdnsService[]> {
  return invoke('mdns_scan', { serviceType, timeoutMs })
}
