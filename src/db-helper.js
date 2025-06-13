export class DatabaseHelper {
    constructor(db) {
        this.db = db;
        this.statements = new Map();
    }

    async prepare(key, sql) {
        if (!this.statements.has(key)) {
            this.statements.set(key, this.db.prepare(sql));
        }
        return this.statements.get(key);
    }

    async getTranslationsBatch(sessionIds) {
        const placeholders = sessionIds.map(() => '?').join(',');
        const stmt = await this.prepare(
            'batch_translations',
            `SELECT * FROM translation_progress
             WHERE session_id IN (${placeholders})
             ORDER BY msgid`
        );
        return stmt.bind(...sessionIds).all();
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
                if (existing) {
                    // Update their info if needed
                    await this.db.prepare(`
                        UPDATE users
                        SET name = ?, github_username = ?, last_active = datetime('now')
                        WHERE email = ?
                    `).bind(name, githubUsername, email).run();

                    return { id: existing.id, success: true, existing: true };
                }
            }
            throw error;
        }
    }

    async getUserByEmail(email) {
        try {
            return await this.db.prepare(
                'SELECT * FROM users WHERE email = ?'
            ).bind(email).first();
        } catch (error) {
            console.error('Error getting user by email:', error);
            return null;
        }
    }

    async getUserById(id) {
        try {
            return await this.db.prepare(
                'SELECT * FROM users WHERE id = ?'
            ).bind(id).first();
        } catch (error) {
            console.error('Error getting user by ID:', error);
            return null;
        }
    }

    async updateUserActivity(userId) {
        try {
            await this.db.prepare(
                'UPDATE users SET last_active = datetime("now") WHERE id = ?'
            ).bind(userId).run();
        } catch (error) {
            console.error('Error updating user activity:', error);
        }
    }

    // Session Management
    async createSession(userId, repository, language) {
        const sessionId = crypto.randomUUID();

        try {
            await this.db.prepare(`
                INSERT INTO translation_sessions (id, user_id, repository, language_code, started_at, last_active)
                VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
            `).bind(sessionId, userId, repository, language).run();

            return sessionId;
        } catch (error) {
            console.error('Error creating session:', error);
            throw error;
        }
    }

    async getActiveSession(userId, repository, language) {
        try {
            return await this.db.prepare(`
                SELECT * FROM translation_sessions
                WHERE user_id = ? AND repository = ? AND language_code = ?
                ORDER BY started_at DESC
                    LIMIT 1
            `).bind(userId, repository, language).first();
        } catch (error) {
            console.error('Error getting active session:', error);
            return null;
        }
    }

    async updateSessionActivity(sessionId) {
        try {
            await this.db.prepare(
                'UPDATE translation_sessions SET last_active = datetime("now") WHERE id = ?'
            ).bind(sessionId).run();
        } catch (error) {
            console.error('Error updating session activity:', error);
        }
    }

    // Translation Progress
    async saveTranslation(sessionId, msgid, filePath, originalText, translatedText, previousTranslation = null) {
        const id = `${sessionId}:${msgid}`;
        const wordCount = translatedText ? translatedText.split(/\s+/).filter(w => w.length > 0).length : 0;
        const charCount = translatedText ? translatedText.length : 0;
        const status = translatedText && translatedText.trim() ? 'completed' : 'pending';

        try {
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
        } catch (error) {
            console.error('Error saving translation:', error);
            throw error;
        }
    }

    async getTranslationProgress(sessionId) {
        try {
            const results = await this.db.prepare(`
                SELECT * FROM translation_progress
                WHERE session_id = ?
                ORDER BY msgid
            `).bind(sessionId).all();

            return results.results || [];
        } catch (error) {
            console.error('Error getting translation progress:', error);
            return [];
        }
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

        try {
            const results = await this.db.prepare(query).bind(...bindings).all();
            return results.results || [];
        } catch (error) {
            console.error('Error getting pending changes:', error);
            return [];
        }
    }

    // Edit History
    async recordEdit(msgid, filePath, userId, sessionId, action, previousValue, newValue) {
        const id = crypto.randomUUID();

        try {
            await this.db.prepare(`
                INSERT INTO edit_history
                (id, msgid, file_path, user_id, session_id, action, previous_value, new_value, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
            `).bind(id, msgid, filePath, userId, sessionId, action, previousValue, newValue).run();
        } catch (error) {
            console.error('Error recording edit:', error);
            // Don't throw - edit history is not critical
        }
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

        try {
            const results = await this.db.prepare(query).bind(...bindings).all();
            return results.results || [];
        } catch (error) {
            console.error('Error getting edit history:', error);
            return [];
        }
    }

    // Active Editors (for real-time collaboration)
    async setActiveEditor(userId, msgid, filePath) {
        const id = `${userId}:${msgid}`;

        try {
            // Use REPLACE to update if exists
            await this.db.prepare(`
                INSERT OR REPLACE INTO active_editors 
                (id, user_id, msgid, file_path, started_editing, last_heartbeat)
                VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
            `).bind(id, userId, msgid, filePath).run();

            return id;
        } catch (error) {
            console.error('Error setting active editor:', error);
            return null;
        }
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

        try {
            const results = await this.db.prepare(query).bind(...bindings).all();
            return results.results || [];
        } catch (error) {
            console.error('Error getting active editors:', error);
            return [];
        }
    }

    async updateHeartbeat(userId) {
        try {
            await this.db.prepare(`
                UPDATE active_editors
                SET last_heartbeat = datetime('now')
                WHERE user_id = ?
            `).bind(userId).run();
        } catch (error) {
            console.error('Error updating heartbeat:', error);
        }
    }

    async removeActiveEditor(userId, msgid) {
        const id = `${userId}:${msgid}`;
        try {
            await this.db.prepare(
                'DELETE FROM active_editors WHERE id = ?'
            ).bind(id).run();
        } catch (error) {
            console.error('Error removing active editor:', error);
        }
    }

    async removeInactiveEditors() {
        try {
            await this.db.prepare(`
                DELETE FROM active_editors
                WHERE datetime(last_heartbeat) < datetime('now', '-2 minutes')
            `).run();
        } catch (error) {
            console.error('Error removing inactive editors:', error);
        }
    }

    // Metrics
    async updateMetrics(userId, languageCode, translationsCompleted, wordsTranslated, charactersTranslated, timeSpentMinutes) {
        const date = new Date().toISOString().split('T')[0];
        const id = `${userId}:${languageCode}:${date}`;

        try {
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
        } catch (error) {
            console.error('Error updating metrics:', error);
            // Don't throw - metrics are not critical
        }
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

        try {
            const results = await this.db.prepare(query).bind(...bindings).all();
            return results.results || [];
        } catch (error) {
            console.error('Error getting metrics:', error);
            return [];
        }
    }

    // Translation Statistics
    async getTranslationStats() {
        try {
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
        } catch (error) {
            console.error('Error getting translation stats:', error);
            return {
                activeUsers: 0,
                total: 0,
                completed: 0,
                languages: 0,
                byLanguage: [],
                recentChanges: []
            };
        }
    }

    // Batch operations for PR creation
    async markChangesAsSubmitted(changeIds, prNumber) {
        if (!changeIds || changeIds.length === 0) return;

        try {
            const statements = changeIds.map(id =>
                this.db.prepare(`
                    UPDATE translation_progress
                    SET status = 'submitted'
                    WHERE id = ?
                `).bind(id)
            );

            await this.db.batch(statements);
        } catch (error) {
            console.error('Error marking changes as submitted:', error);
            // Don't throw - this is not critical for functionality
        }
    }

    // Database health check
    async healthCheck() {
        try {
            await this.db.prepare('SELECT 1').first();
            return { healthy: true };
        } catch (error) {
            console.error('Database health check failed:', error);
            return { healthy: false, error: error.message };
        }
    }

    // Clean up old data
    async cleanup(daysToKeep = 30) {
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
        const cutoff = cutoffDate.toISOString().split('T')[0];

        try {
            // Clean up old sessions
            const oldSessions = await this.db.prepare(`
                DELETE FROM translation_sessions
                WHERE last_active < datetime(?, '-${daysToKeep} days')
            `).bind(cutoff).run();

            // Clean up inactive editors
            await this.removeInactiveEditors();

            return {
                sessionsRemoved: oldSessions.changes || 0
            };
        } catch (error) {
            console.error('Error during cleanup:', error);
            return { error: error.message };
        }
    }
}