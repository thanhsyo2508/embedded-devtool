import { describe, expect, it } from 'vitest'
import { buildDiagnosticBundle } from './diagnosticBundle'
import type { TabState } from '../state/tabsStore'

function fakeTab(): TabState {
  return {
    id: 't1',
    connectionKind: 'ssh',
    connectionLabel: 'ssh host',
    connectionConfig: {
      kind: 'ssh',
      id: 't1',
      host: 'h',
      port: 22,
      username: 'u',
      password: 'supersecret',
    },
    status: 'open',
    totalLinesReceived: 5,
    errorCount: 1,
    lines: [{ seq: 0, atMs: 1, direction: 'rx', text: 'hi', bytes: [], level: null }],
    // The bundle only reads the fields above; the rest of TabState is not
    // touched, so a partial cast is safe for this test.
  } as unknown as TabState
}

describe('buildDiagnosticBundle', () => {
  it('redacts secrets in settings and passwords in connections', () => {
    const json = buildDiagnosticBundle({
      version: '1.2.3',
      platform: 'test',
      tabs: [fakeTab()],
      settings: { theme: 'dark', restApiToken: 'abc', flashLockPin: '4321', setTheme: () => {} },
    })
    const parsed = JSON.parse(json)

    expect(parsed.version).toBe('1.2.3')
    expect(parsed.settings.theme).toBe('dark')
    expect(parsed.settings.restApiToken).toBe('[redacted]')
    expect(parsed.settings.flashLockPin).toBe('[redacted]')
    // functions are dropped
    expect('setTheme' in parsed.settings).toBe(false)
    // connection password redacted, other fields kept
    expect(parsed.tabs[0].connectionConfig.password).toBe('[redacted]')
    expect(parsed.tabs[0].connectionConfig.host).toBe('h')
    expect(parsed.tabs[0].recentLines[0].text).toBe('hi')
  })

  it('leaves an empty secret empty rather than redacted', () => {
    const json = buildDiagnosticBundle({
      version: '1',
      platform: 'test',
      tabs: [],
      settings: { restApiToken: '' },
    })
    expect(JSON.parse(json).settings.restApiToken).toBe('')
  })
})
