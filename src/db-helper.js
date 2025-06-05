export class DatabaseHelper {
    constructor(db) {
        this.db = db;
    }

    // User Management
    async createUser(email, name, authMethod, githubUsername = null) {
        const id = crypto.randomUUID();

        try {
            const result = await this.db.prepare(`
                INSERT INTO users (id, email, name, github_username, auth_method, created_at, last_active)
                VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
            `).bind(id, email, name, githubUsername, authMethod).run();

            return { id, success: true };
        } catch (error) {
            if (error.message.includes('UNIQUE constraint failed')) {
                // User exists, return their ID
                const existing = await this.getUserByEmail(email);
                return { id: existing.id, success: true, existing: true };
            }
            throw error;
        }
    }

    async getUserByEmail(email) {
        return await this.db.prepare(
            'SELECT * FROM users WHERE email = ?'
        ).bind(email).first();
    }

    async getUserById(id) {
        return await this.db.prepare(
            'SELECT * FROM users WHERE id = ?'
        ).bind(id).first();
    }

    async updateUserActivity(userId) {
        await this.db.prepare(
            'UPDATE users SET last_active = datetime("now") WHERE id = ?'
        ).bind(userId).run();
    }

    // Session Management
    async createSession(userId, repository, language) {
        const sessionId = crypto.randomUUID();

        await this.db.prepare(`
            INSERT INTO translation_sessions (id, user_id, repository, language_code, started_at, last_active)
            VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        `).bind(sessionId, userId, repository, language).run();

        return sessionId;
    }

    async getActiveSession(userId, repository, language) {
        return await this.db.prepare(`
            SELECT * FROM translation_sessions
            WHERE user_id = ? AND repository = ? AND language_code = ?
            ORDER BY started_at DESC
                LIMIT 1
        `).bind(userId, repository, language).first();
    }

    async updateSessionActivity(sessionId) {
        await this.db.prepare(
            'UPDATE translation_sessions SET last_active = datetime("now") WHERE id = ?'
        ).bind(sessionId).run();
    }

    // Translation Progress
    async saveTranslation(sessionId, msgid, filePath, originalText, translatedText, previousTranslation = null) {
        const id = `${sessionId}:${msgid}`;
        const wordCount = translatedText ? translatedText.split(/\s+/).filter(w => w.length > 0).length : 0;
        const charCount = translatedText ? translatedText.length : 0;
        const status = translatedText && translatedText.trim() ? 'completed' : 'pending';

        await this.db.prepare(`
            INSERT OR REPLACE INTO translation_progress 
            (id, session_id, msgid, file_path, original_text, translated_text, 
             previous_translation, status, completed_at, word_count, character_count)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 
                    CASE WHEN ? = 'completed' THEN datetime('now') ELSE NULL END, ?, ?)
        `).bind(
            id, sessionId, msgid, filePath, originalText,
            translatedText, previousTranslation, status, status, wordCount, charCount
        ).run();

        // Update session activity
        await this.updateSessionActivity(sessionId);
    }

    async getTranslationProgress(sessionId) {
        const results = await this.db.prepare(`
            SELECT * FROM translation_progress
            WHERE session_id = ?
            ORDER BY msgid
        `).bind(sessionId).all();

        return results.results || [];
    }

    // Pending Changes (for PR creation)
    async getPendingChanges(userId, repository = null) {
        let query = `
            SELECT
                tp.*,
                ts.repository,
                ts.language_code,
                u.name as translator_name,
                u.email as translator_email
            FROM translation_progress tp
                     JOIN translation_sessions ts ON tp.session_id = ts.id
                     JOIN users u ON ts.user_id = u.id
            WHERE ts.user_id = ?
              AND tp.status = 'completed'
              AND (tp.previous_translation IS NULL OR tp.previous_translation != tp.translated_text)
        `;

        const bindings = [userId];

        if (repository) {
            query += ' AND ts.repository = ?';
            bindings.push(repository);
        }

        query += ' ORDER BY tp.completed_at DESC';

        const results = await this.db.prepare(query).bind(...bindings).all();
        return results.results || [];
    }

    // Edit History
    async recordEdit(msgid, filePath, userId, sessionId, action, previousValue, newValue) {
        const id = crypto.randomUUID();

        await this.db.prepare(`
            INSERT INTO edit_history
            (id, msgid, file_path, user_id, session_id, action, previous_value, new_value, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        `).bind(id, msgid, filePath, userId, sessionId, action, previousValue, newValue).run();
    }

    async getEditHistory(msgid = null, userId = null, limit = 50) {
        let query = 'SELECT * FROM edit_history WHERE 1=1';
        const bindings = [];

        if (msgid) {
            query += ' AND msgid = ?';
            bindings.push(msgid);
        }

        if (userId) {
            query += ' AND user_id = ?';
            bindings.push(userId);
        }

        query += ' ORDER BY timestamp DESC LIMIT ?';
        bindings.push(limit);

        const results = await this.db.prepare(query).bind(...bindings).all();
        return results.results || [];
    }

    // Active Editors (for real-time collaboration)
    async setActiveEditor(userId, msgid, filePath) {
        const id = `${userId}:${msgid}`;

        // Use REPLACE to update if exists
        await this.db.prepare(`
            INSERT OR REPLACE INTO active_editors 
            (id, user_id, msgid, file_path, started_editing, last_heartbeat)
            VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        `).bind(id, userId, msgid, filePath).run();

        return id;
    }

    async getActiveEditors(msgid = null) {
        let query = `
            SELECT ae.*, u.name, u.email
            FROM active_editors ae
                     JOIN users u ON ae.user_id = u.id
            WHERE datetime(ae.last_heartbeat) > datetime('now', '-2 minutes')
        `;

        const bindings = [];
        if (msgid) {
            query += ' AND ae.msgid = ?';
            bindings.push(msgid);
        }

        const results = await this.db.prepare(query).bind(...bindings).all();
        return results.results || [];
    }

    async updateHeartbeat(userId) {
        await this.db.prepare(`
            UPDATE active_editors
            SET last_heartbeat = datetime('now')
            WHERE user_id = ?
        `).bind(userId).run();
    }

    async removeActiveEditor(userId, msgid) {
        const id = `${userId}:${msgid}`;
        await this.db.prepare(
            'DELETE FROM active_editors WHERE id = ?'
        ).bind(id).run();
    }

    async removeInactiveEditors() {
        await this.db.prepare(`
            DELETE FROM active_editors
            WHERE datetime(last_heartbeat) < datetime('now', '-2 minutes')
        `).run();
    }

    // Metrics
    async updateMetrics(userId, languageCode, translationsCompleted, wordsTranslated, charactersTranslated, timeSpentMinutes) {
        const date = new Date().toISOString().split('T')[0];
        const id = `${userId}:${languageCode}:${date}`;

        await this.db.prepare(`
            INSERT INTO translation_metrics
            (id, user_id, language_code, date, translations_completed,
             words_translated, characters_translated, time_spent_minutes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, language_code, date) DO UPDATE SET
                translations_completed = translations_completed + excluded.translations_completed,
                                                                 words_translated = words_translated + excluded.words_translated,
                                                                 characters_translated = characters_translated + excluded.characters_translated,
                                                                 time_spent_minutes = time_spent_minutes + excluded.time_spent_minutes
        `).bind(
            id, userId, languageCode, date, translationsCompleted,
            wordsTranslated, charactersTranslated, timeSpentMinutes
        ).run();
    }

    async getMetrics(userId = null, startDate = null, endDate = null) {
        let query = 'SELECT * FROM translation_metrics WHERE 1=1';
        const bindings = [];

        if (userId) {
            query += ' AND user_id = ?';
            bindings.push(userId);
        }

        if (startDate) {
            query += ' AND date >= ?';
            bindings.push(startDate);
        }

        if (endDate) {
            query += ' AND date <= ?';
            bindings.push(endDate);
        }

        query += ' ORDER BY date DESC';

        const results = await this.db.prepare(query).bind(...bindings).all();
        return results.results || [];
    }

    // Translation Statistics
    async getTranslationStats() {
        const stats = await this.db.prepare(`
            SELECT 
                COUNT(DISTINCT u.id) as activeUsers,
                COUNT(DISTINCT tp.id) as total,
                COUNT(DISTINCT CASE WHEN tp.status = 'completed' THEN tp.id END) as completed,
                COUNT(DISTINCT ts.language_code) as languages
            FROM translation_progress tp
            JOIN translation_sessions ts ON tp.session_id = ts.id
            JOIN users u ON ts.user_id = u.id
            WHERE ts.last_active > datetime('now', '-30 days')
        `).first();

        const byLanguage = await this.db.prepare(`
            SELECT 
                ts.language_code,
                COUNT(DISTINCT tp.id) as total,
                COUNT(DISTINCT CASE WHEN tp.status = 'completed' THEN tp.id END) as completed
            FROM translation_progress tp
            JOIN translation_sessions ts ON tp.session_id = ts.id
            GROUP BY ts.language_code
        `).all();

        const recentChanges = await this.db.prepare(`
            SELECT 
                tp.msgid,
                tp.translated_text,
                ts.language_code,
                u.name as translator,
                tp.completed_at
            FROM translation_progress tp
            JOIN translation_sessions ts ON tp.session_id = ts.id
            JOIN users u ON ts.user_id = u.id
            WHERE tp.status = 'completed'
            ORDER BY tp.completed_at DESC
            LIMIT 10
        `).all();

        return {
            ...stats,
            byLanguage: byLanguage.results || [],
            recentChanges: recentChanges.results || []
        };
    }

    // Batch operations for PR creation
    async markChangesAsSubmitted(changeIds, prNumber) {
        const statements = changeIds.map(id =>
            this.db.prepare(`
                UPDATE translation_progress
                SET status = 'submitted'
                WHERE id = ?
            `).bind(id)
        );

        await this.db.batch(statements);
    }
}