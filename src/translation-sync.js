class TranslationSync {
    constructor(api) {
        this.api = api;
        this.pendingChanges = new Map();
        this.syncInterval = null;
    }

    startAutoSync() {
        this.syncInterval = setInterval(() => {
            this.syncPendingChanges();
        }, 5000); // Every 5 seconds
    }

    async syncPendingChanges() {
        if (this.pendingChanges.size === 0) return;

        const changes = Array.from(this.pendingChanges.values());

        try {
            await this.api.batchSaveTranslations(changes);
            this.pendingChanges.clear();
        } catch (error) {
            // Handle conflicts
            if (error.code === 'CONFLICT') {
                await this.resolveConflicts(error.conflicts);
            }
        }
    }
}