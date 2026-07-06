import { createLibraryStore, type LibraryItem } from './createLibraryStore'

export type MqttPublishFormat = 'text' | 'json' | 'hex'

export interface MqttPreset extends LibraryItem {
  topic: string
  payload: string
  qos: 0 | 1 | 2
  retain: boolean
  /** Optional so presets saved before this field existed still load fine. */
  format?: MqttPublishFormat
}

export const useMqttPresetsStore = createLibraryStore<MqttPreset>('edt-mqtt-presets')
