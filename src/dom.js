export function getDom() {
    const body = document.getElementById('body');
    const grid = document.getElementById('grid');
    const sidebar = document.getElementById('sidebar');
    const searchInput = document.getElementById('search-input');
    const searchEngineSelector = document.querySelector('.search-engine-selector');
    const searchEngineDropdownMenu = document.getElementById('search-engine-dropdown-menu');
    const searchTypes = document.querySelectorAll('.search-type-btn');
    const searchBox = document.querySelector('.search-box');
    const searchEngineIcon = document.getElementById('search-engine-icon');
    const sidebarToggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
    const shortcutForm = document.getElementById('shortcut-form');
    const iconTypeRadios = document.querySelectorAll('input[name="icon-type"]');
    const wallpaperRefreshBtn = document.getElementById('wallpaper-refresh-btn');
    const addTab = document.getElementById('add-tab');
    const settingsTab = document.getElementById('settings-tab');
    const addPanel = document.getElementById('add-panel');
    const settingsPanel = document.getElementById('settings-panel');

    return {
        body,
        grid,
        sidebar,
        searchInput,
        searchSuggestions: document.getElementById('search-suggestions'),
        searchEngineSelector,
        searchEngineDropdownMenu,
        searchTypes,
        searchBox,
        searchEngineIcon,
        sidebarToggleBtn,
        sidebarCloseBtn,
        shortcutForm,
        iconTypeRadios,
        wallpaperRefreshBtn,
        addTab,
        settingsTab,
        addPanel,
        settingsPanel,

        container: document.querySelector('.container'),
        pagination: document.getElementById('pagination'),
        dropdownDivider: document.querySelector('.dropdown-divider'),
        dropdownAdd: document.querySelector('.dropdown-add'),
    };
}
