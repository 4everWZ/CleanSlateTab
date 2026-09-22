const PROVIDERS = {
    google: ['https://suggestqueries.google.com/complete/search?client=firefox', 'q'],
    bing: ['https://api.bing.com/osjson.aspx', 'query'],
    baidu: ['https://suggestion.baidu.com/su?action=opensearch&ie=utf-8', 'wd'],
};

export const MAX_QUERY_LENGTH = 200;
const MAX_SUGGESTIONS = 7;
const CACHE_LIMIT = 40;
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 3000;

// Each search box owns its requests and bounded, memory-only cache.
export function createSuggestionSource() {
    const cache = new Map();
    let pending = null;

    function cancel() {
        if (!pending) return;
        clearTimeout(pending.timeout);
        pending.controller.abort();
        pending = null;
    }

    async function get(engine, query) {
        cancel();
        const provider = Object.hasOwn(PROVIDERS, engine) ? PROVIDERS[engine] : null;
        if (!provider || !query || query.length > MAX_QUERY_LENGTH) return [];

        const key = `${engine}:${query}`;
        const cached = cache.get(key);
        if (cached) {
            cache.delete(key);
            if (Date.now() - cached.time < CACHE_TTL_MS) {
                cache.set(key, cached);
                return cached.values;
            }
        }

        const url = new URL(provider[0]);
        url.searchParams.set(provider[1], query);
        const request = { controller: new AbortController(), timeout: null };
        request.timeout = setTimeout(() => request.controller.abort(), REQUEST_TIMEOUT_MS);
        pending = request;
        try {
            const response = await fetch(url, {
                signal: request.controller.signal,
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                cache: 'no-store',
            });
            if (!response.ok) return [];
            const data = await response.json();
            if (request.controller.signal.aborted || !Array.isArray(data?.[1])) return [];

            const values = [];
            const seen = new Set([query.toLocaleLowerCase()]);
            // Bound work even if a provider unexpectedly returns a very large list.
            for (const value of data[1].slice(0, 50)) {
                if (typeof value !== 'string') continue;
                const text = value.trim();
                const normalized = text.toLocaleLowerCase();
                if (!text || text.length > MAX_QUERY_LENGTH || seen.has(normalized)) continue;
                seen.add(normalized);
                values.push(text);
                if (values.length === MAX_SUGGESTIONS) break;
            }
            cache.set(key, { time: Date.now(), values });
            if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
            return values;
        } catch {
            // Suggestions are optional: network/JSON failures never block search or retry.
            return [];
        } finally {
            clearTimeout(request.timeout);
            if (pending === request) pending = null;
        }
    }

    return { get, cancel, destroy() { cancel(); cache.clear(); } };
}
