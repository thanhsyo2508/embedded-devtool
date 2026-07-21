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

/** A real interactive PTY shell — unlike every other open_* here, this
 * tab's data isn't line-oriented text, it's raw terminal bytes (including
 * ANSI escapes) meant for a real terminal emulator (xterm.js), not the
 * generic monitor. */
/** `privateKeyPath` (non-empty) selects key-based auth over `password`. */
export function openSsh(
  id: string,
  host: string,
  port: number,
  username: string,
  password: string,
  privateKeyPath?: string,
  passphrase?: string,
): Promise<void> {
  return invoke('open_ssh', {
    id,
    host,
    port,
    username,
    password,
    privateKeyPath,
    passphrase,
  })
}

/** Escape hatch for a `core::known_hosts` mismatch refusal — clears the
 * previously-trusted fingerprint for this host:port so the next connection
 * is trusted fresh, for the legitimate "server was reinstalled" case. */
export function forgetKnownHost(host: string, port: number): Promise<void> {
  return invoke('forget_known_host', { host, port })
}

/** Tells the remote PTY the terminal was resized. */
export function sshResize(id: string, cols: number, rows: number): Promise<void> {
  return invoke('ssh_resize', { id, cols, rows })
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

export interface SwdProbeInfo {
  identifier: string
  vendorId: number
  productId: number
  serialNumber: string | null
}

/** Attaches to a debug probe over SWD and streams RTT channel 0 as a
 * normal Monitor tab — see core::rtt_stream. `probeSerial` picks a
 * specific attached probe; omit it to use whichever `listSwdProbes`
 * returns first. */
export function openRtt(id: string, probeSerial: string | undefined, chip: string): Promise<void> {
  return invoke('open_rtt', { id, probeSerial, chip })
}

export function listSwdProbes(): Promise<SwdProbeInfo[]> {
  return invoke('list_swd_probes')
}

/** Prefix-searches probe-rs's built-in chip database — lets the Connect
 * panel offer suggestions instead of requiring the exact probe-rs target
 * string up front (e.g. "STM32F407VG" already matches "STM32F407VGTx"). */
export function searchSwdChips(query: string): Promise<string[]> {
  return invoke('search_swd_chips', { query })
}

export interface ElfVariable {
  name: string
  address: number
  size: number
  typeHint: string
}

/** Lists global/static variables declared in an ELF's DWARF info — only
 * these are watchable without halting the core (see swd::variables for
 * why local/stack variables aren't listed here). */
export function listElfVariables(path: string): Promise<ElfVariable[]> {
  return invoke('list_elf_variables', { path })
}

/** Starts polling one variable's live value on an open RTT tab — values
 * stream back via onSwdVariable. Only valid for a tab opened with
 * openRtt. */
export function rttWatchVariable(
  id: string,
  name: string,
  address: number,
  size: number,
): Promise<void> {
  return invoke('rtt_watch_variable', { id, name, address, size })
}

export function rttUnwatchVariable(id: string, name: string): Promise<void> {
  return invoke('rtt_unwatch_variable', { id, name })
}

export interface SwdVariableEvent {
  id: string
  name: string
  bytes: number[]
}

export function onSwdVariable(cb: (event: SwdVariableEvent) => void): Promise<UnlistenFn> {
  return listen<SwdVariableEvent>('swd://variable', (event) => cb(event.payload))
}

export function closeNetworkStream(id: string): Promise<void> {
  return invoke('close_network_stream', { id })
}

export function writeNetworkStream(id: string, data: number[]): Promise<void> {
  return invoke('write_network_stream', { id, data })
}

/** Publishes to an arbitrary topic with explicit QoS/retain — unlike
 * writeNetworkStream, not limited to the one publish topic set at connect
 * time. Only valid for a tab opened with openMqtt. */
export function mqttPublish(
  id: string,
  topic: string,
  payload: number[],
  qos: number,
  retain: boolean,
): Promise<void> {
  return invoke('mqtt_publish', { id, topic, payload, qos, retain })
}

export interface MqttMessageEvent {
  id: string
  topic: string
  payload: number[]
  qos: number
  retain: boolean
}

export function onMqttMessage(cb: (event: MqttMessageEvent) => void): Promise<UnlistenFn> {
  return listen<MqttMessageEvent>('mqtt://message', (event) => cb(event.payload))
}

/** Adds a subscription beyond the one topic set at connect time. */
export function mqttSubscribe(id: string, topic: string, qos: number): Promise<void> {
  return invoke('mqtt_subscribe', { id, topic, qos })
}

export function mqttUnsubscribe(id: string, topic: string): Promise<void> {
  return invoke('mqtt_unsubscribe', { id, topic })
}

/** One UDP datagram, tagged with its sender address — unlike network://data,
 * this doesn't lose the packet boundary or who sent it. Only fires for tabs
 * opened with openUdp. */
export interface UdpDatagramEvent {
  id: string
  from: string
  data: number[]
}

export function onUdpDatagram(cb: (event: UdpDatagramEvent) => void): Promise<UnlistenFn> {
  return listen<UdpDatagramEvent>('udp://datagram', (event) => cb(event.payload))
}

export type WsFrameKind = 'text' | 'binary'

/** One WebSocket message, tagged with its frame kind — unlike network://data,
 * this doesn't flatten Text/Binary into the same byte stream. Only fires for
 * tabs opened with openWsClient/openWsServer. */
export interface WsFrameEvent {
  id: string
  kind: WsFrameKind
  data: number[]
}

export function onWsFrame(cb: (event: WsFrameEvent) => void): Promise<UnlistenFn> {
  return listen<WsFrameEvent>('ws://frame', (event) => cb(event.payload))
}

/** Sends a WebSocket Text frame — unlike writeNetworkStream (always sends
 * Binary), this preserves the frame kind for peers that distinguish them. */
export function wsSendText(id: string, text: string): Promise<void> {
  return invoke('ws_send_text', { id, text })
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

/** Best-effort default for the scan CIDR field — the subnet the OS would
 * route through, not necessarily "the" LAN if there are multiple interfaces. */
export function detectLocalSubnet(): Promise<string> {
  return invoke('detect_local_subnet')
}

/** This machine's own LAN-facing IPv4 address — same best-effort/single-NIC
 * caveat as detectLocalSubnet. Used to show "connect to ftp://<addr>:<port>"
 * next to the local FTP server instead of making the user go find it via
 * ipconfig/ifconfig themselves. */
export function localIpAddress(): Promise<string> {
  return invoke('local_ip_address')
}

export function commonScanPorts(): Promise<[number, string][]> {
  return invoke('common_scan_ports')
}

export interface PortHit {
  ip: string
  port: number
  service: string
}

export interface NetScanHitEvent extends PortHit {
  id: string
}

export interface NetScanDoneEvent {
  id: string
  hostsScanned: number
}

/** Starts a background scan; results stream in via onNetScanHit rather than
 * being returned here — a full /24 can take a few seconds. */
export function startNetworkScan(
  id: string,
  cidr: string,
  ports: number[],
  timeoutMs: number,
): Promise<void> {
  return invoke('start_network_scan', { id, cidr, ports, timeoutMs })
}

export function onNetScanHit(cb: (event: NetScanHitEvent) => void): Promise<UnlistenFn> {
  return listen<NetScanHitEvent>('netscan://hit', (event) => cb(event.payload))
}

export function onNetScanDone(cb: (event: NetScanDoneEvent) => void): Promise<UnlistenFn> {
  return listen<NetScanDoneEvent>('netscan://done', (event) => cb(event.payload))
}

export interface NetScanHostEvent {
  id: string
  ip: string
  mac: string | null
  name: string | null
}

export function onNetScanHost(cb: (event: NetScanHostEvent) => void): Promise<UnlistenFn> {
  return listen<NetScanHostEvent>('netscan://host', (event) => cb(event.payload))
}

/** Deep-scans a single IP over a custom port range — separate from
 * startNetworkScan so the UI can offer it per-row without re-sweeping the
 * whole subnet. Results stream through the same onNetScanHit/onNetScanDone
 * listeners, correlated by `id`. */
export function startDeepScan(
  id: string,
  ip: string,
  portFrom: number,
  portTo: number,
  timeoutMs: number,
): Promise<void> {
  return invoke('start_deep_scan', { id, ip, portFrom, portTo, timeoutMs })
}
