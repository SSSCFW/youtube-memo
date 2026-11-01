# YouTube Memo pages and reliable initialization

## Intent and requirements

Implement the user's requested fix and features in the existing Brave/Chrome Manifest V3 extension without a build step or additional runtime dependencies.

- A memo must appear on an active YouTube watch page after direct load or SPA navigation, even with delayed layout, hidden duplicate sidebars, or DOM replacement. Detect a misplaced existing memo and recover it.
- The memo area is followed by one row containing 詳細設定 and メモを非表示 (メモを表示 when hidden).
- 詳細設定 toggles controls below that row: previous/next page, page selector, add/delete page, current page start time, use current video time, and auto-switch enabled checkbox.
- Store multiple pages per video, including text and independent titles. Only show an editable title above the memo text when at least two pages exist.
- Auto-switch is opt-in and saved per video. A page with a start time becomes active when playback reaches that time; seeking works both ways. Pages without a start time are manual-only. Before the first timed page use page one. Equal times resolve to the later page in page order.
- Preserve old memo text as page one and preserve saved textarea height. Keep legacy storage keys as a fallback; write the new format to memo_pages_<videoId>.

## Approach

Keep the existing plain-JavaScript extension. A small shared memo-model.js provides data normalization and timestamp selection, while content.js owns DOM, storage and lifecycle. Splitting each page into separate storage keys would complicate atomic per-video updates; adding a framework/build system is unnecessary. This choice and defaults below are implementation decisions made for the requested work, not additional user requirements.

## Data interface

Saved record: {version: 1, pages: [{id, title, content, startTime}], activePageId, autoSwitch}. startTime is a nonnegative finite number in seconds or null. New pages default to no start time; the legacy/default first page starts at zero. Default autoSwitch is false. Empty titles display ページ N in the selector while the title input remains editable.

Model API on globalThis.YouTubeMemoModel and CommonJS: normalizeMemo(saved, legacyContent = ''), createPage(pages), getPageAtTime(pages, seconds), parseTime(text), formatTime(seconds). getPageAtTime returns a page ID or null when there are no pages or time is invalid. parseTime accepts seconds, m:ss and h:mm:ss, returns a finite nonnegative number or null for empty/invalid; formatTime uses m:ss or h:mm:ss and returns '' for null/invalid.

## Lifecycle and data safety

Use a controller per current video, attach only to the active visible watch layout, and retain the controller if its DOM is temporarily detached. Serialize writes per controller to avoid stale saves. Ignore storage callbacks from abandoned controllers. Disable editing until load finishes; show load/save errors without overwriting unread data. Detach video/resize listeners on navigation. Do not save a zero height while collapsed. Use a throttled mutation check, YouTube navigation events, resize/fullscreen events, and a lightweight periodic recovery check.

While text/title or time is being edited, defer automatic page switches; do not interrupt IME composition. Manual page choice persists until the playback time enters a different timed segment. Removing a page containing text/title requires a confirmation; the last page cannot be deleted.

## Verification

Run existing tests plus real-DOM/browser regression tests for initial load, hidden duplicate sidebars, SPA transitions, DOM remount, storage migration, pages/titles/settings, timestamps and seeks, per-video isolation, asynchronous callbacks, and editing safety. Verify responsive light/dark layout in headless Chromium if available. Live YouTube/user profile cannot be assumed verified by a fixture.

