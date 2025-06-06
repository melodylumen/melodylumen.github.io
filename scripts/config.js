// scripts/config.js - Updated to support dynamic languages
window.CONFIG = {
    // API endpoint - can be overridden by environment
    API_BASE_URL: window.WORKER_URL || 'https://gander-social-translation-tool.workers.dev',

    // GitHub API configuration
    GITHUB_API_BASE: 'https://api.github.com',
    GITHUB_SCOPES: ['repo'],

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
        OFFLINE_MODE: false, // Not yet implemented
        LANGUAGE_CREATION: true // New feature flag
    },

    // Known language names (will be supplemented by dynamic data)
    LANGUAGE_NAMES: {
        // Indigenous languages
        'cr': 'Cree (ᓀᐦᐃᔭᐍᐏᐣ)',
        'iu': 'Inuktitut (ᐃᓄᒃᑎᑐᑦ)',
        'oj': 'Ojibwe (ᐊᓂᔑᓈᐯᒧᐎᓐ)',
        'miq': "Mi'kmaq",
        'innu': 'Innu-aimun',

        // Common languages
        'en': 'English',
        'fr': 'French',
        'es': 'Spanish',
        'de': 'German',
        'pt': 'Portuguese',
        'it': 'Italian',
        'nl': 'Dutch',
        'pl': 'Polish',
        'ru': 'Russian',
        'ja': 'Japanese',
        'ko': 'Korean',
        'zh': 'Chinese',
        'ar': 'Arabic',
        'hi': 'Hindi',
        'bn': 'Bengali',
        'ur': 'Urdu',
        'tr': 'Turkish',
        'vi': 'Vietnamese',
        'th': 'Thai',
        'id': 'Indonesian',
        'ms': 'Malay',
        'sv': 'Swedish',
        'no': 'Norwegian',
        'da': 'Danish',
        'fi': 'Finnish',
        'el': 'Greek',
        'he': 'Hebrew',
        'cs': 'Czech',
        'sk': 'Slovak',
        'hu': 'Hungarian',
        'ro': 'Romanian',
        'bg': 'Bulgarian',
        'uk': 'Ukrainian'
    }
};