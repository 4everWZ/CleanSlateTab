# Extension Testing Guide

## Search request regression tests

Run `node --test tests/searchSuggestions.test.mjs` with Node.js 22.13+ (no dependencies or installation required). Tests cover provider routing, query encoding, result bounds, cache expiry/eviction, cancellation with late responses, timeouts without retries, malformed responses, network failures, and cleanup. These tests use controlled fetch responses and virtual time; the browser checks below cover real integration.

## Manual Testing in Chrome

### Trackpad regression checks

Run `node --test tests/wheelPaging.test.mjs tests/shortcutOrder.test.mjs` (no extra dependencies). Tests cover wheel/trackpad heuristics including fractional/DPI-scaled mouse notches, continuous mouse scrolling, trackpad accidental-motion rejection, native vertical trackpad scrolling, horizontal paging, momentum, modifier/drag/single-page bypass, and insertion order with legacy gaps.

With enough shortcuts for at least three pages, verify on a physical trackpad:
- Over the grid, scroll horizontally with two fingers, including slow/small movements. One continuous gesture should turn at most one page; its momentum tail must not keep turning pages. Pause, then gesture again, including reversing direction and wrapping between the first/last page. Vertical two-finger scrolling must stay native without changing pages, including when a small initial delta accelerates into large deltas.
- Confirm mouse-wheel paging over the grid works for individual notches, continuous rolling without pauses, and immediate reversal. Try normal and scaled displays/browser zoom, including mouse settings producing small or fractional pixel deltas. Continuous rolling must not latch after the first page; same-direction turns are capped at one per 160 ms. Pinch zoom and Ctrl+wheel must not change shortcut pages. A one-page grid must leave scrolling native.
- Light horizontal displacement below 80 px, long micro-drift, and nearly diagonal two-finger motion must leave the grid stationary. A deliberate horizontal stroke reaching 80 px within 240 ms should page once; slow accidental movements must not accumulate across windows. Repeat these checks after a successful swipe, including a small reverse movement.
- Tap controls and shortcuts; two-finger secondary-click a shortcut to enter edit mode. Drag D to the left half of B in `A B C D`: expect `A D B C`, not a swap. Drag A to the right half of the last item: expect `B C D A`. Check the blue insertion marker, both directions, cross-page drops, legacy empty slots, persistence after reload, and cancellation without a saved reorder. Drop feedback should animate without console errors, and paging should work after releasing the drag.
- Scroll a populated search suggestion list with two fingers, then tap a visible result. Input focus should be preserved while scrolling, and the chosen result should search normally.
- Scroll the settings sidebar independently. Neither sidebar nor suggestion scrolling should change shortcut pages.
- Reinitialize shortcut setup repeatedly: paging must not multiply, and calling its `gridWheelCleanup` must detach its listeners. Switching tabs must discard a partially accumulated gesture.
- Repeat same-direction horizontal swipes at least 12 times while the preceding momentum tail is still delivering events (no 200 ms idle gap), in both directions. Then reverse quickly without waiting for the slide animation. Each new swipe should work; one accelerating stroke with a long decaying tail, a single low sample, or a small tail spike must not cause extra turns.
- Interrupt/cancel the grid animation (or hide the page during it), then page again. Navigation must remain available, with at most one grid animation. Repeat with CSS transitions disabled and with the OS/browser reduced-motion preference enabled; neither condition may leave paging locked.
- Click and drag across pagination dots and their empty padding: no text selection or insertion caret should appear. Tab to a page button and activate it with Enter/Space; its active state and keyboard focus should remain correct after rendering.

Browser automation can check equivalent wheel, pointer, secondary-click, and native drag events; it does not replace physical Windows/macOS trackpad testing for driver-specific timing and gesture settings.

### Step 1: Load Extension in Developer Mode
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Select the `new_tab_extension` folder

### Step 2: Test Core Features

#### 1. New Tab Opens
- Open a new tab (Ctrl+T or Cmd+T)
- Should see the custom new tab page with:
  - Search box at the top
  - Wallpaper in background
  - Application shortcuts in grid
  - Settings sidebar on the right

#### 2. Search Functionality
- Type a search query in the search box and press Enter
- Should open Google search results
- Click on the search engine icon/dropdown
- Should see options for Google, Bing, Baidu
- Click on a different search engine
- Try searching again - should use the selected engine

##### Suggestions, text selection, and lifecycle
- Drag across the engine icon, placeholder, and surrounding padding: no decorative text should be selected. Type text and select/copy it normally.
- Clear the input and click the right padding: the input gains focus with its caret at the beginning. Also test a narrow viewport and large search-height settings for overflow.
- Type `weather` with each built-in engine: the original query and up to seven online suggestions appear. Up/Down previews a row, Enter searches it, Escape restores the original query, and Tab accepts a completion. Clicking a row searches it. The selected search type (Web/Images/etc.) remains in effect.
- Compose Chinese text with an IME: intermediate composition and its confirming Enter must neither fetch suggestions nor navigate. Suggestions begin after composition commits.
- In DevTools Network, type several characters less than 180 ms apart: only the final query should be requested. Changing the query cancels an in-flight request immediately. A delayed old response must not replace the current recommendations or reset a keyboard selection.
- Clear the query, click elsewhere, open the engine menu, switch tabs, or leave the page while a request is pending: the dropdown closes and requests are canceled. Escape must remain dismissed when an old response arrives.
- Simulate offline mode, invalid JSON, and a hanging request: ordinary Enter search still works; a pending request is aborted after 3 seconds, without retries. An idle search box must produce no repeated requests.
- Repeating a recent query with the same engine should use the bounded in-memory cache. Changing engines must use that engine's suggestions. Custom engines should still search normally without sending queries to another provider.

#### 3. Application Shortcuts
- Click "Add" in the sidebar
- Fill in:
  - **Name**: Any website name (e.g., "GitHub")
  - **URL**: Website URL (e.g., "https://github.com")
  - **Icon Type**: Text (default) or Image
  - If Text: Enter a letter and color
  - If Image: Upload an image file
- Click "Save"
- New shortcut should appear in the grid
- Click the shortcut to open the website in a new tab

#### 4. Settings
- Click "Settings" in the sidebar
- Adjust settings:
  - **Wallpaper Source**: Local, Bing, Google
  - **Mask Opacity**: Adjust transparency of wallpaper overlay
  - **Icon Radius**: Change app icon border radius
  - **Search Width**: Adjust search box width
  - **Text Size**: Change font size
  - **Language**: Select language (currently only Chinese available)
- Changes should apply immediately

##### Shortcut Open Behavior
- In Settings, toggle **在新标签页打开快捷方式**
- Click a shortcut in the grid
- Expected:
  - ON: opens the site in a new tab and keeps the New Tab page
  - OFF: opens the site in the current tab

#### 5. Wallpaper Management
- In Settings, change Wallpaper Source to "Local"
- Click "Upload Wallpaper"
- Select an image file
- Image should appear as background
- Click wallpaper refresh button (🔄) to change to Bing/Google wallpapers

#### 6. Edit & Delete Shortcuts
- Hover over any shortcut
- Click the edit button (✎) to modify
- Click the delete button (×) to remove

##### Regression: Edit Mode + Icon Modal
- Right-click a shortcut to enter **edit mode**
- Click the icon edit action to open the **icon editor modal**
- While the modal is open:
  - Left click inside the modal (including icon options)
  - Right click inside the modal
  - Use any buttons/controls inside the modal
- Expected: edit mode should **NOT** exit just because you interacted with the modal

##### Regression: Save Without Changing Icon
- Open the icon editor modal for an existing shortcut
- Do **not** select a new icon option
- Click **Save**
- Expected: the shortcut icon remains unchanged (no fallback to default solid color)

##### Regression: Icon Cached (No Network)
- Set a shortcut icon via online icon option (favicon/network URL)
- Reload the new tab page
- Optional: temporarily go offline (or disable network) and reload again
- Expected: the icon still renders (stored as a data URL in `chrome.storage.local`)

#### 7. Drag & Drop
- Click and drag shortcuts to reorder them
- Changes should be saved automatically

## Console Logs

Check the console for debug messages:
1. Open Developer Tools (F12 or Cmd+Option+I)
2. Go to "Console" tab
3. You should see logs like:
   - `[App] Application initialized successfully`
   - `[Shortcuts] Loaded X apps from storage`
   - `[Settings] Settings loaded successfully`
   - `[Search] Search setup completed`

## Common Issues & Debugging

### "Cannot set properties of null" error
- Check that all HTML element IDs match what modules expect
- Verify HTML file is properly formatted
- Clear browser cache and reload extension

### Settings not saving
- Check Chrome storage is enabled
- Look for `chrome.storage` errors in console
- Try opening Settings again to verify persistence

### Shortcuts not displaying
- Check if grid container (#grid) exists in HTML
- Verify shortcuts are being loaded from storage
- Check console for `[Shortcuts]` log messages

### Search not working
- Verify search-input element exists
- Check if search engine dropdown is accessible
- Try a simple query and check console logs

## Performance Notes

- Initial load may take 1-2 seconds as modules initialize
- Wallpaper loading depends on internet connection
- Large wallpaper images (>5MB) are automatically compressed

## Next Steps

If all features work correctly:
1. The extension is ready for production
2. Package it for distribution
3. Submit to Chrome Web Store if desired
