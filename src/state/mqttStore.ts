import { create } from 'zustand'
import { mqttPublish, mqttSubscribe, mqttUnsubscribe, onMqttMessage } from '../api/network'

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
      set((state) => {
        const tabTopics = state.topicsByTab[event.id] ?? {}
        const prev = tabTopics[event.topic]
        const record: MqttMessageRecord = {
          payload: event.payload,
          qos: event.qos,
          retain: event.retain,
          atMs: Date.now(),
        }
        const entry: MqttTopicEntry = {
          topic: event.topic,
          history: [...(prev?.history ?? []), record].slice(-MAX_HISTORY_PER_TOPIC),
          messageCount: (prev?.messageCount ?? 0) + 1,
        }
        return {
          topicsByTab: {
            ...state.topicsByTab,
            [event.id]: { ...tabTopics, [event.topic]: entry },
          },
        }
      })
    })
  },

  clearTopics: (tabId) =>
    set((state) => {
      const next = { ...state.topicsByTab }
      delete next[tabId]
      return { topicsByTab: next }
    }),

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
