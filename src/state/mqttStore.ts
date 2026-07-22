import { create } from 'zustand'
import { mqttPublish, mqttSubscribe, mqttUnsubscribe, onMqttMessage } from '../api/network'
import { usePlotStore } from './plotStore'
import { decodeText } from '../lib/payloadFormat'
import { getByPath } from '../lib/jsonPath'

export interface MqttMessageRecord {
  payload: number[]
  qos: number
  retain: boolean
  atMs: number
}

/** Capped per-topic — a wildcard subscribe like `#` on a busy broker can
 * produce far more messages than are useful to keep around; `messageCount`
 * stays accurate (cumulative) even once `history` has been trimmed. */
const MAX_HISTORY_PER_TOPIC = 50

export interface MqttTopicEntry {
  topic: string
  history: MqttMessageRecord[]
  messageCount: number
}

export interface MqttSubscription {
  topic: string
  qos: 0 | 1 | 2
}

/** Coalesces rapid MQTT-driven plot updates instead of calling
 * `ingestScriptPoint` (one Zustand `set` + one chart redraw each) per
 * message — a busy topic easily publishes many times a second, and doing a
 * full store update + uPlot redraw on every single one saturates the JS
 * main thread badly enough to make totally unrelated UI (e.g. the "add
 * tab" COM port scan) appear hung for many seconds, even though it's just
 * queued behind the render work. Only the latest value per channel within
 * a flush window is kept — the chart couldn't show more time resolution
 * than that anyway. */
const PLOT_FLUSH_MS = 150
let pendingPlotPoints = new Map<string, { streamId: string; channel: string; value: number }>()
let plotFlushTimer: ReturnType<typeof setTimeout> | null = null

function schedulePlotFlush() {
  if (plotFlushTimer) return
  plotFlushTimer = setTimeout(() => {
    plotFlushTimer = null
    const points = pendingPlotPoints
    pendingPlotPoints = new Map()
    const ingest = usePlotStore.getState().ingestScriptPoint
    for (const { streamId, channel, value } of points.values()) {
      ingest(streamId, channel, value)
    }
  }, PLOT_FLUSH_MS)
}

/** Same idea as the plot throttle above, for the topic tree itself: a
 * wildcard `#` subscribe on a busy broker delivers messages far faster than
 * anyone reads them, and doing a full `topicsByTab` store update (object
 * spread + a re-render of every MQTT-tree subscriber) on each one starves
 * the main thread even when the Plotter isn't involved at all. Buffer the
 * raw records per tab/topic and fold them into ONE store update per window
 * — history/messageCount stay exactly correct because every buffered record
 * is applied, just in a single batch. */
const TOPIC_FLUSH_MS = 150
let pendingTopics = new Map<string, Map<string, MqttMessageRecord[]>>()
let topicFlushTimer: ReturnType<typeof setTimeout> | null = null

function bufferTopicRecord(tabId: string, topic: string, record: MqttMessageRecord) {
  let byTopic = pendingTopics.get(tabId)
  if (!byTopic) {
    byTopic = new Map()
    pendingTopics.set(tabId, byTopic)
  }
  const records = byTopic.get(topic)
  if (records) records.push(record)
  else byTopic.set(topic, [record])

  if (topicFlushTimer) return
  topicFlushTimer = setTimeout(flushTopics, TOPIC_FLUSH_MS)
}

function flushTopics() {
  topicFlushTimer = null
  const batch = pendingTopics
  pendingTopics = new Map()
  useMqttStore.setState((state) => {
    const topicsByTab = { ...state.topicsByTab }
    for (const [tabId, byTopic] of batch) {
      const tabTopics = { ...(topicsByTab[tabId] ?? {}) }
      for (const [topic, records] of byTopic) {
        const prev = tabTopics[topic]
        tabTopics[topic] = {
          topic,
          history: [...(prev?.history ?? []), ...records].slice(-MAX_HISTORY_PER_TOPIC),
          messageCount: (prev?.messageCount ?? 0) + records.length,
        }
      }
      topicsByTab[tabId] = tabTopics
    }
    return { topicsByTab }
  })
}

interface MqttState {
  // Keyed by tab id, then by topic — messages keep accumulating per topic
  // even while the tab's Topics view isn't the one on screen.
  topicsByTab: Record<string, Record<string, MqttTopicEntry>>
  subscriptionsByTab: Record<string, MqttSubscription[]>
  eventsWired: boolean

  wireEventsOnce: () => void
  clearTopics: (tabId: string) => void
  publish: (
    tabId: string,
    topic: string,
    payload: number[],
    qos: number,
    retain: boolean,
  ) => Promise<void>

  /** Records the connect-time subscribe topic as already-active without
   * calling the backend again (it's already subscribed as part of opening
   * the connection) — called once when the topic explorer first mounts. */
  ensureInitialSubscription: (tabId: string, topic: string, qos: 0 | 1 | 2) => void
  addSubscription: (tabId: string, topic: string, qos: 0 | 1 | 2) => Promise<void>
  removeSubscription: (tabId: string, topic: string) => Promise<void>
}

export const useMqttStore = create<MqttState>((set, get) => ({
  topicsByTab: {},
  subscriptionsByTab: {},
  eventsWired: false,

  wireEventsOnce: () => {
    if (get().eventsWired) return
    set({ eventsWired: true })

    void onMqttMessage((event) => {
      bufferTopicRecord(event.id, event.topic, {
        payload: event.payload,
        qos: event.qos,
        retain: event.retain,
        atMs: Date.now(),
      })

      // Feeds any user-picked JSON fields (see MqttJsonFieldView) into the
      // plotter — exact topic match only, so a field picked from one topic
      // never gets fed by messages from a different one, even a same-named
      // field elsewhere. Silently skipped if this topic's payload isn't
      // JSON this time around (e.g. a device restart briefly sends garbage).
      const plot = usePlotStore.getState()
      if (plot.sourceTabId === event.id) {
        const watched = plot.mqttFields.filter((f) => f.enabled && f.topic === event.topic)
        if (watched.length > 0) {
          try {
            const parsed: unknown = JSON.parse(decodeText(event.payload))
            for (const field of watched) {
              const value = getByPath(parsed, field.path)
              if (typeof value === 'number' && Number.isFinite(value)) {
                pendingPlotPoints.set(field.channel, {
                  streamId: event.id,
                  channel: field.channel,
                  value,
                })
              }
            }
            if (pendingPlotPoints.size > 0) schedulePlotFlush()
          } catch {
            // not valid JSON this time — nothing to extract
          }
        }
      }
    })
  },

  clearTopics: (tabId) => {
    // Also drop anything still buffered for this tab, so a flush landing in
    // the next 150ms doesn't immediately repopulate what was just cleared.
    pendingTopics.delete(tabId)
    set((state) => {
      const next = { ...state.topicsByTab }
      delete next[tabId]
      return { topicsByTab: next }
    })
  },

  publish: async (tabId, topic, payload, qos, retain) => {
    await mqttPublish(tabId, topic, payload, qos, retain)
  },

  ensureInitialSubscription: (tabId, topic, qos) =>
    set((state) => {
      if (!topic) return state
      const existing = state.subscriptionsByTab[tabId] ?? []
      if (existing.some((s) => s.topic === topic)) return state
      return {
        subscriptionsByTab: {
          ...state.subscriptionsByTab,
          [tabId]: [...existing, { topic, qos }],
        },
      }
    }),

  addSubscription: async (tabId, topic, qos) => {
    if (!topic) return
    const existing = get().subscriptionsByTab[tabId] ?? []
    if (existing.some((s) => s.topic === topic)) return
    await mqttSubscribe(tabId, topic, qos)
    set((state) => ({
      subscriptionsByTab: {
        ...state.subscriptionsByTab,
        [tabId]: [...(state.subscriptionsByTab[tabId] ?? []), { topic, qos }],
      },
    }))
  },

  removeSubscription: async (tabId, topic) => {
    await mqttUnsubscribe(tabId, topic)
    set((state) => ({
      subscriptionsByTab: {
        ...state.subscriptionsByTab,
        [tabId]: (state.subscriptionsByTab[tabId] ?? []).filter((s) => s.topic !== topic),
      },
    }))
  },
}))
