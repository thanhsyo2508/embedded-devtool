import { describe, expect, it } from 'vitest'
import { buildProjectProfile, connectionConfigToOpenRequest } from './projectProfile'
import { makePane } from './layoutTree'
import type { ConnectionConfig, TabState } from '../state/tabsStore'

function makeTab(
  overrides: Partial<TabState> & { id: string; connectionConfig: ConnectionConfig },
): TabState {
  return {
    connectionKind: overrides.connectionConfig.kind,
    connectionLabel: 'test',
    portName: '',
    baudRate: 0,
    status: 'open',
    lines: [],
    pendingBytes: [],
    pendingAtMs: null,
    firstLineAtMs: null,
    nextSeq: 0,
    viewMode: 'ascii',
    timestampMode: 'off',
    lineEnding: 'crlf',
    checksumMode: 'none',
    sendHistory: [],
    isLogging: false,
    pausedAtSeq: null,
    filters: [],
    colorRules: [],
    bookmarks: [],
    totalBytesReceived: 0,
    totalLinesReceived: 0,
    errorCount: 0,
    connectedAtMs: 0,
    triggers: [],
    macroRecording: false,
    macroPlaying: false,
    macroSteps: [],
    macroLastStepAtMs: null,
    scriptCode: '',
    scriptRunning: false,
    scriptConsole: [],
    activePlugins: [],
    modbusMasterLog: [],
    modbusMasterPolls: [],
    modbusSlave: {
      enabled: false,
      slaveAddr: 1,
      coils: {},
      discreteInputs: {},
      holdingRegisters: {},
      inputRegisters: {},
      log: [],
    },
    quickCommandProfileId: null,
    ...overrides,
  }
}

describe('buildProjectProfile', () => {
  it('maps each tab to a profile tab and its runtime id to its array index in the layout', () => {
    const tabA = makeTab({
      id: 'tab-a',
      connectionConfig: { kind: 'tcp-client', host: 'h', port: 1 },
    })
    const tabB = makeTab({ id: 'tab-b', connectionConfig: { kind: 'udp', localPort: 2 } })
    const layout = makePane(['tab-a', 'tab-b'])

    const profile = buildProjectProfile([tabA, tabB], layout, null)

    expect(profile.tabs).toHaveLength(2)
    expect(profile.tabs[0].connectionConfig).toEqual({ kind: 'tcp-client', host: 'h', port: 1 })
    expect(profile.tabs[1].connectionConfig).toEqual({ kind: 'udp', localPort: 2 })
    if (profile.layout.type !== 'pane') throw new Error('expected pane')
    expect(profile.layout.tabIds).toEqual(['0', '1'])
  })

  it('strips the SSH password but keeps everything else', () => {
    const tab = makeTab({
      id: 'tab-ssh',
      connectionConfig: {
        kind: 'ssh',
        host: 'host',
        port: 22,
        username: 'root',
        password: 'super-secret',
      },
    })
    const profile = buildProjectProfile([tab], makePane(['tab-ssh']), null)
    expect(profile.tabs[0].connectionConfig).toEqual({
      kind: 'ssh',
      host: 'host',
      port: 22,
      username: 'root',
      password: '',
    })
  })

  it('keeps the MQTT password as-is, matching how connection profiles already save it', () => {
    const tab = makeTab({
      id: 'tab-mqtt',
      connectionConfig: {
        kind: 'mqtt',
        brokerHost: 'broker',
        brokerPort: 1883,
        clientId: 'c1',
        password: 'broker-pass',
        subscribeTopic: '#',
        publishTopic: 'cmd',
      },
    })
    const profile = buildProjectProfile([tab], makePane(['tab-mqtt']), null)
    expect(profile.tabs[0].connectionConfig).toMatchObject({ password: 'broker-pass' })
  })

  it('carries filters/triggers/script/lineEnding/checksumMode through', () => {
    const tab = makeTab({
      id: 'tab-a',
      connectionConfig: { kind: 'tcp-client', host: 'h', port: 1 },
      filters: [{ id: 'f1', pattern: 'ERROR', mode: 'include', enabled: true }],
      triggers: [
        {
          id: 't1',
          pattern: 'READY',
          enabled: true,
          action: { type: 'send', sendText: 'AT', sendIsHex: false, filePath: '' },
        },
      ],
      scriptCode: 'log("hi")',
      lineEnding: 'lf',
      checksumMode: 'crc16-modbus',
    })
    const profile = buildProjectProfile([tab], makePane(['tab-a']), null)
    expect(profile.tabs[0].filters).toEqual(tab.filters)
    expect(profile.tabs[0].triggers).toEqual(tab.triggers)
    expect(profile.tabs[0].scriptCode).toBe('log("hi")')
    expect(profile.tabs[0].lineEnding).toBe('lf')
    expect(profile.tabs[0].checksumMode).toBe('crc16-modbus')
  })

  it('passes a null plotter config through unchanged', () => {
    const profile = buildProjectProfile([], makePane([]), null)
    expect(profile.plotter).toBeNull()
  })
})

describe('connectionConfigToOpenRequest', () => {
  it('flattens a serial config, overriding the stale saved id with the new one', () => {
    const req = connectionConfigToOpenRequest(
      {
        kind: 'serial',
        req: { id: 'old-id', portName: 'COM3', baudRate: 115200 },
      },
      'new-id',
    )
    expect(req).toEqual({ kind: 'serial', id: 'new-id', portName: 'COM3', baudRate: 115200 })
  })

  it('carries tcp-client fields through under the new id', () => {
    const req = connectionConfigToOpenRequest({ kind: 'tcp-client', host: 'h', port: 1 }, 'new-id')
    expect(req).toEqual({ kind: 'tcp-client', id: 'new-id', host: 'h', port: 1 })
  })

  it('keeps the MQTT password from the saved config', () => {
    const req = connectionConfigToOpenRequest(
      {
        kind: 'mqtt',
        brokerHost: 'b',
        brokerPort: 1883,
        clientId: 'c',
        password: 'saved-pass',
        subscribeTopic: '#',
        publishTopic: 'cmd',
      },
      'new-id',
    )
    expect(req).toMatchObject({ id: 'new-id', password: 'saved-pass' })
  })

  it('uses the freshly re-entered password for SSH, not whatever the file had', () => {
    const req = connectionConfigToOpenRequest(
      { kind: 'ssh', host: 'h', port: 22, username: 'root', password: '' },
      'new-id',
      're-entered-password',
    )
    expect(req).toEqual({
      kind: 'ssh',
      id: 'new-id',
      host: 'h',
      port: 22,
      username: 'root',
      password: 're-entered-password',
    })
  })
})
