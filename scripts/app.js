// scripts/app.js - Updated with pagination and efficient loading
class TranslationApp {
    constructor() {
        this.api = new APIClient();
        this.currentUser = null;
        this.currentRepo = null;
        this.currentLanguage = null;
        this.availableLanguages = [];
        this.canCreateLanguage = false;
        this.ws = null;
        this.changes = new Map();

        // Pagination state
        this.currentPage = 0;
        this.pageSize = 50;
        this.hasMorePages = false;
        this.totalTranslations = 0;
        this.loadedTranslations = new Map(); // msgid -> translation data
        this.isLoading = false;

        // Search state
        this.searchMode = false;
        this.searchTerm = '';
        this.searchDebounceTimer = null;
    }

    // ... (keep existing init, auth, and other methods)

    async selectLanguage(language) {
        this.currentLanguage = language;
        const repoKey = `${this.currentRepo.owner}/${this.currentRepo.name}`;

        try {
            this.showLoading('Loading translations...');

            // Reset pagination state
            this.currentPage = 0;
            this.loadedTranslations.clear();
            this.changes.clear();

            // Connect WebSocket for real-time collaboration
            this.connectWebSocket();

            // Load first page of translations
            await this.loadTranslationPage(0);

            // Update UI
            document.getElementById('workspace-title').textContent =
                `${this.currentRepo.name} - ${this.getLanguageName(language)}`;

            document.getElementById('language-selector').style.display = 'none';
            document.getElementById('translation-workspace').style.display = 'block';

            this.updateChangeCounter();
            this.updatePaginationControls();
        } catch (error) {
            alert(`Failed to load translations: ${error.message}`);
        } finally {
            this.hideLoading();
        }
    }

    async loadTranslationPage(page) {
        if (this.isLoading) return;

        this.isLoading = true;
        const repoKey = `${this.currentRepo.owner}/${this.currentRepo.name}`;

        try {
            const result = await this.api.getTranslations(
                repoKey,
                this.currentLanguage,
                page,
                this.pageSize,
                this.searchMode ? this.searchTerm : null
            );

            // Store translations in our map
            Object.entries(result.translations).forEach(([msgid, data]) => {
                this.loadedTranslations.set(msgid, data);
            });

            // Update pagination state
            this.currentPage = page;
            this.hasMorePages = result.pagination?.hasMore || false;
            this.totalTranslations = result.pagination?.total || this.loadedTranslations.size;

            // Render the new translations
            if (page === 0) {
                this.renderTranslations();
            } else {
                this.appendTranslations(result.translations);
            }

            this.updatePaginationControls();
        } finally {
            this.isLoading = false;
        }
    }

    renderTranslations() {
        const container = document.getElementById('translation-cards');
        container.innerHTML = '';

        // Add pagination controls at the top
        const topControls = this.createPaginationControls('top');
        container.appendChild(topControls);

        // Render all loaded translations
        this.loadedTranslations.forEach((data, msgid) => {
            const card = this.createTranslationCard(msgid, data);
            container.appendChild(card);
        });

        // Add pagination controls at the bottom
        const bottomControls = this.createPaginationControls('bottom');
        container.appendChild(bottomControls);

        // Add intersection observer for infinite scroll
        this.setupInfiniteScroll();
    }

    appendTranslations(translations) {
        const container = document.getElementById('translation-cards');
        const bottomControls = container.querySelector('.pagination-controls.bottom');

        Object.entries(translations).forEach(([msgid, data]) => {
            const card = this.createTranslationCard(msgid, data);
            container.insertBefore(card, bottomControls);
        });
    }

    createPaginationControls(position) {
        const controls = document.createElement('div');
        controls.className = `pagination-controls ${position}`;
        controls.innerHTML = `
            <div class="pagination-info">
                Showing ${this.loadedTranslations.size} of ${this.totalTranslations || '?'} translations
            </div>
            <div class="pagination-buttons">
                <button onclick="app.previousPage()" ${this.currentPage === 0 ? 'disabled' : ''}>
                    ← Previous
                </button>
                <span class="page-number">Page ${this.currentPage + 1}</span>
                <button onclick="app.nextPage()" ${!this.hasMorePages ? 'disabled' : ''}>
                    Next →
                </button>
            </div>
        `;
        return controls;
    }

    updatePaginationControls() {
        document.querySelectorAll('.pagination-info').forEach(el => {
            el.textContent = `Showing ${this.loadedTranslations.size} of ${this.totalTranslations || '?'} translations`;
        });

        document.querySelectorAll('.page-number').forEach(el => {
            el.textContent = `Page ${this.currentPage + 1}`;
        });

        // Update button states
        document.querySelectorAll('.pagination-controls button').forEach(button => {
            if (button.textContent.includes('Previous')) {
                button.disabled = this.currentPage === 0;
            } else if (button.textContent.includes('Next')) {
                button.disabled = !this.hasMorePages;
            }
        });
    }

    async previousPage() {
        if (this.currentPage > 0) {
            await this.loadTranslationPage(this.currentPage - 1);
        }
    }

    async nextPage() {
        if (this.hasMorePages) {
            await this.loadTranslationPage(this.currentPage + 1);
        }
    }

    setupInfiniteScroll() {
        // Remove any existing observer
        if (this.scrollObserver) {
            this.scrollObserver.disconnect();
        }

        // Create intersection observer for the last few cards
        const cards = document.querySelectorAll('.translation-card');
        if (cards.length > 5) {
            const target = cards[cards.length - 5]; // Watch the 5th from last card

            this.scrollObserver = new IntersectionObserver(
                (entries) => {
                    entries.forEach(entry => {
                        if (entry.isIntersecting && this.hasMorePages && !this.isLoading) {
                            this.loadMoreTranslations();
                        }
                    });
                },
                { rootMargin: '100px' }
            );

            this.scrollObserver.observe(target);
        }
    }

    async loadMoreTranslations() {
        if (this.hasMorePages && !this.isLoading) {
            const nextPage = this.currentPage + 1;
            await this.loadTranslationPage(nextPage);
        }
    }

    // Enhanced search with debouncing
    filterTranslations() {
        const searchTerm = document.getElementById('search-input').value.toLowerCase();
        const filterStatus = document.getElementById('filter-status').value;

        // Clear existing debounce timer
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }

        if (searchTerm.length > 2) {
            // Debounce search for server-side search
            this.searchDebounceTimer = setTimeout(async () => {
                this.searchMode = true;
                this.searchTerm = searchTerm;
                this.currentPage = 0;
                this.loadedTranslations.clear();

                this.showLoading('Searching...');
                await this.loadTranslationPage(0);
                this.hideLoading();
            }, 500);
        } else {
            // Local filtering for short searches or status filters
            this.searchMode = false;
            this.searchTerm = '';

            const cards = document.querySelectorAll('.translation-card');
            cards.forEach(card => {
                const msgid = card.dataset.msgid;
                const data = this.loadedTranslations.get(msgid);

                if (!data) {
                    card.style.display = 'none';
                    return;
                }

                const originalText = data.original || '';
                const translationText = data.current || '';

                // Search filter
                const matchesSearch = !searchTerm ||
                    msgid.toLowerCase().includes(searchTerm) ||
                    originalText.toLowerCase().includes(searchTerm) ||
                    translationText.toLowerCase().includes(searchTerm);

                // Status filter
                let matchesStatus = true;
                if (filterStatus === 'empty') {
                    matchesStatus = !translationText.trim();
                } else if (filterStatus === 'modified') {
                    const changeKey = `${this.currentLanguage}:${msgid}`;
                    matchesStatus = this.changes.has(changeKey);
                }

                card.style.display = matchesSearch && matchesStatus ? 'block' : 'none';
            });
        }
    }

    // Update the API client to support pagination
    async loadTranslations(repo, language, page = 0, pageSize = 50, search = null) {
        const params = new URLSearchParams({
            page: page.toString(),
            pageSize: pageSize.toString()
        });

        if (search) {
            params.append('search', search);
        }

        const result = await this.api.request(
            `/translations/${encodeURIComponent(repo)}/${language}?${params}`
        );

        return result.data || result;
    }

    // ... (keep all other existing methods)
}

// Add pagination styles
const style = document.createElement('style');
style.textContent = `
.pagination-controls {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 20px;
    background: #f8f9fa;
    border-radius: 8px;
    margin: 20px 0;
}

.pagination-controls.top {
    margin-bottom: 20px;
}

.pagination-controls.bottom {
    margin-top: 20px;
}

.pagination-info {
    color: #666;
    font-size: 14px;
}

.pagination-buttons {
    display: flex;
    gap: 15px;
    align-items: center;
}

.pagination-buttons button {
    padding: 8px 16px;
    background: #3498db;
    color: white;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: background 0.3s ease;
}

.pagination-buttons button:hover:not(:disabled) {
    background: #2980b9;
}

.pagination-buttons button:disabled {
    background: #bdc3c7;
    cursor: not-allowed;
}

.page-number {
    font-weight: 500;
    color: #2c3e50;
}

.loading-more {
    text-align: center;
    padding: 20px;
    color: #7f8c8d;
}

.loading-more .spinner {
    margin: 0 auto;
}
`;
document.head.appendChild(style);

// Update APIClient to support pagination
window.APIClient.prototype.getTranslations = async function(repo, language, page = 0, pageSize = 50, search = null) {
    const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString()
    });

    if (search) {
        params.append('search', search);
    }

    const encodedRepo = encodeURIComponent(repo);
    const result = await this.request(`/translations/${encodedRepo}/${language}?${params}`);
    return result.data || result;
};

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new TranslationApp();
    window.app.init();
});