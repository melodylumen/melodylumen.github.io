window.CONFIG = {
    // API endpoint - can be overridden by environment
    API_BASE_URL: window.WORKER_URL || 'https://gander-social-translation-tool.workers.dev',

    // GitHub API configuration
    GITHUB_API_BASE: 'https://api.github.com',
    GITHUB_SCOPES: ['repo'],

    // Supported languages with native names
    SUPPORTED_LANGUAGES: {
        'cr': { name: 'Cree', nativeName: 'ᓀᐦᐃᔭᐍᐏᐣ' },
        'iu': { name: 'Inuktitut', nativeName: 'ᐃᓄᒃᑎᑐᑦ' },
        'oj': { name: 'Ojibwe', nativeName: 'ᐊᓂᔑᓈᐯᒧᐎᓐ' },
        'miq': { name: "Mi'kmaq", nativeName: "Mi'kmawi'simk" },
        'innu': { name: 'Innu-aimun', nativeName: 'Innu-aimun' },
        'fr': { name: 'French', nativeName: 'Français' },
        'es': { name: 'Spanish', nativeName: 'Español' },
        'de': { name: 'German', nativeName: 'Deutsch' }
    },

    // Auto-save configuration
    AUTO_SAVE_INTERVAL: 30000, // 30 seconds
    DEBOUNCE_DELAY: 500, // 500ms for input debouncing

    // Session configuration
    SESSION_TIMEOUT: 24 * 60 * 60 * 1000, // 24 hours
    HEARTBEAT_INTERVAL: 60000, // 1 minute

    // UI configuration
    MAX_TRANSLATIONS_PER_PAGE: 50,
    SEARCH_DEBOUNCE: 300,

    // Feature flags
    FEATURES: {
        REAL_TIME_COLLABORATION: true,
        AUTO_SAVE: true,
        PROGRESS_TRACKING: true,
        OFFLINE_MODE: false // Not yet implemented
    }
};