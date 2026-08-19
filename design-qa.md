# Modbus RTU Design QA

- Source visual truth: user-provided Modbus Poll screenshot in the current conversation, plus `doc/VSMD系列应用篇-Modbus RTU上位机软件使用说明书v1.0.pdf` pages 4-8 and 29-38.
- Source dimensions: 1010 × 650 px.
- Implementation: Electron renderer, Modbus RTU tab.
- Intended viewport: desktop, approximately 1010 × 650 CSS px at device scale factor 1.
- State: no serial connection, register 00000 selected.
- Implementation screenshot: unavailable.
- Density normalization: not applicable because no implementation capture could be produced.

## Full-view comparison evidence

Blocked. The Electron development process built its renderer successfully but the local Electron runtime exited in `@electron-toolkit/utils` while reading `electron.app.isPackaged`. The in-app browser was also unavailable, so the rendered implementation could not be captured.

## Focused region comparison evidence

Blocked for the same reason. The register header, Alias/value cells, status strip, and selected-cell treatment could not be visually compared against the reference screenshot.

## Findings

- [P1] Rendered fidelity has not been verified.
  - Location: Modbus RTU screen.
  - Evidence: source screenshot is available, but no browser- or Electron-rendered implementation screenshot is available.
  - Impact: table density, overflow, typography, and alignment may still need adjustment on the actual desktop runtime.
  - Fix: launch the app in a working Electron environment or authorize a standalone browser capture of the renderer, then compare at 1010 × 650.

## Required fidelity surfaces

- Fonts and typography: implemented with Microsoft YaHei UI / Segoe UI and Consolas fallbacks; visual verification blocked.
- Spacing and layout rhythm: implemented as a five-group, ten-row register grid; visual verification blocked.
- Colors and visual tokens: reference-inspired gray grid, white cells, blue selection, and semantic status colors; visual verification blocked.
- Image quality and asset fidelity: no raster or icon assets are present in this screen.
- Copy and content: aliases extracted from `doc/vsmd104_105_x4.mbp`; value types, two-register display behavior, ABCD/CDAB word order, and H06/H10 write behavior were checked against the manual.

## Primary interactions tested

- TypeScript compilation: passed.
- Production build: passed.
- Component ESLint: passed.
- Browser interaction testing: blocked because no supported browser surface was available.
- Console error check: blocked because the renderer could not be opened in a supported browser surface.

## Comparison history

- Initial pass: blocked before visual comparison; no screenshot-based fixes were applied.

## Implementation checklist

- Capture the Modbus screen at 1010 × 650.
- Compare full screen and focused register-table region with the source.
- Test read-once, polling toggle, register selection, and double-click write.
- Resolve any P0/P1/P2 visual differences and repeat the comparison.

final result: blocked
