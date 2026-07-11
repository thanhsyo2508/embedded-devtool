# Third-party notices

EDT is licensed under Apache-2.0 OR MIT (see [LICENSE-APACHE](LICENSE-APACHE) /
[LICENSE-MIT](LICENSE-MIT)). It bundles one third-party binary asset under a
different license, noted here as required by that license's terms.

## boot_app0.bin

- **Source:** [`tools/partitions/boot_app0.bin`](https://github.com/espressif/arduino-esp32/blob/master/tools/partitions/boot_app0.bin) from the [espressif/arduino-esp32](https://github.com/espressif/arduino-esp32) repository.
- **License:** GNU Lesser General Public License, Version 2.1 — full text in [`src-tauri/resources/boot_app0.LICENSE.md`](src-tauri/resources/boot_app0.LICENSE.md), as declared by that repository's [`LICENSE.md`](https://github.com/espressif/arduino-esp32/blob/master/LICENSE.md).
- **Used for:** the ESP32 Flash panel's "Smart add" feature offers this file as the `otadata`-partition binary (conventionally flashed at offset `0xe000`) for OTA-capable partition schemes, since PlatformIO/ESP-IDF build output doesn't always include it — sparing the user from having to locate it inside an Arduino IDE/core install.
- Unmodified from upstream. To obtain the corresponding source or request it under LGPL-2.1 §6, see the upstream repository linked above.
