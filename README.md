# new_tab_extension (Modular Refactor)

This Chrome extension overrides the New Tab page and provides:
- Search box with selectable engines and keyboard-accessible online suggestions
- Wallpaper (local + remote sources)
- Shortcuts grid with edit mode, icon editor, drag & drop
- Settings sidebar (persisted via `chrome.storage.local`)

## Project layout
 
 Top-level files:
 - `newtab.html`: New Tab UI markup. Loads scripts in this order:
   1) `i18n.js` (global i18n compatibility)
   2) `script.js` (`type="module"` entry)
 - `script.js`: Thin entry that imports `src/app.js`
 - `i18n.js`: IIFE-style script that still exports compatibility globals (`t`, `setLanguage`, `currentLanguage`)
 - `src/style.css`: Styling + app-ready gating to prevent FOUC
 - `manifest.json`: Extension configuration
 
 Module code (ES Modules) lives under `src/`:
 - `src/app.js`: App bootstrap; builds `ctx`, loads storage, applies settings, initializes features
 - `src/background.js`: Service Worker for WebDAV proxying (CORS bypass) and logic
 - `src/state.js`: Central state model and helpers
 - `src/dom.js`: DOM element lookup + DOM-related helpers
 - `src/constants.js`: Shared constants
 
 Features (UI behavior by area):
 - `src/features/search.js`: Search engine + submit behavior
 - `src/features/searchSuggestions.js`: Suggestion list, keyboard/IME interactions, and lifecycle cleanup
 - `src/features/settingsPanel.js`: Settings sidebar UI + persistence
 - `src/features/shortcuts.js`: Shortcuts grid, edit mode, icon editor, DnD, pagination
 - `src/features/sidebar.js`: Sidebar toggling + layout wiring
 - `src/features/wallpaper.js`: Wallpaper source handling + refresh
 - `src/features/sync.js`: WebDAV synchronization logic (V2 with binary support)
 
 Utilities:
 - `src/utils/storage.js`: Promise wrappers for `chrome.storage.*`
 - `src/utils/db.js`: IndexedDB wrapper for large asset storage (Wallpapers/Icons)
 - `src/utils/images.js`: Image formatting, compression, and analysis helpers
 - `src/utils/favicon.js`: Favicon URL generators
 - `src/utils/searchSuggestions.js`: Suggestion providers, cancellable requests, and bounded memory cache
 - `src/utils/wheelPaging.js`: Mouse/trackpad wheel normalization and one-page-per-burst gesture handling
 - `src/utils/shortcutOrder.js`: Stable insertion ordering with original storage indices and legacy empty-slot handling
 - `src/utils/webdav.js`: WebDAV Client implementation
 
 UI glue:
 - `src/ui/settingsApply.js`: Apply persisted settings to CSS vars / DOM

## Key design decisions

- **Stable entrypoints**: `newtab.html` continues to load `script.js`, so file moves don’t require HTML changes.
- **Compatibility i18n**: `i18n.js` is isolated internally, but keeps `globalThis.t` / `setLanguage` for older callers.
- **FOUC prevention**: UI is hidden until storage-backed settings have been applied (via `body.app-ready`).
- **Icon resilience**: When choosing online icons, icons are cached as `data:` URLs to survive offline reloads.

## Search suggestions

- Google, Bing, and Baidu offer query suggestions from their own online services. Typing sends the query to the selected engine after a 180 ms debounce, without cookies or a referrer. The existing extension host permissions cover these requests; see [Chrome's extension networking documentation](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests).
- The first row searches the original query. Use Up/Down to preview suggestions, Enter or a mouse click to search, Tab to accept a completion, and Escape to restore the original input and dismiss the list. Chinese IME composition does not request suggestions or submit a search until committed.
- At most seven recommendations plus the original query are rendered. A new input cancels the previous request immediately; late responses cannot overwrite the current list. Requests time out after 3 seconds, with no polling or automatic retries.
- Queries up to 200 characters are eligible for recommendations. Each page keeps at most 40 query results in memory for up to five minutes; queries are never written to extension storage. Clearing, losing focus, hiding, or leaving the page cancels pending work. Reinitializing search removes its previous listeners and cache.
- These external suggestion endpoints may change or be unavailable. Network failures leave ordinary search available. Custom engines without a suggestion provider retain ordinary search; queries are not forwarded to a different engine. Suggestions do not include browser history, bookmarks, or open tabs.
- Decorations and placeholders cannot be selected; typed text remains selectable. Clicking search-box padding focuses the input, with the caret at the start when empty.

## Trackpad interaction

- Single-finger clicks/taps use the normal controls, shortcuts, and suggestion selection. Secondary click (including two-finger tap when enabled in the OS) enters shortcut edit mode; press-drag or an OS-enabled drag gesture reorders shortcuts by insertion, without swapping the target. Drop on its left/right half to insert before/after it; the blue edge marks the boundary. For example, inserting D before B changes `A B C D` to `A D B C`. Intermediate items retain their relative order, and the page containing the moved item stays visible. Canceling a drag leaves storage unchanged.
- Over the shortcuts grid, horizontal trackpad scrolling changes pages, preserving circular navigation. To avoid accidental paging, a new stroke must accumulate 80 px within 240 ms, with horizontal motion more than 1.5 times vertical motion. Reversing or drifting diagonally clears unconfirmed motion; tiny ongoing movements cannot accumulate indefinitely. No slide animation starts below the threshold. Vertical trackpad-style scrolling stays native; ordinary mouse-wheel vertical paging remains enabled.
- Mouse/trackpad distinction is heuristic: vertical line/page-mode events count as wheels; pixel-mode vertical events need discrete notch evidence (Chromium legacy wheel metadata, or whole 100/120 px steps when that metadata is absent). Notch detection accepts fractional pixel distances and display scaling, including the common 40 px / 120 legacy-delta case; see [Chromium's wheel event conversion](https://chromium.googlesource.com/chromium/src/+/HEAD/third_party/blink/renderer/core/events/wheel_event.cc). Vertical gestures without notch evidence stay native, and cannot switch to paging through acceleration within the same burst. Smooth mice and coarse trackpad drivers can still be ambiguous; physical-device testing is needed.
- Mouse scrolling can page continuously without an idle gap: same-direction turns are limited to one per 160 ms, and reversing responds immediately. Trackpad strokes use separate momentum handling: a stroke and its decaying tail change at most one page. A gap of at least 200 ms starts a new burst. Without a gap, horizontal paging also recognizes deliberate reversal or renewed same-direction acceleration after sustained decay; either must accumulate 80 px within 120 ms. Same-direction renewal requires at least two samples at half the previous peak or below, followed by a delta of at least 8 px and twice the observed floor. Small tail oscillations cannot accumulate indefinitely into another page. These are gesture heuristics; browsers do not provide a portable physical trackpad gesture boundary.
- Page navigation supersedes any previous slide animation instead of waiting for a CSS `transitionend` lock. The single Web Animation is released on both completion and cancellation; reduced-motion mode skips it. Paging buttons support keyboard focus, while the dots and their surrounding decoration cannot be text-selected or display an insertion caret.
- Suggestions and the settings sidebar retain native scrolling. Pinch/Ctrl+wheel and other modified browser gestures are not canceled; paging is disabled while dragging or when only one shortcut page exists. Trackpad zoom can arrive as Ctrl+wheel; see [MDN's wheel event documentation](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event).
- The pager uses constant-size state and event timestamps, without timers or polling. Page counts are computed once per burst, then checked again only when turning a page. Reinitialization removes the previous listeners, and page visibility changes reset the partial gesture.

## Development

### Load unpacked
1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder

### WebDAV Sync Usage

The extension supports syncing settings and assets (wallpapers, shortcut icons) via WebDAV.

1. Open **Settings** -> **Data Sync (WebDAV)**.
2. Enter your WebDAV Server URL, Username, and Password.
3. Click **Check Connection** to verify.
4. Use the buttons to sync:
   - **Upload**: Overwrites remote data with your local data.
   - **Download**: Overwrites local data with remote data.
   - **Merge**: Downloads remote data and merges it with local data (Remote settings overwrite local; Shortcuts are combined by URL).

### Testing
See `TESTING.md`.

## Notes

- This repo uses ES Modules in the New Tab page context.
- Persisted data is stored in `chrome.storage.local`.
- Binary assets (Wallpapers/Icons) are stored in IndexedDB.
