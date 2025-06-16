-- migrations/004_add_token_management.sql
-- Add token management tables

-- Invite tokens table
CREATE TABLE IF NOT EXISTS invite_tokens (
                                             token TEXT PRIMARY KEY,
                                             created_by TEXT NOT NULL,
                                             created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                             expires_at DATETIME,
                                             usage_limit INTEGER,
                                             usage_count INTEGER DEFAULT 0,
                                             last_used_at DATETIME,
                                             description TEXT,
                                             allowed_languages TEXT, -- JSON array
                                             allowed_repositories TEXT, -- JSON array
                                             is_active BOOLEAN DEFAULT 1,
                                             revoked_at DATETIME,
                                             revoked_by TEXT,
                                             FOREIGN KEY (created_by) REFERENCES users(id),
    FOREIGN KEY (revoked_by) REFERENCES users(id)
    );

-- Token usage tracking
CREATE TABLE IF NOT EXISTS token_usage (
                                           id TEXT PRIMARY KEY,
                                           token TEXT NOT NULL,
                                           used_by TEXT NOT NULL,
                                           used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                           ip_address TEXT,
                                           user_agent TEXT,
                                           FOREIGN KEY (token) REFERENCES invite_tokens(token),
    FOREIGN KEY (used_by) REFERENCES users(id)
    );

-- Admin users table
CREATE TABLE IF NOT EXISTS admin_users (
                                           user_id TEXT PRIMARY KEY,
                                           granted_by TEXT,
                                           granted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                           permissions TEXT, -- JSON object for granular permissions
                                           is_active BOOLEAN DEFAULT 1,
                                           FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (granted_by) REFERENCES users(id)
    );

-- GitHub App installations (for tracking)
CREATE TABLE IF NOT EXISTS github_app_installations (
                                                        installation_id TEXT PRIMARY KEY,
                                                        account_type TEXT NOT NULL, -- 'User' or 'Organization'
                                                        account_login TEXT NOT NULL,
                                                        account_id INTEGER NOT NULL,
                                                        repository_selection TEXT, -- 'all' or 'selected'
                                                        installed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                                        events TEXT, -- JSON array of subscribed events
                                                        permissions TEXT, -- JSON object of granted permissions
                                                        is_active BOOLEAN DEFAULT 1
);

-- OAuth sessions for GitHub App
CREATE TABLE IF NOT EXISTS oauth_sessions (
                                              state TEXT PRIMARY KEY,
                                              created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                                              ip_address TEXT,
                                              redirect_uri TEXT,
                                              completed BOOLEAN DEFAULT 0,
                                              user_id TEXT,
                                              completed_at DATETIME,
                                              FOREIGN KEY (user_id) REFERENCES users(id)
    );

-- Indexes for performance
CREATE INDEX idx_tokens_active ON invite_tokens(is_active, expires_at);
CREATE INDEX idx_tokens_created_by ON invite_tokens(created_by);
CREATE INDEX idx_token_usage_token ON token_usage(token);
CREATE INDEX idx_token_usage_user ON token_usage(used_by);
CREATE INDEX idx_admin_users_active ON admin_users(is_active);
CREATE INDEX idx_oauth_state ON oauth_sessions(state, created_at);

-- Add role column to users table if not exists
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'translator';

-- Migration to add is_admin flag to existing admin users
UPDATE users SET role = 'admin' WHERE github_username IN (
                                                          'melodylubm', -- Add your admin GitHub usernames here
                                                          'admin-user-2'
    );