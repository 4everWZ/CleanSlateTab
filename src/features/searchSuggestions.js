import { createSuggestionSource, MAX_QUERY_LENGTH } from '../utils/searchSuggestions.js';

const DEBOUNCE_MS = 180;

export function setupSearchSuggestions(ctx, submit) {
    const { searchInput: input, searchSuggestions: list, searchEngineDropdownMenu: menu } = ctx.dom;
    const source = createSuggestionSource();
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    let timer = null;
    let revision = 0;
    let composing = false;
    let draft = input.value;
    let values = [];
    let active = -1;

    function cancel() {
        clearTimeout(timer);
        timer = null;
        revision += 1;
        source.cancel();
    }

    function close() {
        cancel();
        if (active >= 0) input.value = draft;
        values = [];
        active = -1;
        list.hidden = true;
        list.replaceChildren();
        input.setAttribute('aria-expanded', 'false');
        input.removeAttribute('aria-activedescendant');
    }

    function select(index, preview = false) {
        if (active >= 0) list.children[active]?.setAttribute('aria-selected', 'false');
        active = index;
        const option = list.children[active];
        option.setAttribute('aria-selected', 'true');
        input.setAttribute('aria-activedescendant', option.id);
        if (!preview) input.value = draft;
        if (preview) {
            input.value = active === 0 ? draft : values[active];
            input.setSelectionRange(input.value.length, input.value.length);
            option.scrollIntoView({ block: 'nearest' });
        }
    }

    function render(query, suggestions) {
        values = [query, ...suggestions];
        active = -1;
        const fragment = document.createDocumentFragment();
        values.forEach((value, index) => {
            const option = document.createElement('li');
            option.className = 'search-suggestion';
            option.id = `search-suggestion-${index}`;
            option.dataset.index = index;
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', 'false');
            const label = document.createElement('span');
            const match = value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
            if (index > 0 && match >= 0) {
                const before = document.createElement('strong');
                before.textContent = value.slice(0, match);
                const after = document.createElement('strong');
                after.textContent = value.slice(match + query.length);
                label.append(before, document.createTextNode(value.slice(match, match + query.length)), after);
            } else {
                label.textContent = value;
            }
            option.append(label);
            fragment.append(option);
        });
        list.replaceChildren(fragment);
        list.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        select(0);
    }

    function refresh() {
        // An input event commits any keyboard preview as the new editable draft.
        active = -1;
        close();
        draft = input.value;
        const query = draft.trim();
        if (composing || !query || query.length > MAX_QUERY_LENGTH ||
            document.activeElement !== input || document.hidden || menu?.classList.contains('show')) return;
        render(query, []);
        const currentRevision = revision;
        const engine = ctx.state.currentSearchEngine;
        timer = setTimeout(async () => {
            timer = null;
            const suggestions = await source.get(engine, query);
            if (currentRevision !== revision || engine !== ctx.state.currentSearchEngine ||
                composing || document.activeElement !== input || document.hidden) return;
            render(query, suggestions);
        }, DEBOUNCE_MS);
    }

    input.addEventListener('input', (event) => {
        if (event.isComposing || composing) { close(); return; }
        refresh();
    }, options);
    input.addEventListener('compositionstart', () => { composing = true; close(); }, options);
    input.addEventListener('compositionend', () => { composing = false; refresh(); }, options);
    input.addEventListener('focus', refresh, options);
    input.addEventListener('blur', close, options);
    input.addEventListener('keydown', (event) => {
        if (event.isComposing || composing || event.keyCode === 229) return;
        if (event.key === 'Escape') {
            if (!list.hidden) event.preventDefault();
            close();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (list.hidden) refresh();
            if (!values.length) return;
            // Freeze the visible list while navigating; a late response must not reset selection.
            if (values.length > 1) cancel();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            select((active + step + values.length) % values.length, true);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            const query = active >= 0 ? values[active] : input.value.trim();
            close();
            submit(query);
        } else if (event.key === 'Tab') {
            if (active >= 0) { draft = input.value = values[active]; }
            close();
        }
    }, options);
    list.addEventListener('pointerdown', (event) => {
        if (event.button === 0 && event.target.closest('[role="option"]')) event.preventDefault();
    }, options);
    list.addEventListener('pointermove', (event) => {
        const option = event.target.closest('[role="option"]');
        if (option && Number(option.dataset.index) !== active && (event.movementX || event.movementY)) {
            cancel();
            select(Number(option.dataset.index));
        }
    }, options);
    list.addEventListener('click', (event) => {
        const option = event.target.closest('[role="option"]');
        if (!option) return;
        const query = values[Number(option.dataset.index)];
        close();
        submit(query);
    }, options);
    document.addEventListener('pointerdown', (event) => {
        if (event.target !== input && !list.contains(event.target)) close();
    }, options);
    document.addEventListener('visibilitychange', () => { if (document.hidden) close(); }, options);
    window.addEventListener('pagehide', close, options);

    return {
        close,
        refresh,
        destroy() { close(); listeners.abort(); source.destroy(); },
    };
}
