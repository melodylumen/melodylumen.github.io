// tests/setup.js - Test setup and mocks

// Mock global objects that would be available in the browser
global.window = {
    localStorage: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn()
    },
    location: {
        hostname: 'localhost',
        protocol: 'http:',
        href: 'http://localhost:8000'
    },
    fetch: vi.fn(),
    WebSocket: vi.fn(() => ({
        send: vi.fn(),
        close: vi.fn(),
        addEventListener: vi.fn(),
        readyState: 1
    }))
};

// Mock crypto for Node.js environment
global.crypto = {
    randomUUID: () => 'test-uuid-' + Math.random().toString(36).substr(2, 9)
};

// Mock console methods to reduce noise in tests
global.console = {
    ...console,
    log: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn()
};

// Export test utilities
export const mockFetch = (response, ok = true) => {
    global.window.fetch.mockResolvedValue({
        ok,
        status: ok ? 200 : 400,
        json: () => Promise.resolve(response),
        text: () => Promise.resolve(JSON.stringify(response))
    });
};

export const mockLocalStorage = (items = {}) => {
    global.window.localStorage.getItem.mockImplementation(key => items[key] || null);
};
