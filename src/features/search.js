import { BUILTIN_ENGINES } from '../constants.js';
import { storageSet } from '../utils/storage.js';
import { setupSearchSuggestions } from './searchSuggestions.js';

export function updateSearchEngineIcon(ctx) {
    const engine = ctx.state.currentSearchEngine;
    const iconData = ctx.state.searchEngineIconsData[engine];
    const { searchEngineIcon } = ctx.dom;

    if (!iconData || !searchEngineIcon) return;

    searchEngineIcon.innerHTML = `
        <svg class="icon-svg" viewBox="1 1 22 22" xmlns="http://www.w3.org/2000/svg" style="overflow: visible;">
            <circle cx="12" cy="12" r="11" fill="${iconData.color}"/>
            <text x="12" y="12" text-anchor="middle" dominant-baseline="central" font-size="16" font-weight="bold" font-family="Arial, sans-serif" fill="white">${iconData.text}</text>
        </svg>
    `;
}

export function restoreCustomEngineOptions(ctx) {
    const { dropdownDivider } = ctx.dom;
    if (!dropdownDivider) return;

    Object.keys(ctx.state.searchEngines).forEach((engineKey) => {
        if (BUILTIN_ENGINES.includes(engineKey)) return;
        if (document.querySelector(`[data-engine="${engineKey}"]`)) return;

        const engineDisplayName = engineKey.charAt(0).toUpperCase() + engineKey.slice(1);

        const option = document.createElement('div');
        option.className = 'dropdown-option';
        option.dataset.engine = engineKey;
        option.innerHTML = `
            <svg class="dropdown-icon" viewBox="0 0 24 24">
                <text x="12" y="16" text-anchor="middle" font-size="14" font-family="Arial" fill="#999">${engineDisplayName[0].toUpperCase()}</text>
            </svg>
            <span>${engineDisplayName}</span>
            <button class="delete-engine-btn" title="Delete">×</button>
        `;

        dropdownDivider.parentNode.insertBefore(option, dropdownDivider);
    });
}

export function syncEngineActiveUI(ctx) {
    const current = ctx.state.currentSearchEngine;
    document.querySelectorAll('.dropdown-option').forEach((option) => {
        if (option.dataset.engine === current) {
            option.classList.add('active');
        } else {
            option.classList.remove('active');
        }
    });
    updateSearchEngineIcon(ctx);
}

export function setupSearch(ctx) {
    ctx._handlers.searchCleanup?.();
    const listeners = new AbortController();
    const on = (target, type, handler) => target?.addEventListener(type, handler, { signal: listeners.signal });
    const {
        searchInput,
        searchBox,
        searchEngineSelector,
        searchEngineDropdownMenu,
        searchTypes,
        dropdownAdd,
    } = ctx.dom;

    const suggestions = setupSearchSuggestions(ctx, (query) => {
        if (!query) return;
        const engine = ctx.state.searchEngines?.[ctx.state.currentSearchEngine];
        const template = engine?.[ctx.state.currentSearchType] || engine?.web;
        if (template) window.location.href = template.replace('{query}', encodeURIComponent(query));
    });
    ctx._handlers.searchCleanup = () => {
        listeners.abort();
        suggestions.destroy();
    };

    const closeEngineMenu = () => {
        searchEngineSelector?.classList.remove('active');
        searchEngineSelector?.setAttribute('aria-expanded', 'false');
        searchEngineDropdownMenu?.classList.remove('show');
    };

    // Decorative padding focuses the real input; it never becomes a text/caret target.
    on(searchBox, 'pointerdown', (event) => {
        if (event.target !== searchBox || event.button !== 0) return;
        event.preventDefault();
        closeEngineMenu();
        searchInput?.focus();
    });
    on(searchInput, 'focus', () => {
        if (searchEngineDropdownMenu?.classList.contains('show')) {
            closeEngineMenu();
            suggestions.refresh();
        }
    });
    on(searchEngineSelector, 'keydown', (event) => {
        if (event.key === 'Escape') closeEngineMenu();
    });

    updateSearchEngineIcon(ctx);

    // Toggle dropdown
    on(searchEngineSelector, 'click', (e) => {
        e.stopPropagation();
        suggestions.close();
        searchEngineSelector.classList.toggle('active');
        searchEngineDropdownMenu?.classList.toggle('show');
        searchEngineSelector.setAttribute('aria-expanded', String(searchEngineSelector.classList.contains('active')));
    });

    // Click outside closes
    on(document, 'click', (e) => {
        if (!e.target.closest('.search-box-wrapper')) {
            closeEngineMenu();
        }
    });

    // Event delegation for engine select / delete
    on(searchEngineDropdownMenu, 'click', async (e) => {
        const deleteBtn = e.target.closest('.delete-engine-btn');
        const option = e.target.closest('.dropdown-option');

        if (!option) return;
        e.stopPropagation();

        const engine = option.dataset.engine;

        if (deleteBtn) {
            const engineName = option.querySelector('span')?.textContent || engine;
            if (BUILTIN_ENGINES.includes(engine)) {
                alert('内置搜索引擎不能删除');
                return;
            }

            if (confirm(`确定删除"${engineName}"吗？`)) {
                delete ctx.state.searchEngines[engine];
                delete ctx.state.searchEngineIconsData[engine];
                option.remove();

                await storageSet({
                    customSearchEngines: ctx.state.searchEngines,
                    customEngineIcons: ctx.state.searchEngineIconsData,
                });

                if (ctx.state.currentSearchEngine === engine) {
                    ctx.state.currentSearchEngine = 'google';
                    ctx.state.settings.currentSearchEngine = 'google';
                    syncEngineActiveUI(ctx);
                    await ctx.actions.saveSettings();
                }
            }
            return;
        }

        // Select engine
        suggestions.close();
        ctx.state.currentSearchEngine = engine;
        ctx.state.settings.currentSearchEngine = engine;
        syncEngineActiveUI(ctx);
        closeEngineMenu();
        await ctx.actions.saveSettings();
        if (listeners.signal.aborted) return;
        searchInput?.focus();
    });

    // Search type tabs
    searchTypes?.forEach((btn) => {
        on(btn, 'click', () => {
            suggestions.close();
            searchTypes.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            ctx.state.currentSearchType = btn.dataset.type;
        });
    });

    // Add custom engine
    on(dropdownAdd, 'click', async () => {
        const name = prompt('输入搜索引擎名称 (如: DuckDuckGo)');
        if (!name) return;

        const baseUrl = prompt('输入搜索引擎的基础URL\n例: https://duckduckgo.com/\n（不需要手动添加查询参数）');
        if (!baseUrl) return;

        let url = baseUrl.trim();
        if (!url.endsWith('=') && !url.endsWith('?')) {
            if (url.includes('?')) {
                url += '&q=';
            } else {
                url += '?q=';
            }
        }
        url += '{query}';

        const engineKey = name.toLowerCase().replace(/\s+/g, '');
        ctx.state.searchEngines[engineKey] = { web: url };
        ctx.state.searchEngineIconsData[engineKey] = {
            color: '#' + Math.floor(Math.random() * 16777215).toString(16),
            text: name[0].toUpperCase(),
        };

        await storageSet({
            customSearchEngines: ctx.state.searchEngines,
            customEngineIcons: ctx.state.searchEngineIconsData,
        });

        // Insert option before divider
        const divider = document.querySelector('.dropdown-divider');
        if (divider && !document.querySelector(`[data-engine="${engineKey}"]`)) {
            const newOption = document.createElement('div');
            newOption.className = 'dropdown-option';
            newOption.dataset.engine = engineKey;
            newOption.innerHTML = `
                <svg class="dropdown-icon" viewBox="0 0 24 24">
                    <text x="12" y="16" text-anchor="middle" font-size="14" font-family="Arial" fill="#999">${name[0].toUpperCase()}</text>
                </svg>
                <span>${name}</span>
                <button class="delete-engine-btn" title="Delete">×</button>
            `;
            divider.parentNode.insertBefore(newOption, divider);
        }

        closeEngineMenu();
    });
}
