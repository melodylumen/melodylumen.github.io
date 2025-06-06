// scripts/migrate.js - Database migration utilities

const fs = require('fs').promises;
const path = require('path');

class MigrationRunner {
    constructor(db) {
        this.db = db;
        this.migrationsDir = path.join(__dirname, '../migrations');
    }

    async init() {
        // Create migrations table if it doesn't exist
        await this.db.exec(`
            CREATE TABLE IF NOT EXISTS migrations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT UNIQUE NOT NULL,
                applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
    }

    async getAppliedMigrations() {
        const result = await this.db.prepare(
            'SELECT filename FROM migrations ORDER BY id'
        ).all();
        return result.results.map(r => r.filename);
    }

    async getPendingMigrations() {
        const applied = await this.getAppliedMigrations();
        const files = await fs.readdir(this.migrationsDir);

        return files
            .filter(f => f.endsWith('.sql'))
            .filter(f => !applied.includes(f))
            .sort();
    }

    async applyMigration(filename) {
        const filepath = path.join(this.migrationsDir, filename);
        const sql = await fs.readFile(filepath, 'utf8');

        console.log(`Applying migration: ${filename}`);

        try {
            // Execute migration in a transaction
            await this.db.exec('BEGIN TRANSACTION');
            await this.db.exec(sql);

            // Record migration
            await this.db.prepare(
                'INSERT INTO migrations (filename) VALUES (?)'
            ).bind(filename).run();

            await this.db.exec('COMMIT');
            console.log(`✓ Applied: ${filename}`);
        } catch (error) {
            await this.db.exec('ROLLBACK');
            throw new Error(`Failed to apply ${filename}: ${error.message}`);
        }
    }

    async runAll() {
        await this.init();

        const pending = await this.getPendingMigrations();

        if (pending.length === 0) {
            console.log('No pending migrations');
            return;
        }

        console.log(`Found ${pending.length} pending migrations`);

        for (const migration of pending) {
            await this.applyMigration(migration);
        }

        console.log('All migrations completed successfully');
    }

    async rollback(steps = 1) {
        const applied = await this.getAppliedMigrations();

        if (applied.length === 0) {
            console.log('No migrations to rollback');
            return;
        }

        const toRollback = applied.slice(-steps);

        for (const filename of toRollback.reverse()) {
            console.log(`Rolling back: ${filename}`);

            // Look for down migration
            const downFile = filename.replace('.sql', '.down.sql');
            const downPath = path.join(this.migrationsDir, downFile);

            try {
                const sql = await fs.readFile(downPath, 'utf8');

                await this.db.exec('BEGIN TRANSACTION');
                await this.db.exec(sql);

                await this.db.prepare(
                    'DELETE FROM migrations WHERE filename = ?'
                ).bind(filename).run();

                await this.db.exec('COMMIT');
                console.log(`✓ Rolled back: ${filename}`);
            } catch (error) {
                await this.db.exec('ROLLBACK');
                console.error(`Failed to rollback ${filename}: ${error.message}`);
                break;
            }
        }
    }

    async status() {
        await this.init();

        const applied = await this.getAppliedMigrations();
        const pending = await this.getPendingMigrations();

        console.log('Migration Status:');
        console.log(`Applied: ${applied.length}`);
        console.log(`Pending: ${pending.length}`);

        if (applied.length > 0) {
            console.log('\nApplied migrations:');
            applied.forEach(m => console.log(`  ✓ ${m}`));
        }

        if (pending.length > 0) {
            console.log('\nPending migrations:');
            pending.forEach(m => console.log(`  - ${m}`));
        }
    }
}

// Create initial migrations
async function createMigrations() {
    const migrationsDir = path.join(__dirname, '../migrations');
    await fs.mkdir(migrationsDir, { recursive: true });

    // Migration 1: Add language metadata
    await fs.writeFile(
        path.join(migrationsDir, '001_add_language_metadata.sql'),
        `-- Add language metadata table
CREATE TABLE IF NOT EXISTS language_metadata (
    id TEXT PRIMARY KEY,
    repository TEXT NOT NULL,
    language_code TEXT NOT NULL,
    language_name TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1,
    UNIQUE(repository, language_code),
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Add indexes
CREATE INDEX idx_language_metadata_repo ON language_metadata(repository);
CREATE INDEX idx_language_metadata_active ON language_metadata(is_active);`
    );

    // Down migration
    await fs.writeFile(
        path.join(migrationsDir, '001_add_language_metadata.down.sql'),
        `DROP TABLE IF EXISTS language_metadata;`
    );

    // Migration 2: Add PR tracking
    await fs.writeFile(
        path.join(migrationsDir, '002_add_pr_tracking.sql'),
        `-- Add PR tracking table
CREATE TABLE IF NOT EXISTS pull_requests (
    id TEXT PRIMARY KEY,
    pr_number INTEGER NOT NULL,
    repository TEXT NOT NULL,
    branch_name TEXT NOT NULL,
    title TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'open',
    created_by TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    merged_at DATETIME,
    languages TEXT NOT NULL, -- JSON array
    change_count INTEGER NOT NULL,
    FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Add indexes
CREATE INDEX idx_pr_repository ON pull_requests(repository);
CREATE INDEX idx_pr_state ON pull_requests(state);
CREATE INDEX idx_pr_branch ON pull_requests(branch_name);

-- Add PR reference to translation progress
ALTER TABLE translation_progress ADD COLUMN pr_id TEXT REFERENCES pull_requests(id);`
    );

    // Down migration
    await fs.writeFile(
        path.join(migrationsDir, '002_add_pr_tracking.down.sql'),
        `-- Remove PR reference
ALTER TABLE translation_progress DROP COLUMN pr_id;

DROP TABLE IF EXISTS pull_requests;`
    );

    // Migration 3: Add collaboration features
    await fs.writeFile(
        path.join(migrationsDir, '003_add_collaboration_features.sql'),
        `-- Add comments table
CREATE TABLE IF NOT EXISTS translation_comments (
    id TEXT PRIMARY KEY,
    msgid TEXT NOT NULL,
    file_path TEXT NOT NULL,
    user_id TEXT NOT NULL,
    comment TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- Add review status
ALTER TABLE translation_progress ADD COLUMN review_status TEXT DEFAULT 'pending';
ALTER TABLE translation_progress ADD COLUMN reviewed_by TEXT REFERENCES users(id);
ALTER TABLE translation_progress ADD COLUMN reviewed_at DATETIME;

-- Add indexes
CREATE INDEX idx_comments_msgid ON translation_comments(msgid);
CREATE INDEX idx_progress_review ON translation_progress(review_status);`
    );

    // Down migration
    await fs.writeFile(
        path.join(migrationsDir, '003_add_collaboration_features.down.sql'),
        `DROP TABLE IF EXISTS translation_comments;

ALTER TABLE translation_progress DROP COLUMN review_status;
ALTER TABLE translation_progress DROP COLUMN reviewed_by;
ALTER TABLE translation_progress DROP COLUMN reviewed_at;`
    );

    console.log('Migration files created');
}

// CLI interface
const command = process.argv[2];

async function main() {
    if (command === 'create') {
        await createMigrations();
        return;
    }

    // For other commands, we need database connection
    // This would be run within the Cloudflare Worker context
    console.log('Migration commands:');
    console.log('  create     - Create migration files');
    console.log('  run        - Run pending migrations (use in Worker)');
    console.log('  rollback   - Rollback migrations (use in Worker)');
    console.log('  status     - Show migration status (use in Worker)');
}

main().catch(console.error);

// Export for use in Worker
module.exports = { MigrationRunner };