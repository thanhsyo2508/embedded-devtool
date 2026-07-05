import { useLayoutEffect, useEffect, useMemo, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { usePlotStore, type ChartType } from '../state/plotStore'
import { useTabsStore } from '../state/tabsStore'
import { computeSpectrum, type FftWindow } from '../lib/fft'
import { computeMathChannel, MATH_OPS } from '../lib/plotMath'
import { measure } from '../lib/plotMeasure'
import { playBeep } from '../lib/beep'
import { FilterIcon, PlusIcon, TrashIcon, XIcon } from './icons'

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

const CHART_TYPES: { value: ChartType; label: string }[] = [
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'step', label: 'Step' },
  { value: 'bars', label: 'Bars' },
  { value: 'points', label: 'Points' },
]

const FFT_WINDOWS: { value: FftWindow; label: string }[] = [
  { value: 'none', label: 'Rectangular' },
  { value: 'hann', label: 'Hann' },
  { value: 'hamming', label: 'Hamming' },
]

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

export function PlotDock() {
  const tabs = useTabsStore((s) => s.tabs)
  const {
    sourceTabId,
    frozen,
    channelOrder,
    channelData,
    timestamps,
    dockHeight,
    hiddenChannels,
    chartType,
    extractors,
    mathChannels,
    thresholds,
    fftMode,
    fftWindow,
    showStats,
    setSourceTabId,
    setFrozen,
    reset,
    ingest,
    setVisible,
    toggleChannelVisibility,
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
  } = usePlotStore()
  const sourceTab = tabs.find((t) => t.id === sourceTabId) ?? null
  const [openPanel, setOpenPanel] = useState<'extractors' | 'math' | 'thresholds' | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)

  useEffect(() => {
    if (!sourceTab) return
    ingest(sourceTab)
  }, [sourceTab, ingest])

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

  // Threshold lines are drawn from a mutable ref inside the uPlot draw hook
  // so editing a value never rebuilds the chart — only a repaint is needed
  // (and live setData ticks repaint anyway; the explicit redraw covers
  // edits while frozen/idle).
  const thresholdsRef = useRef(thresholds)
  const displayOrderRef = useRef(displayOrder)
  const fftModeRef = useRef(fftMode)
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
      timestamps.map((t) => (t - firstAtMs) / 1000),
      ...displayOrder.map((ch) => displayData[ch] ?? []),
    ]
  }

  const channelKey = `${displayOrder.join(',')}|${chartType}|${fftMode}`

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
          const color = PALETTE[i % PALETTE.length]
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
              const color = chIndex >= 0 ? PALETTE[chIndex % PALETTE.length] : '#888'
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
          },
        ],
      },
    }

    const plot = new uPlot(opts, buildAlignedData(), el)
    plotRef.current = plot

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

  const togglePanel = (panel: 'extractors' | 'math' | 'thresholds') =>
    setOpenPanel((current) => (current === panel ? null : panel))

  const exportCsv = async () => {
    if (timestamps.length === 0) return
    const path = await save({
      title: 'Export plot data',
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
    await invoke('write_text_file', { path, contents: lines.join('\n') + '\n' })
  }

  const exportPng = async () => {
    const plot = plotRef.current
    if (!plot) return
    const path = await save({
      title: 'Export plot image',
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
    await invoke('write_binary_file', { path, data })
  }

  return (
    <div className="plot-dock" style={{ height: dockHeight }}>
      <div className="toolbar">
        <select value={sourceTabId ?? ''} onChange={(e) => setSourceTabId(e.target.value || null)}>
          <option value="">Select source tab…</option>
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.connectionLabel}
            </option>
          ))}
        </select>
        {!fftMode && (
          <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)}>
            {CHART_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={fftMode ? 'on' : ''}
          title="Frequency-domain view (FFT of the current buffer)"
          onClick={() => setFftMode(!fftMode)}
          disabled={!sourceTabId}
        >
          FFT
        </button>
        {fftMode && (
          <select
            value={fftWindow}
            title="FFT window function"
            onChange={(e) => setFftWindow(e.target.value as FftWindow)}
          >
            {FFT_WINDOWS.map((w) => (
              <option key={w.value} value={w.value}>
                {w.label}
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
          {frozen ? 'Resume' : 'Freeze'}
        </button>
        <button type="button" onClick={resetZoom} disabled={!sourceTabId}>
          Reset zoom
        </button>
        <button type="button" onClick={reset} disabled={!sourceTabId}>
          Clear
        </button>
        <button
          type="button"
          className={openPanel === 'extractors' || extractors.length > 0 ? 'on' : ''}
          onClick={() => togglePanel('extractors')}
        >
          <FilterIcon /> Extractors{extractors.length > 0 ? ` (${extractors.length})` : ''}
        </button>
        <button
          type="button"
          className={openPanel === 'math' || mathChannels.length > 0 ? 'on' : ''}
          title="Derived channels computed from existing ones"
          onClick={() => togglePanel('math')}
        >
          Math{mathChannels.length > 0 ? ` (${mathChannels.length})` : ''}
        </button>
        <button
          type="button"
          className={openPanel === 'thresholds' || thresholds.length > 0 ? 'on' : ''}
          title="Horizontal alert levels — beep when a channel crosses one upward"
          onClick={() => togglePanel('thresholds')}
        >
          Levels{thresholds.length > 0 ? ` (${thresholds.length})` : ''}
        </button>
        <button
          type="button"
          className={showStats ? 'on' : ''}
          title="Per-channel min/max/avg/peak-to-peak/frequency"
          onClick={() => setShowStats(!showStats)}
          disabled={fftMode}
        >
          Stats
        </button>
        <button
          type="button"
          title="Export the whole buffer (including math channels) as CSV"
          onClick={() => void exportCsv()}
          disabled={timestamps.length === 0}
        >
          CSV
        </button>
        <button
          type="button"
          title="Export the chart as a PNG image (legend not included)"
          onClick={() => void exportPng()}
          disabled={timestamps.length === 0}
        >
          PNG
        </button>
        <span className="line-count">{timestamps.length.toLocaleString()} pts</span>
        <button
          type="button"
          className="icon-button"
          aria-label="Close plotter"
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
                placeholder="regex with one capture group, e.g. temp=(\d+\.\d+)"
                value={extractor.pattern}
                onChange={(e) => updateExtractor(extractor.id, { pattern: e.target.value })}
              />
              <span>→</span>
              <input
                type="text"
                className="extractor-channel"
                placeholder="channel name"
                value={extractor.channel}
                onChange={(e) => updateExtractor(extractor.id, { channel: e.target.value })}
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Remove extractor"
                onClick={() => removeExtractor(extractor.id)}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          <div className="filter-actions">
            <button type="button" onClick={addExtractor}>
              <PlusIcon /> Add extractor
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
                  placeholder="label"
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
                  title="Source channel A"
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
                    title="Source channel B"
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
                    title="Window (samples)"
                    value={m.window ?? 10}
                    onChange={(e) =>
                      updateMathChannel(m.id, { window: Math.max(1, Number(e.target.value)) })
                    }
                  />
                )}
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove math channel"
                  onClick={() => removeMathChannel(m.id)}
                >
                  <TrashIcon />
                </button>
              </div>
            )
          })}
          <div className="filter-actions">
            <button type="button" onClick={addMathChannel}>
              <PlusIcon /> Add math channel
            </button>
          </div>
        </div>
      )}

      {openPanel === 'thresholds' && (
        <div className="filter-bar">
          {thresholds.map((t) => (
            <div className="filter-row" key={t.id}>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={t.enabled}
                  onChange={() => toggleThresholdEnabled(t.id)}
                />
              </label>
              <select
                value={t.channel}
                title="Channel to watch"
                onChange={(e) => updateThreshold(t.id, { channel: e.target.value })}
              >
                <option value="">Channel…</option>
                {displayOrder.map((ch) => (
                  <option key={ch} value={ch}>
                    {ch}
                  </option>
                ))}
              </select>
              <span>&gt;</span>
              <input
                type="number"
                title="Alert level"
                value={t.value}
                onChange={(e) => updateThreshold(t.id, { value: Number(e.target.value) })}
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Remove threshold"
                onClick={() => removeThreshold(t.id)}
              >
                <TrashIcon />
              </button>
            </div>
          ))}
          <div className="filter-actions">
            <button type="button" onClick={addThreshold}>
              <PlusIcon /> Add level
            </button>
          </div>
        </div>
      )}

      {displayOrder.length > 0 && (
        <div className="plot-channels">
          {displayOrder.map((ch, i) => (
            <label key={ch} className="plot-channel-toggle">
              <input
                type="checkbox"
                checked={!hiddenChannels.includes(ch)}
                onChange={() => toggleChannelVisibility(ch)}
              />
              <span
                className="plot-channel-swatch"
                style={{ background: PALETTE[i % PALETTE.length] }}
              />
              <span>{ch}</span>
            </label>
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
                  min {formatStat(m.min)} · max {formatStat(m.max)} · avg {formatStat(m.avg)} · p-p{' '}
                  {formatStat(m.peakToPeak)} ·{' '}
                  {m.frequencyHz !== null ? `${formatStat(m.frequencyHz)} Hz` : '— Hz'}
                </>
              ) : (
                ' no data'
              )}
            </span>
          ))}
        </div>
      )}

      <div className="plot-canvas" ref={containerRef} />
    </div>
  )
}
