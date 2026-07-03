# Kế hoạch chi tiết thực hiện — Giai đoạn 0 & Giai đoạn 1 (MVP)

> Tài liệu con của [ke-hoach-phat-trien-embedded-devtool.md](ke-hoach-phat-trien-embedded-devtool.md). Phạm vi: từ chuẩn bị đến phát hành Beta (~3.5 tháng). Các giai đoạn 2–3 giữ nguyên mức tổng quan trong tài liệu gốc, sẽ chi tiết hóa khi gần tới.

**Cách dùng:** mỗi mục có mã số (dùng làm mã issue GitHub, vd. `G0-T3`, `M1-T2.1`), việc cụ thể, tiêu chí hoàn thành (AC), ước lượng, phụ thuộc. Copy trực tiếp thành GitHub Issues/Projects.

---

## Giai đoạn 0 — Chuẩn bị (2 tuần, theo ngày làm việc)

### Tuần 1 — Kỹ thuật nền tảng

| # | Ngày | Việc | Chi tiết | AC | Phụ thuộc |
|---|---|---|---|---|---|
| G0-T1 | D1 | Khởi tạo repo + khung dự án Tauri | `cargo tauri init`, chọn frontend (xem G0-T2), cấu trúc thư mục `src-tauri/` (core Rust) và `src/` (frontend) tách biệt rõ | Project chạy `tauri dev` ra cửa sổ rỗng trên máy dev | — |
| G0-T2 | D1 | Chốt React vs Svelte | So sánh nhanh: hệ sinh thái component (drag-drop panel, virtualized list), tốc độ render, độ quen thuộc của team | Quyết định ghi vào ADR-001, không đổi lại sau | G0-T1 |
| G0-T3 | D2 | PoC đọc serial cơ bản | Tích hợp `serialport-rs`, mở port, đọc loop trên thread riêng, đẩy dữ liệu thô ra console | Đọc được dữ liệu từ 1 thiết bị test (Arduino/ESP32 phát chuỗi liên tục) | G0-T1 |
| G0-T4 | D3 | Benchmark throughput 2 Mbps | Viết firmware test phát dữ liệu tuần tự có checksum ở 2 Mbps liên tục; đo byte drop, CPU, RAM phía Rust | Chạy 10 phút, 0 byte drop, CPU < 15% (đúng DoD giai đoạn 0) — nếu fail, thử kiến trúc thread/buffer khác ngay | G0-T3 |
| G0-T5 | D4 | Thiết kế Event Bus | Interface pub/sub nội bộ Rust (kênh tokio broadcast hoặc crossbeam), định nghĩa `Event` enum (DataReceived, PortOpened, PortClosed, Error…) | Bản thiết kế + PoC 2 module giả lập giao tiếp qua bus, không gọi trực tiếp nhau | G0-T3 |
| G0-T6 | D5 | Thiết kế `DataStream` trait | `trait DataStream { fn open(&mut self); fn close(&mut self); fn read(&mut self) -> Bytes; fn write(&mut self, data: &[u8]); fn on_data(&mut self, cb); }`; serial là implementation đầu tiên | Trait compile, SerialStream implement được, có unit test mở/đóng giả lập | G0-T5 |
| G0-T7 | D5 | Viết ADR (Architecture Decision Record) | Ghi lại: chọn Tauri, chọn Rust, chọn frontend framework, event bus, DataStream — mỗi ADR gồm bối cảnh/quyết định/hệ quả | File `docs/adr/001-*.md` … `005-*.md` | G0-T2, G0-T5, G0-T6 |

### Tuần 2 — Hạ tầng & thiết kế UI

| # | Ngày | Việc | Chi tiết | AC | Phụ thuộc |
|---|---|---|---|---|---|
| G0-T8 | D6 | Setup monorepo | Cargo workspace cho các crate Rust (core, cli sau này); package.json workspace cho frontend nếu cần tách package | `cargo build` và frontend build chạy từ root, không lỗi path | G0-T1 |
| G0-T9 | D7 | CI: build 3 OS | GitHub Actions matrix (windows-latest, ubuntu-latest, macos-latest), cache cargo + node_modules, chạy `tauri build` | Artifact installer tải về chạy được trên cả 3 OS | G0-T8 |
| G0-T10 | D8 | CI: test + lint gate | `cargo clippy -D warnings`, `cargo fmt --check`, `cargo test`; ESLint/Prettier (hoặc tương đương Svelte) cho frontend | PR bị block nếu lint/test fail | G0-T9 |
| G0-T11 | D8 | Code convention doc | Quy ước đặt tên module, cấu trúc thư mục core (event_bus/, datastream/, flash/, script/), commit message convention | File `CONTRIBUTING.md` | G0-T8 |
| G0-T12 | D9–10 | Wireframe UI tổng thể | Figma: layout chính (sidebar + tab area), multi-tab monitor, panel flash, panel TCP/UDP, vị trí script editor — ưu tiên bố cục kéo-thả (chuẩn bị cho custom layout giai đoạn 3) | File Figma chia sẻ được, review với ít nhất 1 người dùng mục tiêu (sinh viên hoặc dev embedded) | G0-T2 |

### DoD Giai đoạn 0 (checklist trước khi vào Tháng 1)
- [ ] PoC đọc serial 2 Mbps, 10 phút liên tục, 0 byte drop, CPU < 15% (G0-T4)
- [ ] CI build ra installer chạy được trên Windows 10/11, Ubuntu 22.04, macOS (G0-T9)
- [ ] ADR đầy đủ cho: framework, ngôn ngữ, event bus, DataStream (G0-T7)
- [ ] Wireframe được duyệt (G0-T12)

---

## Giai đoạn 1 — MVP (tháng 1–3)

### Tháng 1 — Lõi serial monitor

#### Tuần 1–2: Backend — Serial port manager

| # | Việc | Chi tiết kỹ thuật | AC | Ước lượng |
|---|---|---|---|---|
| M1-T1.1 | Port enumeration | Wrap `serialport::available_ports()`, bổ sung VID/PID, tên thiết bị, số serial (qua `SerialPortType::UsbPort`) | API trả về danh sách port kèm đủ metadata, cập nhật khi cắm/rút (poll 1s hoặc hotplug event) | 2 ngày |
| M1-T1.2 | Open/close + cấu hình đầy đủ | Baudrate, data bits (5-8), parity (N/E/O), stop bits (1/1.5/2), flow control (None/RTS-CTS/XON-XOFF) | Mở port với mọi tổ hợp cấu hình hợp lệ, lỗi rõ ràng khi cấu hình sai hoặc port đang bị chiếm | 2 ngày |
| M1-T1.3 | Read thread architecture | Mỗi port một OS thread đọc blocking, gửi dữ liệu qua channel vào ring buffer; áp dụng `DataStream` trait từ G0-T6 | Đọc ổn định nhiều port song song, thread tự thoát sạch khi close port | 3 ngày |
| M1-T1.4 | Port state machine | `Closed -> Opening -> Open -> Error -> Closed`, phát event qua event bus mỗi lần đổi state | Frontend nhận được state thay đổi realtime qua event | 1 ngày |
| M1-T1.5 | Auto-reconnect | Theo dõi hotplug (VID/PID + serial number khớp lại), tự mở lại port khi thiết bị cắm lại, giữ nguyên cấu hình cũ | Rút cắm lại thiết bị trong lúc app chạy, monitor tự nối lại không cần thao tác | 2 ngày |
| M1-T1.6 | Ring buffer + batch IPC | Ring buffer có giới hạn cấu hình được (số dòng/bytes); gom dữ liệu mỗi ~16ms (60fps) rồi emit 1 event Tauri sang frontend | Benchmark lại: 4 port @ 921600 baud đồng thời, không drop, IPC không nghẽn | 3 ngày |

**Milestone tuần 2:** merge nhánh `feature/serial-core`, benchmark hồi quy so với G0-T4.

#### Tuần 3–4: Frontend — UI Monitor

| # | Việc | Chi tiết kỹ thuật | AC | Ước lượng |
|---|---|---|---|---|
| M1-T2.1 | Multi-tab shell | Mỗi tab gắn với 1 `DataStream` (port), quản lý state độc lập (buffer, filter, scroll position) | Mở/đóng/đổi tên tab, tab giữ trạng thái khi chuyển qua lại | 2 ngày |
| M1-T2.2 | Virtualized rendering | Dùng `react-window`/`svelte-virtual-list`, chỉ render dòng trong viewport | Buffer 100k dòng, cuộn mượt, không giật | 2 ngày |
| M1-T2.3 | Hex/ASCII/Mixed view | Toggle chế độ hiển thị, mixed view = hex bên trái + ASCII bên phải cùng dòng (kiểu hex editor) | Chuyển đổi tức thời không mất vị trí cuộn | 2 ngày |
| M1-T2.4 | Timestamp mỗi dòng | Option: tắt / absolute (ms) / delta (so với dòng trước); lưu theo setting per-tab | Bật/tắt không cần reload dữ liệu cũ | 1 ngày |
| M1-T2.5 | Send panel | Input text/hex, chọn line ending (None/CR/LF/CRLF), nút gửi + phím Enter | Gửi đúng byte sequence theo lựa chọn, hiển thị lại trong log (echo local tùy chọn) | 2 ngày |
| M1-T2.6 | Lịch sử lệnh | Mũi tên lên/xuống duyệt lệnh đã gửi (per-tab, lưu tối đa N lệnh gần nhất) | Giống hành vi shell history | 1 ngày |
| M1-T2.7 | Log to file | Ghi raw + bản có timestamp; rotation theo dung lượng cấu hình được (vd. 50MB/file) | Tắt/mở app giữa chừng không mất log, file rotation không làm mất dữ liệu | 2 ngày |
| M1-T2.8 | Auto-scroll thông minh | Tự cuộn xuống dòng mới; dừng tự cuộn khi user cuộn lên tay; nút nổi "jump to bottom" xuất hiện khi đang dừng | Test thao tác cuộn lên giữa lúc dữ liệu đổ về liên tục — không bị "giật" về cuối | 1 ngày |

**Tuần 4 (2 ngày cuối):** integration test toàn tháng 1 — mở 4 port đồng thời ở 921600 baud, chạy 1 giờ, theo dõi memory (không leak), CPU, UI responsiveness.

**DoD tháng 1:**
- [ ] 4 port đồng thời, 921600 baud, UI mượt
- [ ] Không drop dữ liệu, không leak memory sau 1 giờ chạy liên tục
- [ ] Toàn bộ tính năng M1-T2.x hoạt động ổn định

---

### Tháng 2 — Flash tools

#### Tuần 1–2: ESP32

| # | Việc | Chi tiết kỹ thuật | AC | Ước lượng |
|---|---|---|---|---|
| M2-T1.1 | Tích hợp espflash | Ưu tiên dùng `espflash` như library Rust (không subprocess) để tránh phụ thuộc Python; fallback bundle `esptool` nếu thiếu tính năng | Flash được firmware .bin cơ bản qua CLI nội bộ trước khi làm UI | 3 ngày |
| M2-T1.2 | Auto-detect chip | Đọc chip magic value qua ROM bootloader, map ra ESP32/S2/S3/C3/C6; đọc MAC address, flash size | Cắm bất kỳ biến thể ESP32 nào, tool nhận diện đúng không cần chọn tay | 2 ngày |
| M2-T1.3 | UI Flash panel | Chọn file .bin (hỗ trợ nhiều file + offset), chọn baudrate, nút Flash | Form validate offset hợp lệ, không cho flash chồng vùng nhớ | 2 ngày |
| M2-T1.4 | Progress bar + verify | Bắt callback progress từ espflash, hiển thị %; verify checksum sau khi nạp xong | Progress khớp thực tế ±5%, verify fail thì báo rõ vùng lỗi | 2 ngày |
| M2-T1.5 | Erase / Read flash region | Erase toàn bộ hoặc theo vùng; đọc flash ra file .bin theo offset+size | Đọc/ghi round-trip khớp dữ liệu | 1 ngày |
| M2-T1.6 | Flash profile | Lưu bộ (danh sách file+offset+baudrate+options) thành JSON, gắn vào project file, load lại 1-click | Tạo profile, đóng app, mở lại, flash lại bằng 1 nút | 2 ngày |

#### Tuần 3–4: STM32

| # | Việc | Chi tiết kỹ thuật | AC | Ước lượng |
|---|---|---|---|---|
| M2-T2.1 | Detect STM32_Programmer_CLI | Kiểm tra registry (Windows: `HKLM\SOFTWARE\STMicroelectronics\...`), PATH, thư mục cài mặc định mỗi OS | Tự tìm thấy trên máy đã cài CubeProgrammer; nếu không thấy, hiện hướng dẫn tải kèm link | 2 ngày |
| M2-T2.2 | Wrapper subprocess | Gọi CLI qua `std::process::Command`, capture stdout/stderr realtime (streaming, không đợi kết thúc mới đọc) | Log CLI hiển thị realtime trong UI khi đang flash | 2 ngày |
| M2-T2.3 | Flash qua ST-Link | Lệnh `-c port=SWD -w <file> -v -rst` (tham số theo doc CLI thực tế) | Flash thành công qua ST-Link on-board (Nucleo/Discovery) | 2 ngày |
| M2-T2.4 | Flash qua UART bootloader | Lệnh `-c port=COMx -w <file>` chế độ bootloader UART, hướng dẫn user vào bootloader (BOOT0) | Flash thành công qua UART trên board không có ST-Link | 2 ngày |
| M2-T2.5 | Auto-detect MCU family | Parse output lệnh connect (`-c port=SWD`) lấy ra Device ID/family | Hiển thị đúng tên chip (F4/G0/...) sau khi kết nối | 1 ngày |
| M2-T2.6 | Parser output chịu lỗi | Regex tách progress %, mã lỗi, thông điệp; thiết kế theo "parser chain" — thử parser mới nhất, fallback parser cũ, fallback hiển thị raw log nếu không khớp gì | Test với ít nhất 2 version CubeProgrammer khác nhau (nếu có sẵn) hoặc log mẫu từ nhiều version | 2 ngày |
| M2-T2.7 | Mass erase | Lệnh erase toàn chip | Erase xong, đọc lại flash toàn 0xFF | 0.5 ngày |
| M2-T2.8 | Option bytes cơ bản | Đọc/ghi option bytes qua CLI; **cảnh báo RDP**: dialog xác nhận rõ ràng "thao tác có thể khóa vĩnh viễn debug access" trước khi ghi | Không thể ghi option bytes nhầm mà không qua bước xác nhận | 1.5 ngày |

**DoD tháng 2:**
- [ ] Flash thành công ESP32-S3 và STM32F4/G0 từ UI
- [ ] Progress hiển thị chính xác
- [ ] Báo lỗi rõ ràng khi sai wiring / không vào được bootloader (test case: rút dây trong lúc flash, sai baudrate, quên vào bootloader)

---

### Tháng 3 — Plotter cơ bản + phát hành Beta

#### Tuần 1–2: Plotter

| # | Việc | Chi tiết kỹ thuật | AC | Ước lượng |
|---|---|---|---|---|
| M3-T1.1 | Rendering engine | Tích hợp uPlot (hoặc custom WebGL nếu uPlot không đủ throughput), canvas riêng cho plotter | Vẽ mượt ở 60fps với dữ liệu realtime tốc độ cao | 3 ngày |
| M3-T1.2 | Đa kênh (tối đa 8, MVP) | Mỗi kênh 1 màu, legend bật/tắt từng kênh | Bật/tắt kênh không ảnh hưởng hiệu năng kênh còn lại | 1 ngày |
| M3-T1.3 | Auto-parse format | Nhận diện: CSV (`1.2,3.4`), space-separated, `key:value`, Arduino Serial Plotter format — heuristic thử theo thứ tự, cho phép override tay | Dán log mẫu của 4 định dạng, tool tự nhận đúng cả 4 | 3 ngày |
| M3-T1.4 | Zoom/pan + freeze | Chuột kéo pan, lăn chuột zoom, nút freeze dừng cập nhật (vẫn nhận data ngầm, resume không mất đoạn) | Freeze rồi resume không bị nhảy cóc dữ liệu | 2 ngày |
| M3-T1.5 | Cursor crosshair | Hover hiển thị giá trị từng kênh tại thời điểm đó | Giá trị hiển thị khớp với dữ liệu thực trong buffer | 1 ngày |
| M3-T1.6 | Nối với tab monitor | Dropdown chọn tab nguồn dữ liệu; dùng chung `DataStream`/event bus — không code riêng cho từng loại nguồn | Đổi nguồn dữ liệu runtime không cần restart plotter | 1 ngày |

#### Tuần 3–4: Polish + Release

| # | Việc | Chi tiết | AC | Ước lượng |
|---|---|---|---|---|
| M3-T2.1 | Dark/light theme | Theme token trong CSS/design system, toggle + theo hệ điều hành | Không còn hardcode màu rải rác trong code | 1.5 ngày |
| M3-T2.2 | Phím tắt | Chuẩn hóa: Ctrl+K command palette (tùy chọn), Ctrl+F search, Ctrl+/ toggle sidebar... | Danh sách phím tắt có trong docs | 1 ngày |
| M3-T2.3 | Settings | Panel cấu hình chung (buffer size, theme, đường dẫn CLI ngoài, ngôn ngữ để chuẩn bị i18n sau) | Settings persist qua project file/app config | 1.5 ngày |
| M3-T2.4 | Installer | MSI/NSIS (Windows), AppImage + deb (Linux), dmg (macOS) qua `tauri build`; cân nhắc code signing Windows (~$300/năm) | Cài đặt + gỡ cài sạch trên cả 3 OS | 2 ngày |
| M3-T2.5 | Docs | Hướng dẫn cài đặt + quickstart riêng cho monitor/flash/plotter | Người ngoài dự án làm theo docs mà không cần hỏi | 2 ngày |
| M3-T2.6 | Phát hành Beta | GitHub Releases + landing page đơn giản (1 trang tĩnh) | Link tải public hoạt động | 1 ngày |
| M3-T2.7 | Kênh quảng bá | Đăng lên: Cộng đồng ARM Việt Nam, Điện tử Việt, r/embedded, r/esp32, Hackaday, Hacker News | Đã đăng ở ít nhất 4/6 kênh, có theo dõi phản hồi | 1 ngày |
| M3-T2.8 | Kênh feedback | GitHub Issues template (bug/feature) + form feedback trong app (gửi kèm log/version) | Test gửi thử 1 issue từ trong app thành công | 1 ngày |

**DoD Beta (tiêu chí then chốt của cả giai đoạn 1):**
- [ ] Người lạ (chưa từng thấy tool) cài và flash được ESP32 trong vòng 5 phút không cần đọc docs — **test thật với ít nhất 2–3 người ngoài nhóm phát triển trước khi công bố rộng**

---

## Ghi chú triển khai chung

- **Thứ tự phụ thuộc cứng:** G0-T4 (benchmark) phải pass trước khi xây UI Tháng 1, vì nếu kiến trúc buffer sai sẽ phải đập lại toàn bộ backend serial. Tương tự M1-T1.6 (batch IPC) là nền cho mọi module dùng `DataStream` sau này (flash log, TCP/UDP giai đoạn 2).
- **Rủi ro cần theo dõi sát trong phạm vi này** (trích từ mục 8 tài liệu gốc): hiệu năng serial tốc độ cao, STM32_Programmer_CLI không redistribute được, khác biệt Windows/Linux/macOS. Nên test trên cả 3 OS **mỗi tuần**, không đợi tới cuối tháng.
- **Adapter USB-UART cần chuẩn bị sẵn để test:** CP210x, CH340, FTDI — mua trước khi vào Tuần 1 Tháng 1.
- **Không kéo việc giai đoạn 2/3 vào đây:** filter/regex, scripting, TCP/UDP, FFT... giữ nguyên trong backlog, chỉ bắt đầu sau khi Beta phát hành và có feedback thật.
