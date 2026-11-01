# YouTube Memo pages implementation plan

> **For agentic workers:** Use the executing-plans workflow for the integrated content controller; independent model and regression investigation may run in parallel. Track completed checks below.

**Goal:** Fix initial memo mounting and implement per-video titled pages with playback-time switching.

**Architecture:** Plain JS shared model plus content controller and CSS. GitHub connector supplies and publishes repository content because direct git networking is unavailable.

**Tech Stack:** Manifest V3, chrome.storage.local, DOM events, Node test runner, Playwright when available.

**Spec:** ../specs/2026-11-01-memo-pages-design.md

## Global constraints

Preserve existing memo text and height, existing host permissions and no runtime dependencies. Keep controls below the editor. Titles appear only with multiple pages. Auto-switch opt-in is per video.

## Review focus

1. Hidden duplicate watch layouts and sidebar replacement must not strand the memo.
2. Slow/out-of-order storage callbacks must not cross videos or lose edits.
3. Typing/IME and manual navigation must not be interrupted by playback.
4. Empty/invalid/duplicate timestamps and backwards seeks must behave deterministically.
5. Collapsing/resizing or replacing the player must not save zero heights or leak listeners.

### Task 1: Pure model

Files: memo-model.js, test/memo-model.test.js. Interfaces: the model API and saved record from the spec.
- [x] Add meaningful tests for legacy data, malformed records, stable IDs, optional times and time selection; observe failures.
- [x] Implement normalized pages, timestamps and selection; run node --test test/memo-model.test.js.

### Task 2: Controller, layout and initialization

Files: content.js, styles.css, manifest.json, test/content.test.js, test/styles.test.js and browser tests as needed. Consumes YouTubeMemoModel.
- [x] Reproduce startup issue and missing page functionality before implementation.
- [x] Implement lifecycle, storage, title/editor/settings, manual pages and automatic switching; add model first in manifest and bump version to 1.1.0.
- [x] Run regression tests including every review-focus case; inspect responsive screenshots.

### Task 3: Documentation, review and delivery

Files: README.md and this plan.
- [x] Update use/update instructions and storage documentation.
- [x] Independent whole-change review; no Critical, Important or Minor findings.
- [ ] Run complete suite, syntax/diff checks; publish tested changes to a reviewable PR and finish authorized repository integration.

## Progress

- Upstream snapshot: main eb48452c078624b1ed9ae091b840d33b8b84ae70. Existing two test files run successfully; test-runner reporting needs inspection before recording an assertion count.
- Initial setup: isolated local copy; GitHub connector used for source transfer. Original icon blobs remain unchanged in remote base tree.


- Model complete: 22 behavior tests; new API observed failing before implementation.
- Controller complete: 24 Chromium tests including hidden hosts, delayed layouts, migration, multi-page UI, seeking, editing/IME, delayed reads/writes and failure recovery.
- Combined gate: 47 tests passing (24 browser, 22 model, 1 CSS); Japanese-font light/dark 390px screenshots verified.
- Environment: direct git and browser networking worked with the execution permission required by this workspace. Restored actual upstream history/icons; no changes to runtime extension permissions.

- Independent review complete: full source/spec/test review and independent 47/47 run, no required changes.
- Review boundary resolved: installed unpacked extension in a persistent Chromium profile; verified scripts are isolated from the page, used real chrome.storage.local, and restored both pages/title/cue after closing and reopening the browser context.
- Remaining validation boundary: controlled YouTube-shaped pages were used; live YouTube experiments, live advertisements and the user's browser profile were not tested. The new ad guard is conservative, and no live-site claim is made.
