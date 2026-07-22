import { useTranslation } from 'react-i18next'
import { usePlotStore } from '../state/plotStore'
import { ChartIcon } from './icons'

const INDENT = '  '

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A leaf value's line-content — plain text, no interactivity. The "add to
 * plot" button used to sit right after this text, but a value's width
 * varies line to line (a short int vs. a long float vs. a string), so the
 * button kept landing at a different x position on every row and was hard
 * to aim at — see `FieldToggle`, which now renders it at the start of the
 * line instead, where it's always the same distance from the left edge. */
function JsonLeaf({ value }: { value: string | number | boolean | null }) {
  const kind =
    value === null
      ? 'null'
      : typeof value === 'boolean'
        ? 'boolean'
        : typeof value === 'number'
          ? null
          : 'string'
  const text =
    value === null ? 'null' : typeof value === 'string' ? JSON.stringify(value) : String(value)
  return <span className={kind ? `json-${kind}` : undefined}>{text}</span>
}

/** The "add to plot" toggle for one numeric field, rendered at a fixed spot
 * (line start) so it never moves regardless of that field's value width.
 * `canWatch` gates it on whether this MQTT tab is actually the plotter's
 * current source (see MqttPanel) — clicking it from an unrelated tab
 * wouldn't feed the chart at all. */
function FieldToggle({ topic, path }: { topic: string; path: string }) {
  const { t } = useTranslation()
  const mqttFields = usePlotStore((s) => s.mqttFields)
  const addMqttField = usePlotStore((s) => s.addMqttField)
  const removeMqttField = usePlotStore((s) => s.removeMqttField)
  const watched = mqttFields.find((f) => f.topic === topic && f.path === path)

  return (
    <button
      type="button"
      className={`mqtt-field-add ${watched ? 'on' : ''}`}
      aria-label={t(watched ? 'plot.removeMqttFieldTitle' : 'plot.addMqttFieldTitle')}
      title={t(watched ? 'plot.removeMqttFieldTitle' : 'plot.addMqttFieldTitle')}
      onClick={(e) => {
        e.stopPropagation()
        if (watched) removeMqttField(watched.id)
        else addMqttField(topic, path)
      }}
    >
      <ChartIcon />
    </button>
  )
}

function JsonNode({
  value,
  path,
  depth,
  isLast,
  topic,
  canWatch,
}: {
  value: unknown
  path: string
  depth: number
  isLast: boolean
  topic: string
  canWatch: boolean
}) {
  const comma = isLast ? '' : ','
  const isArray = Array.isArray(value)

  if (isArray || isPlainObject(value)) {
    const entries: [string, unknown][] = isArray
      ? value.map((v, i): [string, unknown] => [String(i), v])
      : Object.entries(value as Record<string, unknown>)
    const indent = INDENT.repeat(depth)
    const closeIndent = INDENT.repeat(depth - 1)
    if (entries.length === 0) {
      return <>{(isArray ? '[]' : '{}') + comma}</>
    }
    return (
      <>
        {isArray ? '[' : '{'}
        {entries.map(([key, v], i) => {
          const childPath = path ? `${path}.${key}` : key
          const isNumericLeaf = typeof v === 'number' && Number.isFinite(v)
          return (
            <span key={key}>
              {'\n' + indent}
              {isNumericLeaf && canWatch && <FieldToggle topic={topic} path={childPath} />}
              {!isArray && <span className="json-key">{JSON.stringify(key)}: </span>}
              <JsonNode
                value={v}
                path={childPath}
                depth={depth + 1}
                isLast={i === entries.length - 1}
                topic={topic}
                canWatch={canWatch}
              />
            </span>
          )
        })}
        {'\n' + closeIndent}
        {isArray ? ']' : '}'}
        {comma}
      </>
    )
  }

  return (
    <>
      <JsonLeaf value={value as string | number | boolean | null} />
      {comma}
    </>
  )
}

/** Renders a decoded MQTT JSON payload the same way the plain pretty-printed
 * view does, but walks the real value tree (not just tokenized text) so
 * every numeric leaf can carry its own dot-path — the thing `addMqttField`
 * needs to re-extract that exact field from later messages on this topic. */
export function MqttJsonFieldView({
  value,
  topic,
  tabId,
}: {
  value: unknown
  topic: string
  tabId: string
}) {
  const sourceTabId = usePlotStore((s) => s.sourceTabId)
  const canWatch = sourceTabId === tabId
  // Rare fallback: a payload that's just a bare number, not wrapped in an
  // object/array — the entries-loop above never runs, so there's no
  // line-start slot to put the button in; keep it inline here instead.
  const isTopLevelNumericLeaf = typeof value === 'number' && Number.isFinite(value)
  return (
    <>
      {isTopLevelNumericLeaf && canWatch && <FieldToggle topic={topic} path="" />}
      <JsonNode value={value} path="" depth={1} isLast topic={topic} canWatch={canWatch} />
    </>
  )
}
