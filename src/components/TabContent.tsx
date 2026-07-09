import { useState } from 'react'
import type { TabState } from '../state/tabsStore'
import { MonitorView } from './MonitorView'
import { SendPanel } from './SendPanel'
import { QuickCommandsBar } from './QuickCommandsBar'
import { MqttPanel } from './MqttPanel'
import { UdpPanel } from './UdpPanel'
import { WsPanel } from './WsPanel'
import { SshPanel } from './SshPanel'

// The specialized/raw toggle is per-tab-view, not global — once multiple
// panes can show different tabs side by side, a single App-level toggle
// would leak one pane's choice into every other pane showing a protocol tab.
export function TabContent({ tab }: { tab: TabState }) {
  const [protocolView, setProtocolView] = useState<'specialized' | 'raw'>('specialized')

  const specializedViewLabel =
    tab.connectionKind === 'mqtt'
      ? 'Topics'
      : tab.connectionKind === 'udp'
        ? 'Packets'
        : tab.connectionKind === 'ws-client' || tab.connectionKind === 'ws-server'
          ? 'Frames'
          : null

  if (tab.connectionKind === 'ssh') {
    // A PTY has no line-oriented "raw log" fallback that would make sense —
    // unlike MQTT/UDP/WS, there's no toggle here.
    return <SshPanel tab={tab} />
  }

  return (
    <>
      {specializedViewLabel && (
        <div className="seg protocol-view-toggle">
          <span
            className={protocolView === 'specialized' ? 'on' : ''}
            onClick={() => setProtocolView('specialized')}
          >
            {specializedViewLabel}
          </span>
          <span
            className={protocolView === 'raw' ? 'on' : ''}
            onClick={() => setProtocolView('raw')}
          >
            Raw log
          </span>
        </div>
      )}
      {specializedViewLabel && protocolView === 'specialized' ? (
        tab.connectionKind === 'mqtt' ? (
          <MqttPanel tab={tab} />
        ) : tab.connectionKind === 'udp' ? (
          <UdpPanel tab={tab} />
        ) : (
          <WsPanel tab={tab} />
        )
      ) : (
        <>
          <MonitorView tab={tab} />
          <QuickCommandsBar tab={tab} />
          <SendPanel tab={tab} />
        </>
      )}
    </>
  )
}
