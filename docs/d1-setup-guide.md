# Cloudflare D1 Database Setup Guide

## Prerequisites

1. Install Wrangler CLI:
```bash
npm install -g wrangler
```

2. Authenticate with Cloudflare:
```bash
wrangler login
```

## Step 1: Create the D1 Database

```bash
# Create a new D1 database
wrangler d1 create po-translation-db

# This will output something like:
# ✅ Successfully created DB 'po-translation-db' in region EEUR
# Created your database using D1's new storage backend. The new storage backend is not yet recommended for production workloads, but backs up your data via point-in-time restore.
# 
# [[d1_databases]]
# binding = "DB" # i.e. available in your Worker on env.DB
# database_name = "po-translation-db"
# database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

## Step 2: Configure wrangler.toml

Add the D1 binding to your `wrangler.toml`:

```toml
name = "po-translation-tool"
main = "src/index.js"
compatibility_date = "2024-01-01"

# KV namespace for real-time presence
[[kv_namespaces]]
binding = "PRESENCE_KV"
id = "your-kv-namespace-id"

# D1 Database
[[d1_databases]]
binding = "DB"
database_name = "po-translation-db"
database_id = "your-database-id-from-step-1"

# Durable Objects for WebSocket handling
[[durable_objects.bindings]]
name = "WEBSOCKET_HANDLER"
class_name = "TranslationWebSocketHandler"

[[migrations]]
tag = "v1"
new_classes = ["TranslationWebSocketHandler"]
```

## Step 3: Create Schema SQL File

Create a file `schema.sql` with all tables and constraints:

```sql
-- schema.sql
-- Drop existing tables if they exist (careful in production!)
DROP TABLE IF EXISTS edit_history;
DROP TABLE IF EXISTS active_editors;
DROP TABLE IF EXISTS translation_progress;
DROP TABLE IF EXISTS translation_sessions;
DROP TABLE IF EXISTS translation_metrics;
DROP TABLE IF EXISTS users;

-- Users table with all constraints
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT,
    github_username TEXT,
    auth_method TEXT NOT NULL CHECK (auth_method IN ('github', 'token')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME
);

-- Create index for email lookups
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_github_username ON users(github_username);

-- Translation sessions
CREATE TABLE translation_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    repository TEXT NOT NULL,
    language_code TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_active DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Create composite index for user sessions
CREATE INDEX idx_sessions_user_repo ON translation_sessions(user_id, repository);

-- Translation progress with constraints
CREATE TABLE translation_progress (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    msgid TEXT NOT NULL,
    file_path TEXT NOT NULL,
    original_text TEXT,
    translated_text TEXT,
    previous_translation TEXT,
    status TEXT NOT NULL DEFAULT 'pending' 
        CHECK (status IN ('pending', 'in_progress', 'completed', 'reviewed')),
    started_at DATETIME,
    completed_at DATETIME,
    character_count INTEGER DEFAULT 0 CHECK (character_count >= 0),
    word_count INTEGER DEFAULT 0 CHECK (word_count >= 0),
    FOREIGN KEY (session_id) REFERENCES translation_sessions(id) ON DELETE CASCADE,
    UNIQUE(session_id, msgid)
);

-- Indexes for progress queries
CREATE INDEX idx_progress_session ON translation_progress(session_id);
CREATE INDEX idx_progress_status ON translation_progress(status);
CREATE INDEX idx_progress_msgid ON translation_progress(msgid);

-- Edit history for audit trail
CREATE TABLE edit_history (
    id TEXT PRIMARY KEY,
    msgid TEXT NOT NULL,
    file_path TEXT NOT NULL,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('edit', 'complete', 'review', 'revert')),
    previous_value TEXT,
    new_value TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES translation_sessions(id) ON DELETE CASCADE
);

-- Index for history queries
CREATE INDEX idx_history_msgid ON edit_history(msgid, timestamp DESC);
CREATE INDEX idx_history_user ON edit_history(user_id, timestamp DESC);

-- Active editors for real-time presence
CREATE TABLE active_editors (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    msgid TEXT NOT NULL,
    file_path TEXT NOT NULL,
    started_editing DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Index for active editor queries
CREATE INDEX idx_active_editors_msgid ON active_editors(msgid);
CREATE INDEX idx_active_editors_heartbeat ON active_editors(last_heartbeat);

-- Translation metrics for analytics
CREATE TABLE translation_metrics (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    language_code TEXT NOT NULL,
    date DATE NOT NULL,
    translations_completed INTEGER DEFAULT 0 CHECK (translations_completed >= 0),
    words_translated INTEGER DEFAULT 0 CHECK (words_translated >= 0),
    characters_translated INTEGER DEFAULT 0 CHECK (characters_translated >= 0),
    time_spent_minutes INTEGER DEFAULT 0 CHECK (time_spent_minutes >= 0),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, language_code, date)
);

-- Index for metrics queries
CREATE INDEX idx_metrics_user_date ON translation_metrics(user_id, date DESC);
CREATE INDEX idx_metrics_language ON translation_metrics(language_code);

-- Add triggers for automatic timestamp updates
CREATE TRIGGER update_session_last_active 
    AFTER INSERT ON translation_progress
    BEGIN
        UPDATE translation_sessions 
        SET last_active = CURRENT_TIMESTAMP 
        WHERE id = NEW.session_id;
    END;

CREATE TRIGGER update_user_last_active 
    AFTER INSERT ON translation_sessions
    BEGIN
        UPDATE users 
        SET last_active = CURRENT_TIMESTAMP 
        WHERE id = NEW.user_id;
    END;
```

## Step 4: Apply Schema to Database

Execute the schema using Wrangler:

```bash
# Apply the schema
wrangler d1 execute po-translation-db --file=./schema.sql

# For remote (production) database
wrangler d1 execute po-translation-db --file=./schema.sql --remote
```

## Step 5: Create Migration Scripts

For production environments, use migrations instead of dropping tables:

```bash
# Create migrations directory
mkdir migrations

# Create first migration
touch migrations/0001_initial_schema.sql
```

Add your schema to `migrations/0001_initial_schema.sql`, then:

```bash
# Apply migrations locally
wrangler d1 migrations apply po-translation-db

# Apply to production
wrangler d1 migrations apply po-translation-db --remote

# List applied migrations
wrangler d1 migrations list po-translation-db
```

## Step 6: Interact with Database via CLI

You can run SQL queries directly:

```bash
# Run a query
wrangler d1 execute po-translation-db --command="SELECT * FROM users"

# Interactive console (local)
wrangler d1 console po-translation-db

# Insert test data
wrangler d1 execute po-translation-db --command="INSERT INTO users (id, email, name, auth_method) VALUES ('test-123', 'test@example.com', 'Test User', 'github')"

# Check table structure
wrangler d1 execute po-translation-db --command="PRAGMA table_info(users)"

# View all tables
wrangler d1 execute po-translation-db --command="SELECT name FROM sqlite_master WHERE type='table'"
```

## Step 7: Create Seed Data Script

Create `seed-data.sql` for development:

```sql
-- seed-data.sql
-- Insert test users
INSERT INTO users (id, email, name, github_username, auth_method) VALUES 
    ('user-1', 'alice@example.com', 'Alice Developer', 'alice-dev', 'github'),
    ('user-2', 'bob@example.com', 'Bob Translator', NULL, 'token'),
    ('user-3', 'charlie@example.com', 'Charlie Reviewer', 'charlie-gh', 'github');

-- Insert test sessions
INSERT INTO translation_sessions (id, user_id, repository, language_code) VALUES
    ('session-1', 'user-1', 'org/social-app', 'fr'),
    ('session-2', 'user-2', 'org/social-app', 'es'),
    ('session-3', 'user-1', 'org/social-app', 'de');

-- Insert test progress
INSERT INTO translation_progress 
    (id, session_id, msgid, file_path, original_text, translated_text, status, word_count, character_count) 
VALUES
    ('prog-1', 'session-1', 'welcome.message', '/locales/fr/messages.po', 
     'Welcome to our app!', 'Bienvenue dans notre application!', 'completed', 4, 32),
    ('prog-2', 'session-1', 'goodbye.message', '/locales/fr/messages.po', 
     'Goodbye!', 'Au revoir!', 'completed', 2, 10),
    ('prog-3', 'session-2', 'welcome.message', '/locales/es/messages.po', 
     'Welcome to our app!', 'ยกBienvenido a nuestra aplicaciรณn!', 'completed', 5, 34);

-- Apply seed data
-- wrangler d1 execute po-translation-db --file=./seed-data.sql
```

## Step 8: Database Management Scripts

Create useful management scripts:

```bash
#!/bin/bash
# scripts/db-reset.sh

echo "Resetting D1 database..."
wrangler d1 execute po-translation-db --file=./schema.sql
echo "Schema applied."

echo "Seeding test data..."
wrangler d1 execute po-translation-db --file=./seed-data.sql
echo "Database reset complete!"
```

```bash
#!/bin/bash
# scripts/db-backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
wrangler d1 backup create po-translation-db
echo "Backup created at $DATE"

# List backups
wrangler d1 backup list po-translation-db
```

## Step 9: Worker Database Access

In your Worker code:

```javascript
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
```

## Step 10: Monitor and Optimize

```bash
# Check database size
wrangler d1 info po-translation-db

# Analyze query performance
wrangler d1 execute po-translation-db --command="EXPLAIN QUERY PLAN SELECT * FROM translation_progress WHERE session_id = 'test'"

# Vacuum database (optimize storage)
wrangler d1 execute po-translation-db --command="VACUUM"

# Check indexes are being used
wrangler d1 execute po-translation-db --command="EXPLAIN QUERY PLAN SELECT * FROM users WHERE email = 'test@example.com'"
```

## Common Commands Reference

```bash
# List all databases
wrangler d1 list

# Delete a database (careful!)
wrangler d1 delete po-translation-db

# Export data
wrangler d1 execute po-translation-db --command="SELECT * FROM users" > users-export.json

# Import from SQL file
wrangler d1 execute po-translation-db --file=./import.sql

# Get database info
wrangler d1 info po-translation-db

# Time-travel queries (D1 feature)
wrangler d1 time-travel po-translation-db --timestamp="2024-01-15T10:00:00Z"
```

## Tips and Best Practices

1. **Always use parameterized queries** to prevent SQL injection
2. **Create indexes** for frequently queried columns
3. **Use transactions** for related operations
4. **Set up regular backups** in production
5. **Monitor query performance** with EXPLAIN
6. **Use CHECK constraints** to enforce data validity
7. **Implement soft deletes** for important data
8. **Version your schema** with migrations

This setup gives you a fully-featured SQLite database with all constraints, indexes, and relationships properly configured through Cloudflare's D1 service.