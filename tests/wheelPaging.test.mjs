import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWheelPager } from '../src/utils/wheelPaging.js';

function fixture() {
    const state = { pages: 4, blocked: false, turns: [], counts: 0 };
    const pager = createWheelPager({
        getPageCount: () => { state.counts++; return state.pages; },
        isBlocked: () => state.blocked,
        onPage: direction => state.turns.push(direction),
    });
    const wheel = (timeStamp, deltaX, deltaY, extra = {}) => {
        const event = {
            timeStamp, deltaX, deltaY, deltaMode: 0, cancelable: true,
            defaultPrevented: false,
            preventDefault() { this.defaultPrevented = true; },
            ...extra,
        };
        pager.handleWheel(event);
        return event.defaultPrevented;
    };
    return { state, pager, wheel };
}

test('mouse notches accept fractional pixel distances and display scaling', () => {
    for (const [deltaY, wheelDeltaY, devicePixelRatio] of [
        [40, -120, 1], [33.333333, -120, 1], [80, -96, 1.25], [66.666667, -80, 1.5], [50, -60, 2],
    ]) {
        const { wheel, state } = fixture();
        assert.equal(wheel(0, 0, deltaY, { wheelDeltaY, view: { devicePixelRatio } }), true);
        assert.deepEqual(state.turns, [1], `mouse delta ${deltaY}, scale ${devicePixelRatio}`);
    }
});

test('continuous mouse scrolling pages repeatedly without waiting for an idle gap', () => {
    const { wheel, state } = fixture();
    for (let time = 0; time <= 720; time += 180) wheel(time, 0, 100, { wheelDeltaY: -120 });
    assert.deepEqual(state.turns, [1, 1, 1, 1, 1]);
    wheel(736, 0, -100, { wheelDeltaY: 120 });
    assert.equal(state.turns.at(-1), -1);
});

test('fast mouse notches are rate limited without latching continuous scrolling', () => {
    const { wheel, state } = fixture();
    for (let time = 0; time <= 640; time += 16) assert.equal(wheel(time, 0, 3, { deltaMode: 1 }), true);
    assert.deepEqual(state.turns, [1, 1, 1, 1, 1]);
});

test('light horizontal displacement, long micro-drift and diagonal motion do not page', () => {
    for (const sequence of [Array(8).fill([6, 0]), Array(400).fill([1, 0]), Array(30).fill([8, 7])]) {
        const { wheel, state } = fixture();
        sequence.forEach(([x, y], i) => wheel(i * 10, x, y));
        assert.deepEqual(state.turns, []);
    }
});

test('small renewed or reversed displacement after paging stays below the dead zone', () => {
    for (const direction of [1, -1]) {
        const { wheel, state } = fixture();
        wheel(0, 100, 0);
        [30, 16, 8, 3, 1, 0.5].forEach((x, i) => wheel(16 + i * 16, x, 0));
        [12, 12, 12, 12].forEach((x, i) => wheel(112 + i * 16, x * direction, 0));
        for (let i = 0; i < 200; i++) wheel(176 + i * 16, 0.5 * direction, 0);
        assert.deepEqual(state.turns, [1]);
    }
});

test('deliberate horizontal trackpad motion accumulates beyond the dead zone in both directions', () => {
    const { wheel, state } = fixture();
    for (let i = 0; i < 20; i++) assert.equal(wheel(i * 8, 4, -0.25), true);
    assert.deepEqual(state.turns, [1]);
    assert.equal(state.counts, 1);
    for (let i = 0; i < 20; i++) wheel(500 + i * 8, -4, 0.25);
    assert.deepEqual(state.turns, [1, -1]);
});

test('vertical trackpad gestures stay native even with sideways noise and large accelerated deltas', () => {
    const { wheel, state } = fixture();
    for (let i = 0; i < 30; i++) assert.equal(wheel(i * 8, 0.1, i % 2 ? -1 : 1), false);
    assert.deepEqual(state.turns, []);
    assert.equal(wheel(500, 0, -2), false);
    for (let i = 1; i < 24; i++) assert.equal(wheel(500 + i * 8, 0, -120), false);
    assert.deepEqual(state.turns, []);
    assert.equal(state.counts, 0);
});

test('momentum lasting seconds triggers one page, including tail reversals; a new burst rearms', () => {
    const { wheel, state } = fixture();
    assert.equal(wheel(0, 100, 0), true);
    for (let time = 16; time < 2500; time += 16) assert.equal(wheel(time, time < 1000 ? 8 : -0.2, 0), true);
    assert.deepEqual(state.turns, [1]);
    assert.equal(state.counts, 1);
    wheel(2800, 0, 120);
    assert.deepEqual(state.turns, [1, 1]);
});

test('normalizes line/page units and preserves ordinary pixel mouse wheel input', () => {
    const { wheel, state } = fixture();
    wheel(0, 0, 3, { deltaMode: 1 });
    wheel(500, -1, 0, { deltaMode: 2 });
    wheel(1000, 0, 120);
    assert.deepEqual(state.turns, [1, -1, 1]);
});

test('Chromium legacy notch metadata distinguishes typical wheel and precise trackpad events', () => {
    const { wheel, state } = fixture();
    assert.equal(wheel(0, 0, 100, { wheelDeltaY: -120 }), true);
    assert.equal(wheel(500, 0, -50, { wheelDeltaY: 120 }), true);
    assert.equal(wheel(1000, 0, 120, { wheelDeltaY: -360 }), false);
    assert.equal(wheel(1500, 0, 100.5), false);
    assert.deepEqual(state.turns, [1, -1]);
});

test('pinch/modifier gestures, active dragging and single-page grids retain native behavior', () => {
    const { wheel, state } = fixture();
    for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) assert.equal(wheel(0, 0, 100, { [modifier]: true }), false);
    state.blocked = true;
    assert.equal(wheel(500, 0, 100), false);
    state.blocked = false;
    state.pages = 1;
    assert.equal(wheel(1000, 0, 100), false);
    assert.deepEqual(state.turns, []);
});

test('reset discards partial gestures and allows resuming after page visibility changes', () => {
    const { wheel, state, pager } = fixture();
    wheel(0, 50, 0);
    pager.reset();
    wheel(16, 50, 0);
    assert.deepEqual(state.turns, []);
    wheel(32, 30, 0);
    assert.deepEqual(state.turns, [1]);
    pager.reset();
    wheel(48, 80, 0);
    assert.deepEqual(state.turns, [1, 1]);
});

test('deliberate left-right reversals work without an idle gap or animation wait', () => {
    const { wheel, state } = fixture();
    wheel(0, 100, 0);
    wheel(16, -40, 0);
    wheel(32, -40, 0);
    wheel(48, 40, 0);
    wheel(64, 40, 0);
    assert.deepEqual(state.turns, [1, -1, 1]);
});

test('slow reversing momentum cannot accumulate indefinitely into another page', () => {
    const { wheel, state } = fixture();
    wheel(0, 100, 0);
    for (let time = 16; time < 4000; time += 16) wheel(time, -1, 0);
    assert.deepEqual(state.turns, [1]);
});

test('repeated same-direction swipes rearm after each idle gap', () => {
    const { wheel, state } = fixture();
    for (let i = 0; i < 8; i++) wheel(i * 250, 100, 0);
    assert.deepEqual(state.turns, Array(8).fill(1));
});

test('successive same-direction swipes rearm over uninterrupted momentum events', () => {
    for (const direction of [1, -1]) {
        const { wheel, state } = fixture();
        let time = 0;
        const send = value => { wheel(time, direction * value, 0); time += 16; };
        send(100);
        for (let stroke = 0; stroke < 12; stroke++) {
            [30, 16, 8, 3, 1, 0.5, 20, 30, 36].forEach(send);
        }
        assert.deepEqual(state.turns, Array(13).fill(direction));
        assert.equal(state.counts, 1);
    }
});

test('one accelerating stroke and its long decaying tail still turn only one page', () => {
    const { wheel, state } = fixture();
    let time = 0;
    for (const delta of [4, 8, 12, 16, 24, 40, 60, 48, 32, 24, 16, 8, 4, 2, 1]) {
        wheel(time, delta, 0);
        time += 16;
    }
    for (let i = 0; i < 200; i++) wheel(time + i * 16, i % 2 ? 0.3 : 0.6, 0);
    assert.deepEqual(state.turns, [1]);
});

test('a single sample dip or a small tail spike cannot restart the same-direction gesture', () => {
    const { wheel, state } = fixture();
    let time = 0;
    for (const delta of [100, 1, 100, 100, 100, 20, 8, 2, 1, 12, 0.5, 0.5, 0.5]) {
        wheel(time, delta, 0);
        time += 16;
    }
    for (let i = 0; i < 100; i++) wheel(time + i * 16, 0.5, 0);
    assert.deepEqual(state.turns, [1]);
});
