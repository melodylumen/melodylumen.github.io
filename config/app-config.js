export const APP_CONFIG = {
    githubScopes: ['repo'],
    supportedLanguages: {
        'cr': { name: 'Cree', nativeName: 'ᓀᐦᐃᔭᐍᐏᐣ' },
        'iu': { name: 'Inuktitut', nativeName: 'ᐃᓄᒃᑎᑐᑦ' },
        // ... etc
    },
    api: {
        githubBase: 'https://api.github.com',
        webhookEndpoint: process.env.WEBHOOK_URL || null
    }
};