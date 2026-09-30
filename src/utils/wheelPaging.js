const GESTURE_GAP_MS = 200;
const PAGE_THRESHOLD_PX = 80;
const START_WINDOW_MS = 240;
const HORIZONTAL_AXIS_RATIO = 1.5;
const WHEEL_PAGE_INTERVAL_MS = 160;
const LINE_HEIGHT_PX = 16;
const INTENT_WINDOW_MS = 120;
const MIN_RENEWED_DELTA_PX = 8;

function notchCount(delta, scale) {
    const scaled = delta * scale;
    const ticks = Math.round(scaled / 120);
    // Legacy deltas are integers, so scaling can lose part of a pixel.
    return ticks > 0 && Math.abs(scaled - ticks * 120) <= scale ? ticks : 0;
}

function isDiscreteWheel(event) {
    if (event.deltaX !== 0 || !event.deltaY) return false;
    if (event.deltaMode === 1 || event.deltaMode === 2) return true;
    const delta = Math.abs(event.deltaY);
    const legacyDelta = Math.abs(event.wheelDeltaY || 0);
    if (legacyDelta) {
        // A mouse notch can have fractional CSS-pixel distance. Chromium may
        // also scale legacy tick metadata by devicePixelRatio; undo that scaling.
        const ticks = notchCount(legacyDelta, 1) || notchCount(legacyDelta, event.view?.devicePixelRatio || 1);
        // A single notch includes the common 40 px / 120 legacy-delta mouse case.
        // Larger proportional deltas are ambiguous with accelerated trackpads.
        return ticks > 0 && (ticks === 1 || Math.abs(legacyDelta - delta * 3) > 1);
    }
    // Fallback for drivers without legacy metadata. This is a heuristic, not a
    // hardware identity: smooth wheels and coarse trackpads can be ambiguous.
    return Number.isInteger(delta) && delta >= 100 && (delta % 100 === 0 || delta % 120 === 0);
}

// Trackpads deliver small pixel deltas and long momentum tails. Accumulate one
// stroke and latch after paging. An idle gap, deliberate horizontal reversal,
// or renewed acceleration after decay starts another stroke. A momentum tail
// alone must not rearm paging, even when it bridges successive physical swipes.
// Classification is locked per burst so a trackpad's acceleration/momentum
// cannot turn a small vertical gesture into mouse-wheel paging halfway through.
export function createWheelPager({ getPageCount, isBlocked, onPage }) {
    let lastTime = null;
    let distanceX = 0;
    let mode = 'native';
    let consumed = false;
    let pageCount = 1;
    let pageDirection = 0;
    let intentDistance = 0;
    let intentStart = null;
    let peak = 0;
    let floor = 0;
    let decaySamples = 0;
    let startTime = null;
    let lastWheelPageTime = null;

    function reset() {
        lastTime = null;
        distanceX = 0;
        mode = 'native';
        consumed = false;
        pageCount = 1;
        pageDirection = 0;
        intentDistance = 0;
        intentStart = null;
        peak = 0;
        floor = 0;
        decaySamples = 0;
        startTime = null;
        lastWheelPageTime = null;
    }

    function trackDecay(magnitude) {
        if (magnitude >= peak) {
            peak = magnitude;
            floor = magnitude;
            decaySamples = 0;
        } else if (magnitude <= peak / 2) {
            floor = Math.min(floor, magnitude);
            decaySamples = Math.min(2, decaySamples + 1);
        } else {
            floor = magnitude;
            decaySamples = 0;
        }
    }

    function handleWheel(event) {
        // A trackpad pinch can arrive as Ctrl+wheel. Keep browser gestures native.
        if (event.ctrlKey || event.metaKey || event.altKey || isBlocked()) {
            reset();
            return;
        }
        const { deltaX, deltaY, deltaMode, timeStamp } = event;
        if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || (!deltaX && !deltaY)) return;

        if (lastTime === null || timeStamp - lastTime >= GESTURE_GAP_MS || timeStamp < lastTime) {
            reset();
            mode = Math.abs(deltaX) > Math.abs(deltaY) * HORIZONTAL_AXIS_RATIO ? 'horizontal' : isDiscreteWheel(event) ? 'wheel' : 'native';
            // Count pages once per gesture, not on every high-frequency wheel event.
            if (mode !== 'native') pageCount = getPageCount();
        }
        lastTime = timeStamp;
        if (mode === 'native' || pageCount <= 1) return;

        if (mode === 'wheel') {
            // Mouse notches are discrete actions, not trackpad momentum. Keep
            // continuous scrolling responsive with a timestamp-only rate limit.
            if (!isDiscreteWheel(event)) {
                mode = 'native';
                return;
            }
            if (event.cancelable) event.preventDefault();
            const direction = Math.sign(deltaY);
            if (lastWheelPageTime === null || direction !== pageDirection || timeStamp - lastWheelPageTime >= WHEEL_PAGE_INTERVAL_MS) {
                lastWheelPageTime = timeStamp;
                pageDirection = direction;
                onPage(direction);
            }
            return;
        }

        // Suppress native scrolling for the entire consumed burst, including its
        // sub-threshold start and momentum tail, so the page doesn't jump beneath it.
        if (event.cancelable) event.preventDefault();
        const scaleX = deltaMode === 1 ? LINE_HEIGHT_PX : deltaMode === 2 ? (event.view?.innerWidth || 800) : 1;
        const movementX = deltaX * scaleX;
        const magnitude = Math.abs(movementX);
        // Reject diagonal drift even after the initial horizontal event. It must
        // not contribute to either the first stroke or a renewed paging intent.
        if (Math.abs(deltaX) <= Math.abs(deltaY) * HORIZONTAL_AXIS_RATIO) {
            distanceX = 0;
            startTime = null;
            intentDistance = 0;
            intentStart = null;
            return;
        }
        if (consumed) {
            if (intentStart !== null && (timeStamp - intentStart > INTENT_WINDOW_MS || movementX * intentDistance < 0)) {
                intentStart = null;
                intentDistance = 0;
            }
            const reversing = movementX * pageDirection < 0;
            // Require sustained decay before accepting fresh same-direction force.
            // One low sample or small tail oscillations are insufficient evidence.
            const renewed = decaySamples >= 2 && magnitude >= Math.max(MIN_RENEWED_DELTA_PX, floor * 2);
            if (intentStart === null && (reversing || renewed)) {
                intentStart = timeStamp;
            }
            trackDecay(magnitude);
            if (intentStart === null) return;
            intentDistance += movementX;
            if (Math.abs(intentDistance) < PAGE_THRESHOLD_PX) return;
            // Reuse confirmed motion without counting this event twice. Navigation
            // may supersede an active animation; no timer or animation lock is used.
            distanceX = intentDistance - movementX;
            consumed = false;
        } else if (startTime === null || timeStamp - startTime > START_WINDOW_MS || distanceX * movementX < 0) {
            // Tiny ongoing motion must never accumulate for seconds into a page.
            startTime = timeStamp;
            distanceX = 0;
        }
        distanceX += movementX;
        if (Math.abs(distanceX) < PAGE_THRESHOLD_PX) return;

        consumed = true;
        pageDirection = Math.sign(distanceX);
        intentDistance = 0;
        intentStart = null;
        peak = magnitude;
        floor = magnitude;
        decaySamples = 0;
        onPage(pageDirection);
    }

    return { handleWheel, reset };
}
