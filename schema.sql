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