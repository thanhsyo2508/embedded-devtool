# ADR-002: Frontend framework = React + TypeScript

- Status: Accepted
- Date: 2026-07-03

## Context

The main plan (§2.1) left React vs Svelte open. The UI needs: virtualized rendering
for 100k+ line log buffers, drag-drop panel layout (custom layout is a committed
Giai đoạn 3 feature, so the choice must not block it), a WebGL/uPlot-based realtime
plotter, and a syntax-highlighted script editor. This is ADR-001's companion
decision from [ke-hoach-chi-tiet-giai-doan-0-1.md](../ke-hoach-chi-tiet-giai-doan-0-1.md)
task G0-T2, called out there as a decision that should not be revisited later.

## Decision

Use **React + TypeScript**, scaffolded via `create-tauri-app` (`react-ts` template).

Reasons:
- Largest ecosystem for the specific widgets this app needs: `react-window`/
  `react-virtualized` for log virtualization, `dnd-kit`/`react-dnd` for panel
  drag-drop, mature uPlot/Monaco/CodeMirror React bindings for the plotter and
  script editor.
- Most Tauri examples/community content targets React, lowering the cost of
  debugging Tauri-specific IPC issues.
- Larger hiring/contributor pool if the team grows past 1 dev (plan assumes this is
  possible per §0 "Nhân lực giả định").

Svelte was the runner-up (smaller bundles, better raw list-rendering perf) but would
require hand-rolling virtualization and drag-drop, increasing near-term risk during
the MVP window (Tháng 1–3) where the priority is shipping a working Beta, not
minimizing bundle size.

## Consequences

- All frontend code (monitor tabs, plotter, flash panel, script editor) is React
  function components + hooks; no framework mixing.
- State that needs to survive across tabs/panels (open ports, active project) should
  be lifted to a single store (Zustand or Context+reducer — to be decided when the
  panel/tab state shape is designed in Tháng 1 Tuần 3) rather than prop-drilled.
- Bundle size is not a v1 concern; revisit only if startup time becomes a measured
  problem.
