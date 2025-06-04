// src/db-helper.js
export class DatabaseHelper {
    constructor(db) {
        this.db = db;
    }

    async createUser(email, name, authMethod) {
        const id = crypto.randomUUID();

        try {
            const result = await this.db.prepare(`
        INSERT INTO users (id, email, name, auth_method) 
        VALUES (?, ?, ?, ?)
      `).bind(id, email, name, authMethod).run();

            return { id, success: true };
        } catch (error) {
            if (error.message.includes('UNIQUE constraint failed')) {
                throw new Error('User with this email already exists');
            }
            throw error;
        }
    }

    async getUserByEmail(email) {
        return await this.db.prepare(
            'SELECT * FROM users WHERE email = ?'
        ).bind(email).first();
    }

    async createSession(userId, repository, language) {
        const sessionId = crypto.randomUUID();

        await this.db.prepare(`
      INSERT INTO translation_sessions (id, user_id, repository, language_code)
      VALUES (?, ?, ?, ?)
    `).bind(sessionId, userId, repository, language).run();

        return sessionId;
    }

    // Transaction example
    async updateTranslationWithHistory(sessionId, msgid, translation, userId) {
        // D1 supports transactions!
        const statements = [
            this.db.prepare(`
        INSERT OR REPLACE INTO translation_progress 
        (id, session_id, msgid, translated_text, status)
        VALUES (?, ?, ?, ?, 'completed')
      `).bind(`${sessionId}:${msgid}`, sessionId, msgid, translation),

            this.db.prepare(`
        INSERT INTO edit_history 
        (id, msgid, user_id, session_id, action, new_value)
        VALUES (?, ?, ?, ?, 'edit', ?)
      `).bind(crypto.randomUUID(), msgid, userId, sessionId, translation)
        ];

        // Execute as a transaction
        await this.db.batch(statements);
    }
}