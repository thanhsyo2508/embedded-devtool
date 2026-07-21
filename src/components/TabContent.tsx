import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TabState } from '../state/tabsStore'
import { MonitorView } from './MonitorView'
import { SendPanel } from './SendPanel'
import { QuickCommandsBar } from './QuickCommandsBar'
import { MqttPanel } from './MqttPanel'
import { UdpPanel } from './UdpPanel'
import { WsPanel } from './WsPanel'
import { SshWorkspacePanel } from './SshWorkspacePanel'
import { FtpWorkspacePanel } from './FtpWorkspacePanel'
import { SwdWatchPanel } from './SwdWatchPanel'

// The specialized/raw toggle is per-tab-view, not global — once multiple
// panes can show different tabs side by side, a single App-level toggle
// would leak one pane's choice into every other pane showing a protocol tab.
export function TabContent({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const [protocolView, setProtocolView] = useState<'specialized' | 'raw'>('specialized')

  const specializedViewLabel =
    tab.connectionKind === 'mqtt'
      ? t('tabContent.topics')
      : tab.connectionKind === 'udp'
        ? t('tabContent.packets')
        : tab.connectionKind === 'ws-client' || tab.connectionKind === 'ws-server'
          ? t('tabContent.frames')
          : null

  if (tab.connectionKind === 'ssh') {
    // A PTY has no line-oriented "raw log" fallback that would make sense —
    // unlike MQTT/UDP/WS, there's no toggle here.
    return <SshWorkspacePanel tab={tab} />
  }

  if (tab.connectionKind === 'ftp') {
    // FTP is a stateful file browser, not a byte stream — MonitorView/
    // SendPanel don't apply, same reasoning as SSH above.
    return <FtpWorkspacePanel tab={tab} />
  }

  if (tab.connectionKind === 'rtt') {
    // No Send box: RTT down-channel writes aren't implemented (see
    // core::rtt_stream). Variable watch takes that slot instead.
    return (
      <>
        <MonitorView tab={tab} />
        <SwdWatchPanel tab={tab} />
      </>
    )
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
            {t('tabContent.rawLog')}
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
