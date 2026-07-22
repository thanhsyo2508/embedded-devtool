import { useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { useTranslation } from 'react-i18next'
import { usePlotStore, type ChartType } from '../state/plotStore'
import { useTabsStore } from '../state/tabsStore'
import { useToastStore } from '../state/toastStore'
import { computeSpectrum, type FftWindow } from '../lib/fft'
import { computeMathChannel, MATH_OPS } from '../lib/plotMath'
import { measure } from '../lib/plotMeasure'
import { playBeep } from '../lib/beep'
import { FilterIcon, PlusIcon, TargetIcon, TrashIcon, XIcon } from './icons'

const PALETTE = [
  '#c4472b',
  '#4a7a40',
  '#3f7ac9',
  '#a67a1e',
  '#8a5fbf',
  '#2f9e8f',
  '#c23b7a',
  '#5c6470',
]

const CHART_TYPE_VALUES: ChartType[] = ['line', 'area', 'step', 'bars', 'points']
const FFT_WINDOW_VALUES: FftWindow[] = ['none', 'hann', 'hamming']

/** Display-key prefix for math channels. Real channel names always match
 * `[a-zA-Z_]\w*` (see plotStore's parseLine/extractors), so this prefix can
 * never collide with — or silently shadow — a real channel, and it doubles
 * as a visual marker in the legend. */
const MATH_PREFIX = 'ƒ '

// uPlot draws axes/grid/series directly on <canvas> — none of that is
// reachable through CSS. Reading the app's theme variables here and passing
// them into the JS options is the only way axis text and gridlines aren't
// invisible-on-dark (uPlot's own defaults are near-black).
function themeColor(varName: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
  return value || fallback
}

const noLinePaths: uPlot.Series.PathBuilder = () => null

// Applies the chosen chart style to a single series. Line is uPlot's
// default (omit paths/points overrides); the others swap in one of uPlot's
// built-in path builders.
function seriesStyleFor(chartType: ChartType, color: string): Partial<uPlot.Series> {
  switch (chartType) {
    case 'area':
      return { fill: `${color}33` }
    case 'step':
      return { paths: uPlot.paths.stepped!({ align: 1 }) }
    case 'bars':
      return { paths: uPlot.paths.bars!({ size: [0.6, 100] }), points: { show: false } }
    case 'points':
      return { paths: noLinePaths, points: { show: true, size: 5 } }
    default:
      return {}
  }
}

function formatStat(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  if (abs !== 0 && (abs >= 100000 || abs < 0.001)) return v.toExponential(2)
  return Number(v.toPrecision(4)).toString()
}

// A single-row legend still needs its own height on top of the plotting
// area — without reserving space for it up front, it gets pushed past the
// container's bottom edge and clipped as soon as hovering makes it taller
// (live values render wider than the idle labels).
const LEGEND_RESERVE_PX = 30

// How often to pull new lines into the chart. The backend emits data
// batches at ~60fps; ingesting (a full channel-array copy + a uPlot
// setData redraw) on every one of those saturates the JS main thread and
// makes unrelated UI — port scans, tab switches — visibly lag. ingest is
// seq-based (only ever consumes lines newer than lastProcessedLineSeq), so
// pulling on this slower fixed cadence coalesces many batches into one pass
// with zero data loss, while a 100ms redraw cadence is still smooth to the
// eye. Mirrors the MQTT-point throttle in mqttStore.
const PLOT_INGEST_INTERVAL_MS = 100

export function PlotDock() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const tabs = useTabsStore((s) => s.tabs)
  const {
    sourceTabId,
    frozen,
    channelOrder,
    channelData,
    timestamps,
    dockHeight,
    hiddenChannels,
    channelColors,
    chartType,
    extractors,
    mathChannels,
    thresholds,
    mqttFields,
    fftMode,
    fftWindow,
    showStats,
    setSourceTabId,
    setFrozen,
    reset,
    ingest,
    setVisible,
    toggleChannelVisibility,
    setChannelColor,
    setChartType,
    setFftMode,
    setFftWindow,
    setShowStats,
    addExtractor,
    removeExtractor,
    updateExtractor,
    toggleExtractorEnabled,
    addMathChannel,
    removeMathChannel,
    updateMathChannel,
    toggleMathChannelEnabled,
    addThreshold,
    removeThreshold,
    updateThreshold,
    toggleThresholdEnabled,
    removeMqttField,
    toggleMqttFieldEnabled,
  } = usePlotStore()
  const sourceTab = tabs.find((tab) => tab.id === sourceTabId) ?? null
  const [openPanel, setOpenPanel] = useState<
    'extractors' | 'math' | 'thresholds' | 'mqttFields' | null
  >(null)

  // Measurement cursors: click two points to read Δt / Δy / frequency
  // between them. Markers are stored as data indices — only meaningful
  // while the data underneath isn't shifting, so entering measure mode
  // freezes ingestion (see the toggle below). Kept as local state, not in
  // the store: nothing else needs it and it shouldn't persist.
  const [measureMode, setMeasureMode] = useState(false)
  const [markers, setMarkers] = useState<{ a: number | null; b: number | null }>({
    a: null,
    b: null,
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)

  // A channel's colour: an explicit override, else its slot in the palette.
  const colorFor = (ch: string, i: number): string =>
    channelColors[ch] ?? PALETTE[i % PALETTE.length]

  // Depends on sourceTabId (stable across data batches), NOT the sourceTab
  // object (new identity every batch) — otherwise the interval would be
  // torn down and recreated 60 times a second, defeating the throttle. The
  // freshest tab is read from the store inside each tick instead.
  useEffect(() => {
    if (!sourceTabId) return
    const tick = () => {
      const tab = useTabsStore.getState().tabs.find((t) => t.id === sourceTabId)
      if (tab) ingest(tab)
    }
    tick() // first pass immediately so selecting a source feels responsive
    const id = setInterval(tick, PLOT_INGEST_INTERVAL_MS)
    return () => clearInterval(id)
  }, [sourceTabId, ingest])

  // Real channels + enabled math channels, computed once per data tick —
  // everything downstream (series, chart data, stats, FFT, CSV export)
  // consumes displayOrder/displayData so math channels behave exactly like
  // real ones.
  const displayOrder = useMemo(
    () => [
      ...channelOrder,
      ...mathChannels.filter((m) => m.enabled).map((m) => MATH_PREFIX + m.label),
    ],
    [channelOrder, mathChannels],
  )

  const displayData = useMemo(() => {
    const out: Record<string, (number | null)[]> = { ...channelData }
    for (const m of mathChannels) {
      if (!m.enabled) continue
      out[MATH_PREFIX + m.label] = computeMathChannel(m, channelData, timestamps)
    }
    return out
  }, [channelData, timestamps, mathChannels])

  // Spectra for ALL display channels (not just visible ones) so the series
  // count always matches the data column count — visibility stays a
  // setSeries concern, identical to time mode.
  const spectra = useMemo(() => {
    if (!fftMode) return null
    let frequencies: number[] | null = null
    const magnitudes: Record<string, number[]> = {}
    for (const ch of displayOrder) {
      const s = computeSpectrum(displayData[ch] ?? [], timestamps, fftWindow)
      if (s) {
        frequencies = s.frequencies
        magnitudes[ch] = s.magnitudes
      }
    }
    if (!frequencies) return null
    return { frequencies, magnitudes }
  }, [fftMode, fftWindow, displayOrder, displayData, timestamps])

  const stats = useMemo(() => {
    if (!showStats || fftMode) return null
    return displayOrder
      .filter((ch) => !hiddenChannels.includes(ch))
      .map((ch) => ({ ch, m: measure(displayData[ch] ?? [], timestamps) }))
  }, [showStats, fftMode, displayOrder, displayData, timestamps, hiddenChannels])

  // Δt / Δy / frequency between the two placed markers (null until both are
  // set). Frequency is 1/Δt — handy for reading a period straight off two
  // successive peaks.
  const measurement = useMemo(() => {
    const { a, b } = markers
    if (a === null || b === null) return null
    const ta = timestamps[a]
    const tb = timestamps[b]
    if (ta === undefined || tb === undefined) return null
    const dt = (tb - ta) / 1000
    const freq = dt !== 0 ? 1 / Math.abs(dt) : null
    const channels = displayOrder
      .filter((ch) => !hiddenChannels.includes(ch))
      .map((ch) => {
        const arr = displayData[ch]
        const ya = arr?.[a]
        const yb = arr?.[b]
        const dy =
          ya !== null && ya !== undefined && yb !== null && yb !== undefined ? yb - ya : null
        return { ch, dy }
      })
    return { dt, freq, channels }
  }, [markers, timestamps, displayOrder, displayData, hiddenChannels])

  const toggleMeasure = () => {
    const next = !measureMode
    setMeasureMode(next)
    setMarkers({ a: null, b: null })
    // Freeze so the marker indices keep pointing at the same samples while
    // you read them — measuring a moving trace would be meaningless.
    if (next) setFrozen(true)
  }

  // Threshold lines are drawn from a mutable ref inside the uPlot draw hook
  // so editing a value never rebuilds the chart — only a repaint is needed
  // (and live setData ticks repaint anyway; the explicit redraw covers
  // edits while frozen/idle).
  const thresholdsRef = useRef(thresholds)
  const displayOrderRef = useRef(displayOrder)
  const fftModeRef = useRef(fftMode)
  // Markers/colours/timestamps are read by the uPlot draw hook (installed
  // once at chart build) — routing them through refs lets a marker move or
  // a colour change repaint without tearing the chart down.
  const markersRef = useRef(markers)
  const channelColorsRef = useRef(channelColors)
  const timestampsRef = useRef(timestamps)
  const measureModeRef = useRef(measureMode)
  useEffect(() => {
    thresholdsRef.current = thresholds
    plotRef.current?.redraw(false)
  }, [thresholds])
  useEffect(() => {
    displayOrderRef.current = displayOrder
  }, [displayOrder])
  useEffect(() => {
    fftModeRef.current = fftMode
  }, [fftMode])
  useEffect(() => {
    markersRef.current = markers
    plotRef.current?.redraw(false)
  }, [markers])
  useEffect(() => {
    channelColorsRef.current = channelColors
  }, [channelColors])
  useEffect(() => {
    timestampsRef.current = timestamps
  }, [timestamps])
  useEffect(() => {
    measureModeRef.current = measureMode
  }, [measureMode])

  // Threshold crossing alert: compares each threshold's channel-latest
  // sample against its state on the previous data tick (NOT the previous
  // sample — ingest appends whole line batches per tick, so sample-vs-
  // sample comparison would miss crossings that happen mid-batch).
  const wasAboveRef = useRef<Record<string, boolean>>({})
  useEffect(() => {
    for (const t of thresholds) {
      if (!t.enabled || !Number.isFinite(t.value)) continue
      const arr = displayData[t.channel]
      const last = arr && arr.length > 0 ? arr[arr.length - 1] : null
      if (last === null || last === undefined) continue
      const above = last > t.value
      if (wasAboveRef.current[t.id] === false && above) playBeep()
      wasAboveRef.current[t.id] = above
    }
  }, [displayData, thresholds])

  const buildAlignedData = (): uPlot.AlignedData => {
    if (fftMode) {
      if (!spectra) return [[], ...displayOrder.map(() => [])]
      return [spectra.frequencies, ...displayOrder.map((ch) => spectra.magnitudes[ch] ?? [])]
    }
    const firstAtMs = timestamps[0] ?? 0
    return [
      timestamps.map((ms) => (ms - firstAtMs) / 1000),
      ...displayOrder.map((ch) => displayData[ch] ?? []),
    ]
  }

  // A colour override changes a series' stroke, which uPlot bakes in at
  // build time — fold the overrides into the rebuild key so editing one
  // re-strokes the chart (color edits are infrequent, a rebuild is cheap).
  const colorsKey = displayOrder.map((ch, i) => colorFor(ch, i)).join(',')
  const channelKey = `${displayOrder.join(',')}|${chartType}|${fftMode}|${colorsKey}`

  // useLayoutEffect (not useEffect): reads the container's real, laid-out
  // pixel size before paint. Measuring in a plain useEffect risks a 0x0
  // read on the very first mount, which then makes uPlot render an
  // effectively invisible chart until something else triggers a resize.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    plotRef.current?.destroy()

    const axisStroke = themeColor('--text-muted', '#9aa1ac')
    const gridStroke = themeColor('--border', '#3a3d34')

    const opts: uPlot.Options = {
      width: Math.max(el.clientWidth, 200),
      height: Math.max(el.clientHeight - LEGEND_RESERVE_PX, 100),
      scales: { x: { time: false } },
      axes: [
        {
          label: fftMode ? 'Hz' : 'seconds',
          stroke: axisStroke,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: gridStroke },
        },
        {
          stroke: axisStroke,
          grid: { stroke: gridStroke, width: 1 },
          ticks: { stroke: gridStroke },
        },
      ],
      series: [
        {},
        ...displayOrder.map((ch, i) => {
          const color = colorFor(ch, i)
          return {
            label: ch,
            stroke: color,
            width: 1.5,
            show: !hiddenChannels.includes(ch),
            // FFT is always drawn as lines — bar/point/area styles are
            // time-domain presentation choices.
            ...seriesStyleFor(fftMode ? 'line' : chartType, color),
          }
        }),
      ],
      cursor: { drag: { x: true, y: false } },
      legend: { show: true },
      hooks: {
        draw: [
          (u) => {
            if (fftModeRef.current) return
            for (const t of thresholdsRef.current) {
              if (!t.enabled || !Number.isFinite(t.value)) continue
              const y = u.valToPos(t.value, 'y', true)
              if (y < u.bbox.top || y > u.bbox.top + u.bbox.height) continue
              const chIndex = displayOrderRef.current.indexOf(t.channel)
              const color =
                chIndex >= 0
                  ? (channelColorsRef.current[t.channel] ?? PALETTE[chIndex % PALETTE.length])
                  : '#888'
              u.ctx.save()
              u.ctx.strokeStyle = color
              u.ctx.setLineDash([6, 4])
              u.ctx.lineWidth = 1
              u.ctx.beginPath()
              u.ctx.moveTo(u.bbox.left, y)
              u.ctx.lineTo(u.bbox.left + u.bbox.width, y)
              u.ctx.stroke()
              u.ctx.restore()
            }
            // Measurement cursors: a solid vertical line per placed marker.
            const ts = timestampsRef.current
            const firstMs = ts[0] ?? 0
            const markerColor = themeColor('--accent', '#c4472b')
            for (const idx of [markersRef.current.a, markersRef.current.b]) {
              if (idx === null || idx < 0 || idx >= ts.length) continue
              const x = u.valToPos((ts[idx] - firstMs) / 1000, 'x', true)
              if (x < u.bbox.left || x > u.bbox.left + u.bbox.width) continue
              u.ctx.save()
              u.ctx.strokeStyle = markerColor
              u.ctx.lineWidth = 1
              u.ctx.beginPath()
              u.ctx.moveTo(x, u.bbox.top)
              u.ctx.lineTo(x, u.bbox.top + u.bbox.height)
              u.ctx.stroke()
              u.ctx.restore()
            }
          },
        ],
      },
    }

    const plot = new uPlot(opts, buildAlignedData(), el)
    plotRef.current = plot

    // Click-to-place a measurement marker (only while measure mode is on).
    // uPlot tracks the nearest data index under the cursor as `cursor.idx`;
    // the first two clicks set A then B, a third restarts from A.
    const handleMeasureClick = () => {
      if (!measureModeRef.current) return
      const idx = plot.cursor.idx
      if (idx === null || idx === undefined) return
      setMarkers((prev) => {
        if (prev.a === null) return { a: idx, b: null }
        if (prev.b === null) return { a: prev.a, b: idx }
        return { a: idx, b: null }
      })
    }
    plot.over.addEventListener('click', handleMeasureClick)

    return () => {
      plot.destroy()
      plotRef.current = null
    }
    // Re-create only when the set of channels, the chart type, or time/FFT
    // mode changes (all affect series count/paths/axes) or the container is
    // (re)mounted — data updates are pushed via setData below without
    // tearing the chart down, and visibility toggles use setSeries below
    // without tearing it down either.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelKey])

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    plot.setData(buildAlignedData())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timestamps, displayData, displayOrder, fftMode, spectra])

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    displayOrder.forEach((ch, i) => {
      plot.setSeries(i + 1, { show: !hiddenChannels.includes(ch) })
    })
  }, [hiddenChannels, displayOrder])

  // The dock is user-resizable (drag handle) and the window itself can
  // resize — uPlot needs an explicit setSize() call either way, it does not
  // follow its container's CSS size on its own.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) {
        plotRef.current?.setSize({ width, height: Math.max(height - LEGEND_RESERVE_PX, 100) })
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const resetZoom = () => {
    const plot = plotRef.current
    if (!plot) return
    if (fftMode) {
      // The x axis is frequency here — the timestamps-based reset below
      // would set a nonsense range.
      const maxHz = spectra ? spectra.frequencies[spectra.frequencies.length - 1] : 1
      plot.setScale('x', { min: 0, max: Math.max(maxHz, 1) })
      return
    }
    if (timestamps.length === 0) return
    const firstAtMs = timestamps[0]
    const lastAtMs = timestamps[timestamps.length - 1]
    plot.setScale('x', { min: 0, max: Math.max((lastAtMs - firstAtMs) / 1000, 1) })
  }

  const togglePanel = (panel: 'extractors' | 'math' | 'thresholds' | 'mqttFields') =>
    setOpenPanel((current) => (current === panel ? null : panel))

  const exportCsv = async () => {
    if (timestamps.length === 0) return
    const path = await save({
      title: t('plot.exportDataTitle'),
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    })
    if (!path) return
    const firstAtMs = timestamps[0]
    // epoch_ms correlates with other logs offline; time_s matches the chart.
    const lines = [`epoch_ms,time_s,${displayOrder.join(',')}`]
    for (let i = 0; i < timestamps.length; i++) {
      const cells = [
        String(timestamps[i]),
        ((timestamps[i] - firstAtMs) / 1000).toFixed(3),
        ...displayOrder.map((ch) => {
          const v = displayData[ch]?.[i]
          return v === null || v === undefined ? '' : String(v)
        }),
      ]
      lines.push(cells.join(','))
    }
    try {
      await invoke('write_text_file', { path, contents: lines.join('\n') + '\n' })
    } catch (err) {
      addToast('error', t('plot.exportCsvError', { message: String(err) }))
    }
  }

  const exportPng = async () => {
    const plot = plotRef.current
    if (!plot) return
    const path = await save({
      title: t('plot.exportImageTitle'),
      filters: [{ name: 'PNG', extensions: ['png'] }],
    })
    if (!path) return
    // uPlot's canvas is transparent — composite onto an opaque background
    // first, or a dark-theme export looks broken in any white viewer.
    // Known limit: uPlot's legend is HTML, not canvas, so it isn't included.
    const source = plot.ctx.canvas
    const composed = document.createElement('canvas')
    composed.width = source.width
    composed.height = source.height
    const ctx = composed.getContext('2d')
    if (!ctx) return
    ctx.fillStyle = themeColor('--panel', '#ffffff')
    ctx.fillRect(0, 0, composed.width, composed.height)
    ctx.drawImage(source, 0, 0)
    const blob = await new Promise<Blob | null>((resolve) => composed.toBlob(resolve, 'image/png'))
    if (!blob) return
    const data = Array.from(new Uint8Array(await blob.arrayBuffer()))
    try {
      await invoke('write_binary_file', { path, data })
    } catch (err) {
      addToast('error', t('plot.exportPngError', { message: String(err) }))
    }
  }

  return (
    <div className="plot-dock" style={{ height: dockHeight }}>
      <div className="toolbar">
        <select value={sourceTabId ?? ''} onChange={(e) => setSourceTabId(e.target.value || null)}>
          <option value="">{t('plot.selectSourceTab')}</option>
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.connectionLabel}
            </option>
          ))}
        </select>
        {!fftMode && (
          <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)}>
            {CHART_TYPE_VALUES.map((ct) => (
              <option key={ct} value={ct}>
                {t(`plot.chartType.${ct}`)}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={fftMode ? 'on' : ''}
          title={t('plot.fftTitle')}
          onClick={() => setFftMode(!fftMode)}
          disabled={!sourceTabId}
        >
          FFT
        </button>
        {fftMode && (
          <select
            value={fftWindow}
            title={t('plot.fftWindowTitle')}
            onChange={(e) => setFftWindow(e.target.value as FftWindow)}
          >
            {FFT_WINDOW_VALUES.map((w) => (
              <option key={w} value={w}>
                {t(`plot.fftWindow.${w}`)}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={frozen ? 'on' : ''}
          onClick={() => setFrozen(!frozen)}
          disabled={!sourceTabId}
        >
          {frozen ? t('plot.resume') : t('plot.freeze')}
        </button>
        <button type="button" onClick={resetZoom} disabled={!sourceTabId}>
          {t('plot.resetZoom')}
        </button>
        <button type="button" onClick={reset} disabled={!sourceTabId}>
          {t('monitor.clear')}
        </button>
        <button
          type="button"
          className={openPanel === 'extractors' || extractors.length > 0 ? 'on' : ''}
          onClick={() => togglePanel('extractors')}
        >
          <FilterIcon /> {t('plot.extractors')}
          {extractors.length > 0 ? ` (${extractors.length})` : ''}
        </button>
        <button
          type="button"
          className={openPanel === 'math' || mathChannels.length > 0 ? 'on' : ''}
          title={t('plot.mathTitle')}
          onClick={() => togglePanel('math')}
        >
          {t('plot.math')}
          {mathChannels.length > 0 ? ` (${mathChannels.length})` : ''}
        </button>
        <button
          type="button"
          className={openPanel === 'thresholds' || thresholds.length > 0 ? 'on' : ''}
          title={t('plot.levelsTitle')}
          onClick={() => togglePanel('thresholds')}
        >
          {t('plot.levels')}
          {thresholds.length > 0 ? ` (${thresholds.length})` : ''}
        </button>
        {sourceTab?.connectionKind === 'mqtt' && (
          <button
            type="button"
            className={openPanel === 'mqttFields' || mqttFields.length > 0 ? 'on' : ''}
            title={t('plot.mqttFieldsTitle')}
            onClick={() => togglePanel('mqttFields')}
          >
            {t('plot.mqttFields')}
            {mqttFields.length > 0 ? ` (${mqttFields.length})` : ''}
          </button>
        )}
        <button
          type="button"
          className={showStats ? 'on' : ''}
          title={t('plot.statsTitle')}
          onClick={() => setShowStats(!showStats)}
          disabled={fftMode}
        >
          {t('plot.stats')}
        </button>
        <button
          type="button"
          className={measureMode ? 'on' : ''}
          title={t('plot.measureTitle')}
          onClick={toggleMeasure}
          disabled={fftMode}
        >
          <TargetIcon /> {t('plot.measure')}
        </button>
        <button
          type="button"
          title={t('plot.csvTitle')}
          onClick={() => void exportCsv()}
          disabled={timestamps.length === 0}
        >
          CSV
        </button>
        <button
          type="button"
          title={t('plot.pngTitle')}
          onClick={() => void exportPng()}
          disabled={timestamps.length === 0}
        >
          PNG
        </button>
        <span className="line-count">
          {t('plot.pointCount', { count: timestamps.length.toLocaleString() })}
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label={t('plot.closePlotter')}
          onClick={() => setVisible(false)}
        >
          <XIcon />
        </button>
      </div>

      {openPanel === 'extractors' && (
        <div className="filter-bar">
          {extractors.map((extractor) => (
            <div className="filter-row" key={extractor.id}>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={extractor.enabled}
                  onChange={() => toggleExtractorEnabled(extractor.id)}
                />
              </label>
              <input
                type="text"
                placeholder={t('plot.extractorPatternPlaceholder')}
                value={extractor.pattern}
                onChange={(e) => updateExtractor(extractor.id, { pattern: e.target.value })}
              />
              <span>→</span>
              <input
                type="text"
                className="extractor-channel"
                placeholder={t('plot.channelNamePlaceholder')}
                value={extractor.channel}
                onChange={(e) => updateExtractor(extractor.id, { channel: e.target.value })}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={t('plot.removeExtractor')}
                onClick={() => removeExtractor(extractor.id)}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          <div className="filter-actions">
            <button type="button" onClick={addExtractor}>
              <PlusIcon /> {t('plot.addExtractor')}
            </button>
          </div>
        </div>
      )}

      {openPanel === 'math' && (
        <div className="filter-bar">
          {mathChannels.map((m) => {
            const opInfo = MATH_OPS.find((o) => o.value === m.op)
            return (
              <div className="filter-row" key={m.id}>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={m.enabled}
                    onChange={() => toggleMathChannelEnabled(m.id)}
                  />
                </label>
                <input
                  type="text"
                  className="extractor-channel"
                  placeholder={t('plot.labelPlaceholder')}
                  value={m.label}
                  onChange={(e) => updateMathChannel(m.id, { label: e.target.value })}
                />
                <select
                  value={m.op}
                  onChange={(e) =>
                    updateMathChannel(m.id, { op: e.target.value as (typeof m)['op'] })
                  }
                >
                  {MATH_OPS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  value={m.sourceA}
                  title={t('plot.sourceChannelA')}
                  onChange={(e) => updateMathChannel(m.id, { sourceA: e.target.value })}
                >
                  <option value="">A…</option>
                  {channelOrder.map((ch) => (
                    <option key={ch} value={ch}>
                      {ch}
                    </option>
                  ))}
                </select>
                {opInfo?.binary && (
                  <select
                    value={m.sourceB ?? ''}
                    title={t('plot.sourceChannelB')}
                    onChange={(e) => updateMathChannel(m.id, { sourceB: e.target.value })}
                  >
                    <option value="">B…</option>
                    {channelOrder.map((ch) => (
                      <option key={ch} value={ch}>
                        {ch}
                      </option>
                    ))}
                  </select>
                )}
                {opInfo?.windowed && (
                  <input
                    type="number"
                    className="math-window"
                    title={t('plot.windowSamples')}
                    value={m.window ?? 10}
                    onChange={(e) =>
                      updateMathChannel(m.id, { window: Math.max(1, Number(e.target.value)) })
                    }
                  />
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label={t('plot.removeMathChannel')}
                  onClick={() => removeMathChannel(m.id)}
                >
                  <TrashIcon />
                </button>
              </div>
            )
          })}
          <div className="filter-actions">
            <button type="button" onClick={addMathChannel}>
              <PlusIcon /> {t('plot.addMathChannel')}
            </button>
          </div>
        </div>
      )}

      {openPanel === 'thresholds' && (
        <div className="filter-bar">
          {thresholds.map((th) => (
            <div className="filter-row" key={th.id}>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={th.enabled}
                  onChange={() => toggleThresholdEnabled(th.id)}
                />
              </label>
              <select
                value={th.channel}
                title={t('plot.channelToWatch')}
                onChange={(e) => updateThreshold(th.id, { channel: e.target.value })}
              >
                <option value="">{t('plot.channelPlaceholder')}</option>
                {displayOrder.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch}
                  </option>
                ))}
              </select>
              <span>&gt;</span>
              <input
                type="number"
                title={t('plot.alertLevel')}
                value={th.value}
                onChange={(e) => updateThreshold(th.id, { value: Number(e.target.value) })}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={t('plot.removeThreshold')}
                onClick={() => removeThreshold(th.id)}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          <div className="filter-actions">
            <button type="button" onClick={addThreshold}>
              <PlusIcon /> {t('plot.addLevel')}
            </button>
          </div>
        </div>
      )}

      {openPanel === 'mqttFields' && (
        <div className="filter-bar">
          {mqttFields.length === 0 && (
            <p className="plot-mqtt-fields-empty">{t('plot.mqttFieldsEmpty')}</p>
          )}
          {mqttFields.map((f) => (
            <div className="filter-row" key={f.id}>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={f.enabled}
                  onChange={() => toggleMqttFieldEnabled(f.id)}
                />
              </label>
              <span className="mono mqtt-field-topic" title={f.topic}>
                {f.topic}
              </span>
              <span className="mono">{f.path}</span>
              <button
                type="button"
                className="icon-button"
                aria-label={t('plot.removeMqttField')}
                onClick={() => removeMqttField(f.id)}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
        </div>
      )}

      {displayOrder.length > 0 && (
        <div className="plot-channels">
          {displayOrder.map((ch, i) => (
            // A <div>, not a <label>: the colour picker sits inside, and a
            // wrapping label would toggle visibility every time the picker
            // is clicked.
            <div key={ch} className="plot-channel-toggle">
              <input
                type="checkbox"
                checked={!hiddenChannels.includes(ch)}
                onChange={() => toggleChannelVisibility(ch)}
                aria-label={ch}
              />
              <input
                type="color"
                className="plot-channel-color"
                value={colorFor(ch, i)}
                title={t('plot.channelColorTitle')}
                onChange={(e) => setChannelColor(ch, e.target.value)}
              />
              <span>{ch}</span>
            </div>
          ))}
        </div>
      )}

      {stats && stats.length > 0 && (
        <div className="plot-stats">
          {stats.map(({ ch, m }) => (
            <span key={ch} className="plot-stat">
              <b>{ch}</b>
              {m ? (
                <>
                  {' '}
                  {t('plot.statLine', {
                    min: formatStat(m.min),
                    max: formatStat(m.max),
                    avg: formatStat(m.avg),
                    pp: formatStat(m.peakToPeak),
                    freq: m.frequencyHz !== null ? `${formatStat(m.frequencyHz)} Hz` : '— Hz',
                  })}
                </>
              ) : (
                ` ${t('plot.noData')}`
              )}
            </span>
          ))}
        </div>
      )}

      {measureMode && (
        <div className="plot-measure-readout">
          {measurement ? (
            <>
              <span className="plot-measure-delta">
                Δt {formatStat(measurement.dt)} s
                {measurement.freq !== null ? ` · ${formatStat(measurement.freq)} Hz` : ''}
              </span>
              {measurement.channels.map(({ ch, dy }) => (
                <span key={ch} className="plot-stat">
                  <b>{ch}</b> Δ{dy !== null ? formatStat(dy) : '—'}
                </span>
              ))}
            </>
          ) : (
            <span className="plot-measure-hint">{t('plot.measureHint')}</span>
          )}
        </div>
      )}

      <div className="plot-canvas" ref={containerRef} />
    </div>
  )
}
