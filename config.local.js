// config.local.js - Local development configuration
// This file should be loaded before the main config for local development

window.WORKER_URL = 'http://localhost:8787';
window.ENVIRONMENT = 'development';

// Override any production settings for local development
window.LOCAL_CONFIG = {
    // Use local worker for development
    useLocalWorker: true,
    
    // Enable debug logging
    debug: true,
    
    // Disable some features that require production setup
    disableWebSocket: false,
    
    // Test credentials that work out of the box
    testTokens: ['DEV-TOKEN-123', 'TEST-TOKEN-456']
};

console.log('🔧 Local development configuration loaded');
console.log('Worker URL:', window.WORKER_URL);
