# Kế hoạch phát triển Embedded DevTool

**Phần mềm tổng hợp công cụ phát triển nhúng: nạp ESP32/STM32, serial monitor, plotter, TCP/UDP**

- Phiên bản kế hoạch: 1.0
- Ngày lập: 03/07/2026
- Tổng thời gian: 12 tháng (3 giai đoạn chính + 1 giai đoạn chuẩn bị)
- Nhân lực giả định: 1 dev full-time (với 2–3 người có thể rút xuống 7–8 tháng)

---

## 1. Tổng quan sản phẩm

### 1.1. Tầm nhìn

Xây dựng một công cụ desktop "all-in-one" cho lập trình viên embedded, thay thế việc phải mở 4–5 phần mềm rời rạc (esptool, STM32CubeProgrammer, CoolTerm/PuTTY, Hercules, Arduino Serial Plotter) bằng một ứng dụng duy nhất, với các tính năng phân tích và tự động hóa nâng cao mà các tool hiện tại không có.

### 1.2. Đối tượng người dùng

| Nhóm | Nhu cầu chính |
|---|---|
| Sinh viên, hobbyist | Flash + monitor đơn giản, miễn phí, dễ dùng |
| Dev embedded chuyên nghiệp | Scripting, phân tích log, FFT, multi-device |
| Doanh nghiệp sản xuất | Batch flash, mass production, CI/CD, test tự động |

### 1.3. Điểm khác biệt so với tool hiện có

- **PlatformIO**: mạnh về build/flash nhưng monitor và plotter yếu, không có TCP/UDP tool.
- **CoolTerm / PuTTY / Tera Term**: chỉ serial, không phân tích, không scripting mạnh.
- **Hercules**: chỉ TCP/UDP, UI cũ, không phát triển tiếp.
- **STM32CubeProgrammer GUI**: chỉ STM32, không tích hợp monitor.

Điểm khác biệt cốt lõi: **scripting engine (Lua) + trigger/action + FFT plotter + data pipeline nối liền các module** (dữ liệu từ serial/TCP/UDP đều đổ được vào cùng monitor và plotter).

---

## 2. Kiến trúc kỹ thuật

### 2.1. Tech stack

| Thành phần | Lựa chọn | Lý do |
|---|---|---|
| Framework desktop | Tauri 2.x | Nhẹ (~10MB vs Electron ~150MB), Rust backend hiệu năng cao, cross-platform |
| Backend | Rust | Serial I/O và networking an toàn, không GC pause, ring buffer hiệu quả |
| Frontend | React hoặc Svelte + TypeScript | UI phức tạp (multi-tab, drag-drop layout), hệ sinh thái lớn |
| Plotter | uPlot + WebGL (hoặc custom WebGL renderer) | Render hàng triệu điểm realtime |
| Scripting | Lua nhúng qua `mlua` | Nhẹ, sandbox an toàn, API đơn giản cho user |
| Serial | `serialport-rs` | Cross-platform, ổn định |
| ESP32 flash | `esptool` (bundle) hoặc `espflash` (Rust native) | Ưu tiên espflash để tránh phụ thuộc Python |
| STM32 flash | Wrapper `STM32_Programmer_CLI` | Không được redistribute — detect bản cài của user |
| MQTT | `rumqttc` | Client MQTT thuần Rust |

### 2.2. Nguyên tắc kiến trúc lõi (quyết định khó sửa về sau)

1. **Message bus nội bộ**: mọi module giao tiếp qua event bus (pub/sub), không gọi trực tiếp lẫn nhau. Cho phép thêm module mới mà không sửa module cũ.
2. **Data source abstraction**: serial, TCP, UDP, MQTT, file replay đều là `DataStream` với interface thống nhất (`open / close / read / write / on_data`). Monitor và plotter không cần biết dữ liệu đến từ đâu.
3. **Ring buffer phía Rust**: dữ liệu tốc độ cao được đệm trong Rust, gửi sang frontend theo batch (60fps), tránh nghẽn IPC.
4. **Mọi thao tác đều có API**: UI chỉ là một client của core API — nền tảng cho CLI mode và REST API sau này.
5. **Cấu hình dạng project file** (JSON/TOML): COM port, baudrate, flash profile, script — commit được vào git.

### 2.3. Sơ đồ khối

```
┌────────────────────────────── Frontend (WebView) ──────────────────────────────┐
│  Monitor tabs │ Plotter │ Flash panel │ TCP/UDP panel │ Script editor │ Layout │
└──────────────────────────────────┬─────────────────────────────────────────────┘
                            Tauri IPC (batch, 60fps)
┌──────────────────────────────────┴─────────────────────────────────────────────┐
│                              Rust Core                                          │
│  ┌───────────┐  ┌────────────┐  ┌──────────────┐  ┌───────────┐               │
│  │ Event bus │  │ DataStream │  │ Script engine│  │ Flash mgr │               │
│  │ (pub/sub) │  │ abstraction│  │ (Lua/mlua)   │  │ (subproc) │               │
│  └───────────┘  └─────┬──────┘  └──────────────┘  └─────┬─────┘               │
│                       │                                  │                      │
│         ┌─────────────┼──────────────┐          ┌───────┴────────┐            │
│      serialport    TCP/UDP        rumqttc       esptool/espflash │            │
│                                                  STM32_Prog_CLI  │            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Giai đoạn 0 — Chuẩn bị (2 tuần)

### Mục tiêu
Chốt nền tảng kỹ thuật, dựng khung dự án, tránh phải đập đi xây lại.

### Công việc

| Tuần | Công việc | Kết quả |
|---|---|---|
| 1 | Chốt tech stack, PoC Tauri + serialport-rs: đọc serial 2Mbps không drop | Bản PoC benchmark throughput |
| 1 | Thiết kế event bus + DataStream trait, viết ADR (Architecture Decision Record) | Tài liệu kiến trúc |
| 2 | Setup monorepo, CI build 3 OS (GitHub Actions), code convention, lint | Pipeline build tự động |
| 2 | Thiết kế UI wireframe: layout tổng thể, multi-tab, panel system | Figma wireframe |

### Tiêu chí hoàn thành (Definition of Done)
- PoC đọc serial 2Mbps liên tục 10 phút, 0 byte drop, CPU < 15%.
- CI build ra installer chạy được trên Windows 10/11, Ubuntu 22.04, macOS.

---

## 4. Giai đoạn 1 — MVP (tháng 1–3) → Phát hành Beta

### 4.1. Tháng 1 — Lõi serial monitor

**Tuần 1–2:**
- Serial port manager: enumerate ports (kèm tên thiết bị, VID/PID), open/close, cấu hình đầy đủ (baudrate, data bits, parity, stop bits, flow control).
- Auto-reconnect khi thiết bị rút ra cắm lại (theo VID/PID + serial number).
- Ring buffer + batch IPC sang frontend.

**Tuần 3–4:**
- UI monitor: multi-tab (mỗi tab một port), virtualized rendering (chỉ render dòng đang hiển thị).
- Hex / ASCII / Mixed view, timestamp mỗi dòng (tùy chọn ms hoặc delta).
- Send panel: gửi text/hex, line ending (None/CR/LF/CRLF), lịch sử lệnh (mũi tên lên).
- Log to file: raw + có timestamp, rotation theo dung lượng.
- Auto-scroll thông minh (dừng khi user cuộn lên, nút "jump to bottom").

**DoD tháng 1:** mở 4 port đồng thời ở 921600 baud, UI mượt, không drop, không leak memory sau 1 giờ chạy.

### 4.2. Tháng 2 — Flash tools

**Tuần 1–2 (ESP32):**
- Tích hợp espflash (ưu tiên) hoặc bundle esptool.
- Auto-detect chip (ESP32/S2/S3/C3/C6), đọc MAC, flash size.
- Flash firmware: chọn file .bin, offset, baudrate; progress bar; verify sau nạp.
- Erase flash, read flash region.
- **Flash profile**: lưu bộ (files + offsets + options) thành profile tái sử dụng, gắn với project.

**Tuần 3–4 (STM32):**
- Detect đường dẫn STM32_Programmer_CLI (registry/PATH/vị trí mặc định); nếu chưa cài, hướng dẫn user tải STM32CubeProgrammer.
- Flash qua ST-Link và UART bootloader; auto-detect MCU family.
- Parse output CLI (progress %, lỗi) — viết parser chịu được thay đổi format giữa các version.
- Mass erase, đọc/ghi option bytes cơ bản (kèm cảnh báo RDP).

**DoD tháng 2:** flash thành công ESP32-S3 và STM32F4/G0 từ UI, hiển thị progress chính xác, báo lỗi rõ ràng khi sai wiring/không vào bootloader.

### 4.3. Tháng 3 — Plotter cơ bản + phát hành Beta

**Tuần 1–2:**
- Plotter realtime đa kênh (tối đa 8 kênh ở MVP).
- Auto-parse: CSV (`1.2,3.4`), space-separated, `key:value`, Arduino plotter format.
- Zoom/pan bằng chuột, freeze, cursor crosshair hiển thị giá trị.
- Nối trực tiếp với tab monitor (chọn tab làm nguồn dữ liệu).

**Tuần 3–4:**
- Polish UI: dark/light theme, phím tắt, settings.
- Installer: MSI/NSIS (Windows), AppImage + deb (Linux), dmg (macOS). Code signing Windows nếu có ngân sách (~$300/năm).
- Docs: hướng dẫn cài đặt, quickstart cho từng module.
- **Phát hành Beta**: GitHub Releases + landing page đơn giản. Kênh quảng bá: cộng đồng embedded Việt Nam (Cộng đồng ARM Việt Nam, Điện tử Việt), r/embedded, r/esp32, Hackaday, Hacker News.
- Gắn kênh feedback: GitHub Issues + form trong app.

**DoD Beta:** người lạ cài và flash được ESP32 trong vòng 5 phút không cần đọc docs.

---

## 5. Giai đoạn 2 — Tính năng nâng cao (tháng 4–7) → v1.0

### 5.1. Tháng 4 — Phân tích cho monitor

- Color-coded log levels: tự nhận `E/W/I/D/V` (ESP-IDF), `[ERROR]/[WARN]` và pattern tùy chỉnh.
- Regex filter: include/exclude, nhiều filter xếp chồng, highlight match, đếm số match.
- Statistics panel: bytes/s, lines/s, error count, uptime kết nối.
- **Data extractor**: định nghĩa regex có capture group để trích số từ log → đẩy thẳng vào plotter (ví dụ: `temp=(\d+\.\d+)` → kênh "temp").
- Search trong buffer (Ctrl+F), bookmark dòng.

### 5.2. Tháng 5 — Scripting engine

- Nhúng Lua qua mlua, sandbox (giới hạn io/os, timeout mỗi callback).
- **API script v1** (cam kết ổn định từ đây):
  - `on_data(line)` — callback mỗi dòng nhận được
  - `send(text)`, `send_hex(bytes)`
  - `wait_for(pattern, timeout)` — expect-style
  - `log(msg)`, `alert(msg)`, `plot(channel, value)`
  - `timer(interval, fn)` — gửi định kỳ
- **Trigger/Action UI** (không cần viết code): khi nhận pattern X → gửi Y / phát âm thanh / ghi file / đánh dấu dòng.
- Macro recorder: ghi lại chuỗi lệnh đã gửi, replay với delay tùy chỉnh.
- Script editor trong app: syntax highlight, chạy/dừng, console lỗi.

### 5.3. Tháng 6 — Network tools

- TCP client/server, UDP unicast/broadcast/multicast — dùng chung UI monitor (nhờ DataStream abstraction, filter/script/plotter hoạt động ngay với nguồn mạng).
- WebSocket client/server.
- MQTT client: connect broker (TLS), subscribe nhiều topic, publish, hiển thị dạng cây topic.
- Protocol templates: định nghĩa frame nhị phân (header, length, checksum) để gửi nhanh; template mẫu cho Modbus TCP.
- mDNS/DNS-SD browser: quét thiết bị IoT trong LAN.

### 5.4. Tháng 7 — Plotter nâng cao + ổn định + v1.0

- FFT spectrum analyzer: chọn kênh, window function (Hann/Hamming), hiển thị frequency domain realtime.
- Math channels: biểu thức trên kênh có sẵn (`ch1 + ch2`, moving average, derivative, RMS).
- Trigger lines: đường ngưỡng ngang, alert khi vượt.
- Measurement tự động: min/max/avg/peak-to-peak/tần số ước lượng.
- Export: CSV toàn bộ buffer, PNG/SVG screenshot.
- Nâng buffer lên 1 triệu điểm/kênh (WebGL, decimation khi zoom out).
- 2 tuần cuối: freeze tính năng, fix bug từ beta, benchmark hồi quy, **phát hành v1.0**.

**DoD v1.0:** crash-free rate > 99.5% (đo qua telemetry opt-in), tất cả tính năng có docs.

---

## 6. Giai đoạn 3 — Hệ sinh thái (tháng 8–12) → v2.0

### 6.1. Tháng 8–9 — Plugin system + workspace

- Plugin dạng script/WASM (không dùng native DLL — an toàn và cross-platform):
  - Plugin API: custom protocol decoder, custom parser cho plotter, custom panel.
  - Plugin manifest, cài từ file hoặc URL; nền tảng cho marketplace sau này.
- Custom layout: kéo thả panel (monitor + plotter + TCP cùng màn hình), lưu layout theo project.
- Project profiles hoàn chỉnh: file `.edtproj` chứa toàn bộ cấu hình, mở lại là làm việc ngay.

### 6.2. Tháng 10 — CLI mode + test runner (hướng doanh nghiệp)

- CLI headless: `edt flash --profile x.json`, `edt monitor --port COM3 --script test.lua --timeout 60`.
- Test runner: định nghĩa test suite YAML (flash → gửi lệnh → assert response → report), exit code cho CI.
- Report generator: HTML/JUnit XML cho Jenkins/GitHub Actions.
- REST API cục bộ (tùy chọn bật) để điều khiển tool từ hệ thống ngoài.

### 6.3. Tháng 11 — Sản xuất hàng loạt

- Batch flash ESP32: nạp đồng thời nhiều port, bảng trạng thái từng thiết bị.
- Mass production STM32: inject serial number/MAC/key duy nhất per device (patch vùng nhớ định nghĩa trước), log xuất xưởng CSV.
- eFuse/option bytes nâng cao với cơ chế xác nhận 2 bước (thao tác không thể hoàn tác).

### 6.4. Tháng 12 — Hoàn thiện + v2.0

- Session replay: ghi và phát lại phiên debug với timestamp chính xác.
- OTA update ESP32 qua Wi-Fi (mDNS discovery + HTTP OTA).
- Tối ưu, dịch UI (Việt/Anh), **phát hành v2.0**.

---

## 7. Mô hình phát hành

100% open source — toàn bộ tính năng ở mọi giai đoạn (bao gồm cả các mục "Pro"/"Business" cũ như FFT, plugin, CLI/CI mode, batch flash, mass production) đều miễn phí và mở mã nguồn, không có bản trả phí hay tính năng khoá sau paywall. Giấy phép dual MIT/Apache-2.0 (đã áp dụng từ đầu, xem [LICENSE-MIT](../LICENSE-MIT)/[LICENSE-APACHE](../LICENSE-APACHE)).

Nguyên tắc: sản phẩm phải đủ tốt để thay thế hoàn toàn CoolTerm + Hercules + STM32CubeProgrammer — đó là động lực lan truyền và đóng góp cộng đồng, không phải doanh thu trực tiếp từ phần mềm. Nếu về sau cần nguồn thu, ưu tiên các hướng không tách tính năng khỏi bản mở (vd. tài trợ cộng đồng, dịch vụ hỗ trợ/tư vấn riêng, không phải "open core").

---

## 8. Quản lý rủi ro

| Rủi ro | Mức độ | Giải pháp |
|---|---|---|
| Hiệu năng serial tốc độ cao (drop data, lag UI) | Cao | Benchmark ngay tuần 1 (giai đoạn 0); ring buffer Rust + batch IPC + virtualized rendering; test hồi quy hiệu năng trong CI |
| Không được redistribute STM32_Programmer_CLI | Cao | Detect bản cài của user, hướng dẫn cài; về dài hạn cân nhắc probe-rs (open source) cho flash qua ST-Link |
| Scope creep — danh sách tính năng quá dài | Cao | Kỷ luật phase: tính năng giai đoạn 3 tuyệt đối không kéo vào giai đoạn 1; mọi tính năng mới vào backlog, review mỗi tháng |
| Khác biệt serial giữa Windows/Linux/macOS | Trung bình | Test thật trên cả 3 OS mỗi release; CI matrix; danh sách adapter USB-UART test chuẩn (CP210x, CH340, FTDI) |
| esptool/CLI đổi format output theo version | Trung bình | Parser chịu lỗi + test với nhiều version; ưu tiên espflash native |
| Cạnh tranh (tool tương tự ra mắt) | Thấp | Lợi thế là data pipeline liền mạch + scripting; ra beta sớm để chiếm cộng đồng |

---

## 9. Chỉ số theo dõi (KPI)

- **Beta (cuối T3):** 500+ lượt tải, 20+ issue/feedback chất lượng.
- **v1.0 (cuối T7):** 3.000+ lượt tải, crash-free > 99.5%, 100+ user hoạt động hàng tuần.
- **v2.0 (cuối T12):** 10.000+ lượt tải, 5+ plugin cộng đồng, công ty đầu tiên dùng trong quy trình sản xuất thực tế.

---

## 10. Việc cần làm ngay tuần này

1. Tạo repo, chốt tên sản phẩm và license — 100% open source, dual MIT/Apache-2.0, không tách bản Pro/closed.
2. Viết PoC Tauri + serialport-rs, benchmark 2Mbps.
3. Vẽ wireframe layout chính (monitor multi-tab + panel flash).
4. Lập backlog trên GitHub Projects theo đúng cấu trúc giai đoạn của tài liệu này.
