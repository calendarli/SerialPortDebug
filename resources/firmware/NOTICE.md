# Firmware programming tools

Optional platform bundles use the official esptool 5.3.1 standalone executables.
Its GPL-2.0-or-later license and upstream README are alongside the executable.

Upstream source for this exact release: https://github.com/espressif/esptool/tree/v5.3.1
Source archive: https://github.com/espressif/esptool/archive/refs/tags/v5.3.1.tar.gz
Release: https://github.com/espressif/esptool/releases/tag/v5.3.1
The upstream source contains its PyInstaller build specification and build workflow.
Retrieve the verified executable with `bun run fetch:esptool`.

Release ZIP SHA-256:
`2b4a73c45db27426685896f64ce3e557f63a64f43cc100cb65c0cc3486af96d3`

STM32CubeProgrammer is not redistributed. Install it separately from ST, then
select its `bin/STM32_Programmer_CLI.exe` in the firmware panel if automatic
discovery does not find it. Keep the complete ST installation and its libraries.

Windows x64, macOS x64/arm64, and Linux x64/arm64/armv7 bundles are selected by target architecture. SHA-256 digests are pinned in `scripts/fetch-esptool.ts`. Missing or unsupported bundles are optional; users can select an external native executable.
