-- ============================================================
-- PERFORMANCE INDEXES
-- These indexes improve query performance for frequent reads,
-- filters, sorting, and aggregation operations across the system.
-- Run manually or integrate into your migration pipeline.
-- ============================================================


-- ------------------------------------------------------------
-- USERS TABLE
-- Improves lookup speed for authentication, profile search,
-- and user management operations.
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_users_email
ON users(email); -- Fast login / email-based lookup

CREATE INDEX IF NOT EXISTS idx_users_username
ON users(username); -- Enables quick username search / profile lookup


-- ------------------------------------------------------------
-- ANALYTICS EVENTS
-- Optimized for dashboard queries, filtering, and reporting.
-- Most queries filter by event type and sort by time.
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_analytics_event_timestamp
ON analytics_events(event, timestamp DESC); -- Event-based analytics with time ordering

CREATE INDEX IF NOT EXISTS idx_analytics_userid_timestamp
ON analytics_events(user_id, timestamp DESC); -- User activity tracking over time


-- ------------------------------------------------------------
-- AUDIT LOGS
-- Used for security tracking, debugging, and compliance logs.
-- Typically queried by user and recent activity.
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_audit_userid_createdat
ON audit_logs(user_id, created_at DESC); -- Fast retrieval of user audit history


-- ------------------------------------------------------------
-- GAME SESSIONS
-- Used for gameplay history, leaderboards, and session tracking.
-- Optimized for user-based session queries ordered by time.
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_game_sessions_userid_createdat
ON game_sessions(user_id, created_at DESC); -- Fetch latest sessions per user


-- ------------------------------------------------------------
-- INPUT EVENTS
-- High-frequency event logs tied to gameplay sessions.
-- Used for replay systems, debugging, and behavioral analytics.
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_input_events_gamesessionid_timestamp
ON input_events(game_session_id, timestamp DESC); -- Fast session event replay


-- ------------------------------------------------------------
-- USER BADGES (MANY-TO-MANY RELATIONSHIP)
-- Speeds up joins when fetching user achievements or badge stats.
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_user_badges_userid
ON user_badges(user_id); -- Get all badges for a user

CREATE INDEX IF NOT EXISTS idx_user_badges_badgeid
ON user_badges(badge_id); -- Find all users with a badge


-- ------------------------------------------------------------
-- ANALYTICS (PARTIAL INDEX FOR RECENT DATA)
-- Optimizes dashboards that mostly query recent activity.
-- Reduces index size and improves performance for hot data.
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_analytics_recent
ON analytics_events(timestamp DESC)
WHERE timestamp > now() - INTERVAL '30 days'; -- Focus on recent analytics only


-- ------------------------------------------------------------
-- LEADERBOARD
-- Optimizes rank/score queries and per-user lookups.
-- The userId column already has a UNIQUE constraint; these
-- indexes speed up rank ordering and score-based sorting.
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_leaderboard_rank
ON leaderboard(rank ASC); -- Fast global leaderboard pagination

CREATE INDEX IF NOT EXISTS idx_leaderboard_score_updated
ON leaderboard(score DESC, "updatedAt" ASC); -- Mirrors RANK() window function order