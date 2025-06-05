// service-worker.js
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open('po-tool-v1').then((cache) => {
            return cache.addAll([
                '/',
                '/index.html',
                '/styles/main.css',
                '/scripts/app.js',
                // ... other assets
            ]);
        })
    );
});