-- seed-data.sql - Test data for development
-- Clear existing data (only run this in a test environment - LOCALLY!)
DELETE FROM edit_history;
DELETE FROM active_editors;
DELETE FROM translation_progress;
DELETE FROM translation_sessions;
DELETE FROM translation_metrics;
DELETE FROM users;

-- Insert test users
INSERT INTO users (id, email, name, github_username, auth_method, created_at) VALUES
                                                                                  ('user-alice-123', 'alice@example.com', 'Alice Developer', 'alice-dev', 'github', datetime('now')),
                                                                                  ('user-bob-456', 'bob@example.com', 'Bob Translator', NULL, 'token', datetime('now')),
                                                                                  ('user-charlie-789', 'charlie@example.com', 'Charlie Reviewer', 'charlie-gh', 'github', datetime('now'));

-- Insert test sessions
INSERT INTO translation_sessions (id, user_id, repository, language_code, started_at) VALUES
                                                                                          ('session-alice-fr', 'user-alice-123', 'gander-social/social-app', 'fr', datetime('now', '-2 hours')),
                                                                                          ('session-bob-es', 'user-bob-456', 'gander-social/social-app', 'es', datetime('now', '-1 hour')),
                                                                                          ('session-alice-cr', 'user-alice-123', 'gander-social/social-app', 'cr', datetime('now', '-30 minutes'));

-- Insert test translation progress
INSERT INTO translation_progress
(id, session_id, msgid, file_path, original_text, translated_text, previous_translation, status, word_count, character_count, completed_at)
VALUES
    -- French translations
    ('prog-fr-1', 'session-alice-fr', 'welcome.message', 'src/locale/locales/fr/messages.po',
     'Welcome to our app!', 'Bienvenue dans notre application!', NULL, 'completed', 4, 32, datetime('now', '-1 hour')),
    ('prog-fr-2', 'session-alice-fr', 'goodbye.message', 'src/locale/locales/fr/messages.po',
     'Goodbye!', 'Au revoir!', NULL, 'completed', 2, 10, datetime('now', '-50 minutes')),
    ('prog-fr-3', 'session-alice-fr', 'user.profile', 'src/locale/locales/fr/messages.po',
     'User Profile', 'Profil utilisateur', NULL, 'completed', 2, 17, datetime('now', '-45 minutes')),

    -- Spanish translations
    ('prog-es-1', 'session-bob-es', 'welcome.message', 'src/locale/locales/es/messages.po',
     'Welcome to our app!', '¡Bienvenido a nuestra aplicación!', NULL, 'completed', 5, 34, datetime('now', '-40 minutes')),
    ('prog-es-2', 'session-bob-es', 'goodbye.message', 'src/locale/locales/es/messages.po',
     'Goodbye!', '¡Adiós!', NULL, 'completed', 1, 7, datetime('now', '-35 minutes')),
    ('prog-es-3', 'session-bob-es', 'user.profile', 'src/locale/locales/es/messages.po',
     'User Profile', '', NULL, 'pending', 0, 0, NULL),

    -- Cree translations (in progress)
    ('prog-cr-1', 'session-alice-cr', 'welcome.message', 'src/locale/locales/cr/messages.po',
     'Welcome to our app!', 'ᑕᐋᐧᐤ!', NULL, 'in_progress', 1, 5, NULL);

-- Insert edit history
INSERT INTO edit_history
(id, msgid, file_path, user_id, session_id, action, previous_value, new_value, timestamp)
VALUES
    ('edit-1', 'welcome.message', 'src/locale/locales/fr/messages.po', 'user-alice-123', 'session-alice-fr',
     'edit', NULL, 'Bienvenue dans notre application!', datetime('now', '-1 hour')),
    ('edit-2', 'goodbye.message', 'src/locale/locales/fr/messages.po', 'user-alice-123', 'session-alice-fr',
     'edit', NULL, 'Au revoir!', datetime('now', '-50 minutes')),
    ('edit-3', 'welcome.message', 'src/locale/locales/es/messages.po', 'user-bob-456', 'session-bob-es',
     'edit', NULL, '¡Bienvenido a nuestra aplicación!', datetime('now', '-40 minutes'));

-- Insert translation metrics
INSERT INTO translation_metrics
(id, user_id, language_code, date, translations_completed, words_translated, characters_translated, time_spent_minutes)
VALUES
    ('metric-1', 'user-alice-123', 'fr', date('now'), 3, 8, 59, 70),
    ('metric-2', 'user-bob-456', 'es', date('now'), 2, 6, 41, 25),
    ('metric-3', 'user-alice-123', 'cr', date('now'), 0, 1, 5, 30),
    ('metric-4', 'user-alice-123', 'fr', date('now', '-1 day'), 5, 20, 150, 120);

-- Verify data was inserted
SELECT 'Users:' as table_name, COUNT(*) as count FROM users
UNION ALL
SELECT 'Sessions:', COUNT(*) FROM translation_sessions
UNION ALL
SELECT 'Progress:', COUNT(*) FROM translation_progress
UNION ALL
SELECT 'History:', COUNT(*) FROM edit_history
UNION ALL
SELECT 'Metrics:', COUNT(*) FROM translation_metrics;