import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TabState } from '../state/tabsStore'
import { useMqttStore, type MqttSubscription, type MqttTopicEntry } from '../state/mqttStore'
import { useMqttPresetsStore, type MqttPublishFormat } from '../state/mqttPresetsStore'
import { useToastStore } from '../state/toastStore'
import { buildMqttTree, filterMqttTree } from '../lib/mqttTree'
import {
  decodeText,
  jsonParseError,
  looksBinary,
  toHexDump,
  tryPrettyJson,
} from '../lib/payloadFormat'
import { parseHex } from '../lib/hex'
import { relativeTime } from '../lib/relativeTime'
import { MqttTopicTree } from './MqttTopicTree'
import { MqttJsonFieldView } from './MqttJsonFieldView'
import { LibraryRow } from './LibraryRow'
import { CopyButton } from './CopyButton'
import { MessageIcon, PlusIcon, SearchIcon, TrashIcon, XIcon } from './icons'

// Stable references for the "nothing yet" case — a fresh `{}`/`[]` literal
// inline in a Zustand selector fabricates a new object on every call, which
// makes useSyncExternalStore think the store changed on every render and
// re-render in a loop (crashes with "Maximum update depth exceeded" right
// when a tab has no topics/subscriptions yet, i.e. immediately after
// connecting). See the MqttPanel blank-screen bug this was fixed for.
const EMPTY_TOPICS: Record<string, MqttTopicEntry> = {}
const EMPTY_SUBSCRIPTIONS: MqttSubscription[] = []

const QOS_OPTIONS = [0, 1, 2] as const

function PayloadView({
  payload,
  view,
  topic,
  tabId,
}: {
  payload: number[]
  view: 'auto' | 'hex'
  topic: string
  tabId: string
}) {
  const { t } = useTranslation()
  if (view === 'hex') {
    return <pre className="mqtt-payload-view mono">{toHexDump(payload) || t('mqtt.empty')}</pre>
  }
  const pretty = tryPrettyJson(payload)
  if (pretty !== null) {
    // Already proven parseable by tryPrettyJson above — same bytes, no
    // separate try/catch needed for this second parse.
    const parsed: unknown = JSON.parse(decodeText(payload))
    return (
      <div className="mqtt-payload-view mono">
        <MqttJsonFieldView value={parsed} topic={topic} tabId={tabId} />
      </div>
    )
  }
  const text = decodeText(payload)
  return <pre className="mqtt-payload-view mono">{text || t('mqtt.empty')}</pre>
}

export function MqttPanel({ tab }: { tab: TabState }) {
  const { t } = useTranslation()
  const topics = useMqttStore((s) => s.topicsByTab[tab.id] ?? EMPTY_TOPICS)
  const subscriptions = useMqttStore((s) => s.subscriptionsByTab[tab.id] ?? EMPTY_SUBSCRIPTIONS)
  const clearTopics = useMqttStore((s) => s.clearTopics)
  const publish = useMqttStore((s) => s.publish)
  const ensureInitialSubscription = useMqttStore((s) => s.ensureInitialSubscription)
  const addSubscription = useMqttStore((s) => s.addSubscription)
  const removeSubscription = useMqttStore((s) => s.removeSubscription)
  const addToast = useToastStore((s) => s.addToast)

  const presets = useMqttPresetsStore((s) => s.items)
  const savePreset = useMqttPresetsStore((s) => s.save)
  const deletePreset = useMqttPresetsStore((s) => s.remove)

  const config = tab.connectionConfig.kind === 'mqtt' ? tab.connectionConfig : null

  useEffect(() => {
    if (config && config.subscribeTopic) {
      ensureInitialSubscription(tab.id, config.subscribeTopic, 0)
    }
    // Only ever needs to run once per tab — the connect-time subscribe
    // topic never changes after the connection is opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null)
  const [payloadView, setPayloadView] = useState<'auto' | 'hex'>('auto')
  const [now, setNow] = useState(() => Date.now())

  const [newSubTopic, setNewSubTopic] = useState('')
  const [newSubQos, setNewSubQos] = useState<(typeof QOS_OPTIONS)[number]>(0)

  const [publishTopic, setPublishTopic] = useState(config?.publishTopic ?? '')
  const [publishFormat, setPublishFormat] = useState<MqttPublishFormat>('text')
  const [publishText, setPublishText] = useState('')
  const [qos, setQos] = useState<(typeof QOS_OPTIONS)[number]>(0)
  const [retain, setRetain] = useState(false)
  const [sending, setSending] = useState(false)

  // Drives the "Ns ago" columns — a plain interval rather than re-deriving
  // on every store update, since most ticks have no new message at all.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(interval)
  }, [])

  const tree = useMemo(() => buildMqttTree(topics), [topics])
  const filteredTree = useMemo(() => filterMqttTree(tree, search), [tree, search])
  const topicCount = useMemo(() => Object.keys(topics).length, [topics])

  const selectedEntry = selectedTopic ? topics[selectedTopic] : null
  const selectedLatest = selectedEntry?.history[selectedEntry.history.length - 1] ?? null

  const toggleExpanded = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const jsonError = publishFormat === 'json' ? jsonParseError(publishText) : null
  const hexBytes = publishFormat === 'hex' ? parseHex(publishText) : null
  const hexInvalid = publishFormat === 'hex' && hexBytes === null
  const publishInvalid = jsonError !== null || hexInvalid

  const encodePublishPayload = (): number[] | null => {
    if (publishFormat === 'hex') return hexBytes
    if (publishFormat === 'json' && jsonError !== null) return null
    return Array.from(new TextEncoder().encode(publishText))
  }

  const handlePublish = () => {
    if (!publishTopic || publishInvalid) return
    const bytes = encodePublishPayload()
    if (bytes === null) return
    setSending(true)
    publish(tab.id, publishTopic, bytes, qos, retain)
      .catch((err: unknown) => {
        addToast('error', t('mqtt.publishError', { message: String(err) }))
      })
      .finally(() => setSending(false))
  }

  const handleFormatJson = () => {
    if (jsonParseError(publishText) !== null) return
    try {
      setPublishText(JSON.stringify(JSON.parse(publishText), null, 2))
    } catch {
      // jsonError check above already prevents reaching here
    }
  }

  const handleClearRetained = () => {
    if (!selectedTopic) return
    setSending(true)
    publish(tab.id, selectedTopic, [], 0, true)
      .catch((err: unknown) => {
        addToast('error', t('mqtt.publishError', { message: String(err) }))
      })
      .finally(() => setSending(false))
  }

  const handleAddSubscription = () => {
    if (!newSubTopic) return
    const topic = newSubTopic
    addSubscription(tab.id, topic, newSubQos)
      .then(() => setNewSubTopic(''))
      .catch((err: unknown) => {
        addToast('error', t('mqtt.subscribeError', { message: String(err) }))
      })
  }

  const handleRemoveSubscription = (topic: string) => {
    removeSubscription(tab.id, topic).catch((err: unknown) => {
      addToast('error', t('mqtt.unsubscribeError', { message: String(err) }))
    })
  }

  return (
    <div className="mqtt-panel">
      <div className="toolbar">
        <span className="line-count">{t('mqtt.topicCount', { count: topicCount })}</span>
        <button type="button" onClick={() => clearTopics(tab.id)} disabled={topicCount === 0}>
          <TrashIcon /> {t('monitor.clear')}
        </button>
        {tab.status === 'closed' && (
          <span className="tab-disconnected">{t('monitor.disconnected')}</span>
        )}
        {tab.status === 'error' && <span className="tab-error">{tab.errorMessage}</span>}
      </div>

      <div className="mqtt-subscriptions">
        {subscriptions.map((sub) => (
          <span key={sub.topic} className="mqtt-sub-chip">
            <span className="mono">{sub.topic}</span>
            <span className="mqtt-sub-qos">QoS {sub.qos}</span>
            <button
              type="button"
              aria-label={t('mqtt.unsubscribe', { topic: sub.topic })}
              onClick={() => handleRemoveSubscription(sub.topic)}
            >
              <XIcon />
            </button>
          </span>
        ))}
        <div className="mqtt-sub-add">
          <input
            type="text"
            className="mono"
            value={newSubTopic}
            placeholder={t('mqtt.subscribeToTopic')}
            onChange={(e) => setNewSubTopic(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddSubscription()}
            disabled={tab.status !== 'open'}
          />
          <select
            value={newSubQos}
            onChange={(e) => setNewSubQos(Number(e.target.value) as 0 | 1 | 2)}
          >
            {QOS_OPTIONS.map((q) => (
              <option key={q} value={q}>
                QoS {q}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="icon-button"
            title={t('mqtt.addSubscription')}
            disabled={tab.status !== 'open' || !newSubTopic}
            onClick={handleAddSubscription}
          >
            <PlusIcon />
          </button>
        </div>
      </div>

      <div className="mqtt-explorer">
        <div className="mqtt-tree-pane">
          <div className="mqtt-search">
            <SearchIcon />
            <input
              type="text"
              placeholder={t('mqtt.filterTopics')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="mqtt-tree-scroll">
            <MqttTopicTree
              root={filteredTree}
              expanded={expanded}
              onToggle={toggleExpanded}
              selectedTopic={selectedTopic}
              onSelect={setSelectedTopic}
              forceExpand={search.trim().length > 0}
            />
          </div>
        </div>

        <div className="mqtt-detail-pane">
          {!selectedEntry ? (
            <p className="mdns-empty">{t('mqtt.selectTopicPrompt')}</p>
          ) : (
            <>
              <div className="mqtt-detail-header">
                <span className="mono">{selectedEntry.topic}</span>
                <div className="mqtt-detail-actions">
                  <CopyButton getText={() => selectedEntry.topic} title={t('mqtt.copyTopic')} />
                  {selectedLatest?.retain && (
                    <button
                      type="button"
                      title={t('mqtt.clearRetainedTitle')}
                      disabled={tab.status !== 'open' || sending}
                      onClick={handleClearRetained}
                    >
                      {t('mqtt.clearRetained')}
                    </button>
                  )}
                  <div className="seg">
                    <span
                      className={payloadView === 'auto' ? 'on' : ''}
                      onClick={() => setPayloadView('auto')}
                    >
                      {t('mqtt.text')}
                    </span>
                    <span
                      className={payloadView === 'hex' ? 'on' : ''}
                      onClick={() => setPayloadView('hex')}
                    >
                      {t('mqtt.hexLabel')}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mqtt-history">
                {[...selectedEntry.history].reverse().map((msg, i) => (
                  <div key={selectedEntry.history.length - i} className="mqtt-history-entry">
                    <div className="mqtt-history-meta">
                      <span>{relativeTime(msg.atMs, now)}</span>
                      <span>QoS {msg.qos}</span>
                      {msg.retain && <span className="mqtt-tree-badge">{t('mqtt.retained')}</span>}
                      <span>{t('mqtt.byteCount', { count: msg.payload.length })}</span>
                      <CopyButton
                        getText={() => decodeText(msg.payload)}
                        title={t('mqtt.copyPayload')}
                        className="mqtt-copy-payload"
                      />
                    </div>
                    <PayloadView
                      payload={msg.payload}
                      view={
                        payloadView === 'auto' && looksBinary(msg.payload) ? 'hex' : payloadView
                      }
                      topic={selectedEntry.topic}
                      tabId={tab.id}
                    />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mqtt-publish">
        <LibraryRow
          label={t('filterBar.presetLabel')}
          items={presets}
          onLoad={(p) => {
            setPublishTopic(p.topic)
            setPublishText(p.payload)
            setQos(p.qos)
            setRetain(p.retain)
            setPublishFormat(p.format ?? 'text')
          }}
          onSave={(name) =>
            savePreset(name, {
              topic: publishTopic,
              payload: publishText,
              qos,
              retain,
              format: publishFormat,
            })
          }
          onDelete={deletePreset}
        />
        <div className="mqtt-publish-row">
          <label className="field-group">
            <span className="field-caption">
              <MessageIcon /> {t('mqtt.publishTopic')}
            </span>
            <input
              type="text"
              className="mono"
              value={publishTopic}
              onChange={(e) => setPublishTopic(e.target.value)}
            />
          </label>
          <label className="field-group">
            <span className="field-caption">QoS</span>
            <select value={qos} onChange={(e) => setQos(Number(e.target.value) as 0 | 1 | 2)}>
              {QOS_OPTIONS.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={retain} onChange={(e) => setRetain(e.target.checked)} />
            <span>{t('mqtt.retain')}</span>
          </label>
        </div>

        <div className="mqtt-publish-format-row">
          <div className="seg">
            <span
              className={publishFormat === 'text' ? 'on' : ''}
              onClick={() => setPublishFormat('text')}
            >
              {t('mqtt.text')}
            </span>
            <span
              className={publishFormat === 'json' ? 'on' : ''}
              onClick={() => setPublishFormat('json')}
            >
              JSON
            </span>
            <span
              className={publishFormat === 'hex' ? 'on' : ''}
              onClick={() => setPublishFormat('hex')}
            >
              {t('mqtt.hexLabel')}
            </span>
          </div>
          {publishFormat === 'json' && (
            <button type="button" onClick={handleFormatJson} disabled={jsonError !== null}>
              {t('mqtt.format')}
            </button>
          )}
          {jsonError && <span className="mqtt-publish-error">{jsonError}</span>}
          {hexInvalid && <span className="mqtt-publish-error">{t('mqtt.invalidHex')}</span>}
        </div>

        <label className="field-group">
          <span className="field-caption">{t('mqtt.payloadLabel')}</span>
          <textarea
            className={`mono mqtt-publish-payload ${publishInvalid ? 'invalid' : ''}`}
            value={publishText}
            placeholder={
              publishFormat === 'json'
                ? '{"key": "value"}'
                : publishFormat === 'hex'
                  ? t('send.hexPlaceholder')
                  : t('mqtt.messagePayload')
            }
            onChange={(e) => setPublishText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                handlePublish()
              }
            }}
            disabled={tab.status !== 'open'}
          />
        </label>
        <button
          type="button"
          onClick={handlePublish}
          disabled={tab.status !== 'open' || !publishTopic || publishInvalid || sending}
        >
          {sending ? t('mqtt.publishing') : t('mqtt.publish')}
        </button>
      </div>
    </div>
  )
}
