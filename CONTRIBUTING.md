# Contributing

## Project layout

```
src/                  React + TypeScript frontend (Vite)
src-tauri/
  src/
    main.rs           binary entry point — must stay a thin call into lib.rs
    lib.rs            Tauri app builder, command registration
    core/              Rust core: transport-agnostic building blocks
      event_bus.rs     pub/sub Event bus (ADR-003)
      data_stream.rs   DataStream trait — the interface every transport implements (ADR-004)
      serial_stream.rs first DataStream impl (serial)
      ring_buffer.rs   bounded byte buffer used for display/read()
  examples/            standalone benchmark/debug binaries (`cargo run --example <name>`)
docs/
  adr/                 Architecture Decision Records — one file per hard-to-reverse decision
  ke-hoach-*.md        product/roadmap plans (Vietnamese)
```

New modules (TCP/UDP, MQTT, script engine, flash manager, …) live under
`src-tauri/src/` as siblings of `core/`, and talk to existing modules only
through the `EventBus` / `DataStream` trait — never by importing each
other's internals directly. This is the architecture principle in
[docs/ke-hoach-phat-trien-embedded-devtool.md](docs/ke-hoach-phat-trien-embedded-devtool.md)
§2.2, and the reasoning is in `docs/adr/`.

## Before opening a PR

```bash
# Rust
cargo fmt --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --lib

# Frontend
npm run lint
npm run format:check
npx tsc --noEmit
```

All of the above run in CI (`.github/workflows/ci.yml`) and block merge on
failure. Run them locally first — CI matrix builds (Windows/Linux/macOS
installers) only start after this fast gate passes.

## Conventions

- **Rust**: one file per concept under `core/` (or a future module
  directory); trait implementations get their own file even if small.
  Prefer explicit `io::Result` over `unwrap()` outside of tests/examples.
- **TypeScript**: function components + hooks only, no class components.
  Formatting is Prettier's defaults except `semi: false, singleQuote: true`
  (see `.prettierrc.json`) — don't hand-format, run `npm run format`.
- **Commits**: short imperative subject line (`Add serial port enumeration`,
  not `Added` / `Adds`). Reference the task code from the detailed plan when
  applicable (e.g. `M1-T1.1`) so it's traceable to
  [docs/ke-hoach-chi-tiet-giai-doan-0-1.md](docs/ke-hoach-chi-tiet-giai-doan-0-1.md).
- **ADRs**: add one under `docs/adr/NNN-title.md` for any decision that is
  expensive to reverse later (new core dependency, cross-module interface,
  data format) — follow the existing files' Context/Decision/Consequences
  shape.
- **Scope discipline**: don't pull features from a later Giai đoạn into the
  current one (see the plan's risk table, "Scope creep"). If something
  outside the current phase seems necessary, flag it instead of building it.
