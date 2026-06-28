-- ═══════════════════════════════════════════════════════════════════════════════
-- Grahak Sathi — Admin-Controlled Session Management Migration
-- Run this ONCE against your PostgreSQL database (Netra)
-- ═══════════════════════════════════════════════════════════════════════════════

-- 1. ADMINS TABLE — billing counter operators who control customer sessions
CREATE TABLE IF NOT EXISTS admins (
    id            SERIAL PRIMARY KEY,
    email         VARCHAR(255) UNIQUE NOT NULL,
    owner_name    VARCHAR(255) NOT NULL,
    shop_name     VARCHAR(255) NOT NULL,
    unique_code   VARCHAR(255) NOT NULL,        -- bcrypt hashed
    shop_id       INTEGER REFERENCES retailers(id) ON DELETE CASCADE,
    created_at    TIMESTAMP DEFAULT NOW()
);

-- 2. CUSTOMER_SESSIONS TABLE — admin-managed ephemeral sessions for shoppers
CREATE TABLE IF NOT EXISTS customer_sessions (
    id              SERIAL PRIMARY KEY,
    shop_id         INTEGER NOT NULL REFERENCES retailers(id) ON DELETE CASCADE,
    admin_id        INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    session_token   VARCHAR(64) UNIQUE NOT NULL,   -- UUID given to customer
    customer_name   VARCHAR(255) DEFAULT 'Customer',
    status          VARCHAR(20) DEFAULT 'active',  -- 'active' | 'expired' | 'paid'
    created_at      TIMESTAMP DEFAULT NOW(),
    expired_at      TIMESTAMP,
    payment_total   NUMERIC(10,2) DEFAULT 0
);

-- Index for fast lookup by token
CREATE INDEX IF NOT EXISTS idx_customer_sessions_token ON customer_sessions(session_token);
-- Index for admin's active sessions
CREATE INDEX IF NOT EXISTS idx_customer_sessions_admin_active ON customer_sessions(admin_id, status);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEED: Insert a default admin (change email/code before production!)
-- The unique_code below is bcrypt hash of "ADMIN2024" — change in production
-- To generate your own: node -e "require('bcrypt').hash('YOUR_CODE',10).then(console.log)"
-- ═══════════════════════════════════════════════════════════════════════════════
-- INSERT INTO admins (email, owner_name, shop_name, unique_code, shop_id)
-- VALUES ('admin@grahaksathi.com', 'Admin', 'Grahak Sathi Store', '<bcrypt_hash_here>', 1);
