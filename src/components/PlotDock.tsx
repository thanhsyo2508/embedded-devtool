import { useLayoutEffect, useEffect, useRef } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { usePlotStore, type ChartType } from '../state/plotStore'
import { useTabsStore } from '../state/tabsStore'
import { XIcon } from './icons'

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
    setSourceTabId,
    setFrozen,
    reset,
    ingest,
    setVisible,
    toggleChannelVisibility,
    setChartType,
  } = usePlotStore()
  const sourceTab = tabs.find((t) => t.id === sourceTabId) ?? null

  const containerRef = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)

  useEffect(() => {
    if (!sourceTab) return
    ingest(sourceTab)
  }, [sourceTab, ingest])

  const channelKey = `${channelOrder.join(',')}|${chartType}`

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
          label: 'seconds',
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
        ...channelOrder.map((ch, i) => {
          const color = PALETTE[i % PALETTE.length]
          return {
            label: ch,
            stroke: color,
            width: 1.5,
            show: !hiddenChannels.includes(ch),
            ...seriesStyleFor(chartType, color),
          }
        }),
      ],
      cursor: { drag: { x: true, y: false } },
      legend: { show: true },
    }

    const firstAtMs = timestamps[0] ?? 0
    const alignedData: uPlot.AlignedData = [
      timestamps.map((t) => (t - firstAtMs) / 1000),
      ...channelOrder.map((ch) => channelData[ch] ?? []),
    ]

    const plot = new uPlot(opts, alignedData, el)
    plotRef.current = plot

    return () => {
      plot.destroy()
      plotRef.current = null
    }
    // Re-create only when the set of channels or the chart type changes
    // (both affect series count/paths) or the container is (re)mounted —
    // data updates are pushed via setData below without tearing the chart
    // down, and visibility toggles use setSeries below without tearing it
    // down either.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelKey])

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    const firstAtMs = timestamps[0] ?? 0
    const alignedData: uPlot.AlignedData = [
      timestamps.map((t) => (t - firstAtMs) / 1000),
      ...channelOrder.map((ch) => channelData[ch] ?? []),
    ]
    plot.setData(alignedData)
  }, [timestamps, channelData, channelOrder])

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    channelOrder.forEach((ch, i) => {
      plot.setSeries(i + 1, { show: !hiddenChannels.includes(ch) })
    })
  }, [hiddenChannels, channelOrder])

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
    if (!plot || timestamps.length === 0) return
    const firstAtMs = timestamps[0]
    const lastAtMs = timestamps[timestamps.length - 1]
    plot.setScale('x', { min: 0, max: Math.max((lastAtMs - firstAtMs) / 1000, 1) })
  }

  return (
    <div className="plot-dock" style={{ height: dockHeight }}>
      <div className="toolbar">
        <select value={sourceTabId ?? ''} onChange={(e) => setSourceTabId(e.target.value || null)}>
          <option value="">Select source tab…</option>
          {tabs.map((tab) => (
            <option key={tab.id} value={tab.id}>
              {tab.portName} · {tab.baudRate}
            </option>
          ))}
        </select>
        <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)}>
          {CHART_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
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

      {channelOrder.length > 0 && (
        <div className="plot-channels">
          {channelOrder.map((ch, i) => (
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

      <div className="plot-canvas" ref={containerRef} />
    </div>
  )
}
