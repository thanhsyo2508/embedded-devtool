# G0-T4 benchmark results

Tracks progress against the Giai đoạn 0 DoD: *"PoC đọc serial 2 Mbps liên tục 10 phút, 0 byte drop, CPU < 15%"* — see [ke-hoach-chi-tiet-giai-doan-0-1.md](ke-hoach-chi-tiet-giai-doan-0-1.md#g0-t4).

## Synthetic pipeline benchmark — done

`cargo run --release --example pipeline_benchmark -- 250000 20` (no hardware; validates the reader→channel→pump→ring-buffer architecture described in [ADR-004](adr/004-datastream-trait.md)).

- 2026-07-03: 20s @ ~2 Mbps (250,000 B/s) — **4,849,664 / 4,849,664 bytes received, 0 drop.** Ring buffer correctly capped at its 1 MiB capacity once full (steady state from t=5s onward), confirming ingestion is never blocked by the bounded display buffer.
- No further synthetic runs needed: the pipeline has no time-dependent state (bounded ring buffer, no accumulation outside it), so a longer synthetic run would not add information beyond this steady-state result.

## Hardware loopback benchmark — pending, needs to run on a machine with a USB-UART adapter attached

`cargo run --release --example serial_loopback_benchmark -- <PORT> 2000000 600`

This exercises the real `SerialStream` (not the synthetic stand-in above) against actual OS serial I/O. Requires a USB-UART adapter (CP210x, CH340, or FTDI per the plan's risk list) with **TX and RX pins bridged with a jumper wire** — no target firmware needed, the tool writes and reads back its own pattern.

Not run yet — no serial hardware attached in this environment. To close out G0-T4:
1. Plug in a USB-UART adapter, bridge TX/RX.
2. Find its port name (the tool prints available ports if you omit the argument).
3. Run the command above for the full 600s.
4. Watch Task Manager (Windows) / `top` during the run for CPU% of the `serial_loopback_benchmark` process — target < 15%.
5. Record the PASS/FAIL output and CPU figure here.
