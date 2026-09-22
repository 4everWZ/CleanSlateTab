import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSuggestionSource } from '../src/utils/searchSuggestions.js';

function fixture(t, fetcher) {
    t.mock.method(globalThis, 'fetch', fetcher);
    const source = createSuggestionSource();
    t.after(() => source.destroy());
    return source;
}

const response = (values) => ({ ok: true, json: async () => ['', values] });

test('routes only supported engines, encodes query, omits credentials, limits and deduplicates suggestions', async (t) => {
    const calls = [];
    const source = fixture(t, async (url, options) => {
        calls.push({ url, options });
        return response([' Weather ', 'weather', '', null, 'A', 'a', ...Array.from({ length: 20 }, (_, i) => `result ${i}`)]);
    });
    const values = await source.get('google', 'weather');
    assert.equal(values.length, 7);
    assert.equal(values[0], 'A');
    await source.get('bing', '中文 & ?');
    await source.get('baidu', '中文 & ?');
    assert.equal(calls[0].url.hostname, 'suggestqueries.google.com');
    assert.equal(calls[1].url.searchParams.get('query'), '中文 & ?');
    assert.equal(calls[2].url.searchParams.get('wd'), '中文 & ?');
    assert.equal(calls[0].options.credentials, 'omit');
    for (const [engine, query] of [['custom', 'word'], ['toString', 'word'], ['google', ''], ['google', 'x'.repeat(201)]]) {
        assert.deepEqual(await source.get(engine, query), []);
    }
    assert.equal(calls.length, 3);
});

test('cache is engine-specific, expires after five minutes and evicts the least recently used entry', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 0 });
    let calls = 0;
    const source = fixture(t, async () => { calls++; return response(['suggestion']); });
    await source.get('google', 'q0');
    await source.get('google', 'q0');
    assert.equal(calls, 1);
    await source.get('bing', 'q0');
    assert.equal(calls, 2);
    for (let i = 1; i < 39; i++) await source.get('google', `q${i}`);
    await source.get('google', 'q0'); // Retain this entry; evict Bing next.
    await source.get('google', 'q39');
    await source.get('google', 'q0');
    assert.equal(calls, 41);
    await source.get('bing', 'q0');
    assert.equal(calls, 42);
    t.mock.timers.tick(300001);
    await source.get('google', 'q0');
    assert.equal(calls, 43);
});

test('new input and explicit cancellation abort old requests; late replies never enter the cache', async (t) => {
    const requests = [];
    const source = fixture(t, (url, options) => new Promise(resolve => requests.push({ options, resolve })));
    const old = source.get('google', 'old');
    const current = source.get('google', 'current');
    assert.equal(requests[0].options.signal.aborted, true);
    requests[0].resolve(response(['obsolete']));
    assert.deepEqual(await old, []);
    source.cancel();
    assert.equal(requests[1].options.signal.aborted, true);
    requests[1].resolve(response(['obsolete too']));
    assert.deepEqual(await current, []);
    const retry = source.get('google', 'old');
    assert.equal(requests.length, 3);
    requests[2].resolve(response(['fresh']));
    assert.deepEqual(await retry, ['fresh']);
});

test('a hanging request times out once without retrying', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let calls = 0;
    const source = fixture(t, (url, { signal }) => new Promise((resolve, reject) => {
        calls++;
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    const pending = source.get('google', 'slow');
    t.mock.timers.tick(3000);
    assert.deepEqual(await pending, []);
    t.mock.timers.tick(60000);
    assert.equal(calls, 1);
});

test('HTTP, malformed JSON and network failures degrade to empty suggestions without caching failures', async (t) => {
    let calls = 0;
    const source = fixture(t, async () => {
        calls++;
        if (calls === 1) return { ok: false };
        if (calls === 2) return { ok: true, json: async () => { throw new SyntaxError('Invalid JSON'); } };
        if (calls === 3) throw new TypeError('Offline');
        if (calls === 4) return { ok: true, json: async () => ({ error: true }) };
        return response(['recovered']);
    });
    for (let i = 0; i < 4; i++) assert.deepEqual(await source.get('google', 'query'), []);
    assert.deepEqual(await source.get('google', 'query'), ['recovered']);
    assert.equal(calls, 5);
});

test('destroy aborts outstanding work and clears cached queries', async (t) => {
    let calls = 0;
    let signal;
    const source = fixture(t, async (url, options) => {
        calls++;
        signal = options.signal;
        if (calls !== 2) return response(['cached']);
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    });
    await source.get('google', 'query');
    const pending = source.get('google', 'pending');
    source.destroy();
    assert.equal(signal.aborted, true);
    assert.deepEqual(await pending, []);
    await source.get('google', 'query');
    assert.equal(calls, 3);
});
