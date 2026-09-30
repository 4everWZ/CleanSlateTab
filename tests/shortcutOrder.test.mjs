import { test } from 'node:test';
import assert from 'node:assert/strict';
import { insertShortcutAt } from '../src/utils/shortcutOrder.js';

test('inserts backward and shifts the target and following items, instead of swapping', () => {
    const apps = ['A', 'B', 'C', 'D'];
    assert.deepEqual(insertShortcutAt(apps, 3, 1), { apps: ['A', 'D', 'B', 'C'], insertedIndex: 1 });
    assert.deepEqual(apps, ['A', 'B', 'C', 'D']);
});

test('forward insertion removes the source before resolving the target slot', () => {
    assert.deepEqual(insertShortcutAt(['A', 'B', 'C', 'D'], 0, 3), { apps: ['B', 'C', 'A', 'D'], insertedIndex: 2 });
});

test('inserts after a target or at the very end without exchanging its contents', () => {
    assert.deepEqual(insertShortcutAt(['A', 'B', 'C', 'D'], 0, 4), { apps: ['B', 'C', 'D', 'A'], insertedIndex: 3 });
    assert.deepEqual(insertShortcutAt(['A', 'B', 'C', 'D'], 3, 2), { apps: ['A', 'B', 'D', 'C'], insertedIndex: 2 });
});

test('legacy empty slots do not corrupt original DOM indices or lose apps', () => {
    const a = { name: 'A' }, b = { name: 'B' }, c = { name: 'C' };
    assert.deepEqual(insertShortcutAt([null, a, undefined, b, c], 4, 1), { apps: [c, a, b], insertedIndex: 0 });
    assert.deepEqual(insertShortcutAt([null, a, undefined, b, c], 1, 4), { apps: [b, a, c], insertedIndex: 1 });
});

test('same slot, already adjacent, invalid and external drops are no-ops', () => {
    const apps = ['A', 'B', 'C'];
    for (const [from, target] of [[0, 0], [0, 1], [-1, 1], [0, 10], [null, 1], [0, NaN]]) {
        assert.equal(insertShortcutAt(apps, from, target), null);
    }
});

test('cross-page insertion retains intermediate order and returns the moved item page index', () => {
    const apps = Array.from({ length: 18 }, (_, i) => ({ id: i }));
    const result = insertShortcutAt(apps, 1, 12);
    assert.deepEqual(result.apps.map(app => app.id), [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 1, 12, 13, 14, 15, 16, 17]);
    assert.equal(result.insertedIndex, 11);
    assert.equal(new Set(result.apps).size, 18);
});
