-- ============================================================================
-- Authentication Database Enhancements for Nazdeeki
-- ============================================================================

-- 1. Add authentication fields to sellers table
ALTER TABLE sellers 
ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS account_status VARCHAR(20) DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN IF NOT EXISTS last_login TIMESTAMP,
ADD COLUMN IF NOT EXISTS login_attempts INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP;

-- 2. Create auth_sessions table for refresh token management
CREATE TABLE IF NOT EXISTS auth_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_id VARCHAR REFERENCES sellers(seller_id) ON DELETE CASCADE,
    refresh_token_hash VARCHAR(255) NOT NULL,
    device_info TEXT,
    ip_address INET,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    last_used TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Create otp_attempts table for OTP tracking
CREATE TABLE IF NOT EXISTS otp_attempts (
    id SERIAL PRIMARY KEY,
    phone_number VARCHAR(15) NOT NULL,
    otp_hash VARCHAR(255) NOT NULL,
    attempts INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    verified_at TIMESTAMP,
    ip_address INET,
    is_signup BOOLEAN DEFAULT FALSE
);

-- 4. Create auth_logs table for security monitoring
CREATE TABLE IF NOT EXISTS auth_logs (
    id SERIAL PRIMARY KEY,
    seller_id VARCHAR REFERENCES sellers(seller_id),
    phone_number VARCHAR(15),
    event_type VARCHAR(50) NOT NULL, -- 'otp_sent', 'otp_verified', 'login', 'logout', 'signup'
    ip_address INET,
    user_agent TEXT,
    success BOOLEAN DEFAULT TRUE,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_sellers_phone ON sellers(rest_phone);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_seller ON auth_sessions(seller_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_active ON auth_sessions(is_active, expires_at);
CREATE INDEX IF NOT EXISTS idx_otp_attempts_phone ON otp_attempts(phone_number, expires_at);
CREATE INDEX IF NOT EXISTS idx_auth_logs_seller ON auth_logs(seller_id, created_at);

-- 6. Add constraints
ALTER TABLE sellers ADD CONSTRAINT unique_phone UNIQUE(rest_phone);
ALTER TABLE sellers ADD CONSTRAINT check_account_status 
    CHECK (account_status IN ('pending', 'active', 'suspended', 'deleted'));

-- 7. Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 8. Create trigger for sellers table
DROP TRIGGER IF EXISTS update_sellers_updated_at ON sellers;
CREATE TRIGGER update_sellers_updated_at
    BEFORE UPDATE ON sellers
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- 9. Clean up expired sessions function
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM auth_sessions WHERE expires_at < CURRENT_TIMESTAMP;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;

-- 10. Clean up expired OTP attempts function
CREATE OR REPLACE FUNCTION cleanup_expired_otps()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM otp_attempts WHERE expires_at < CURRENT_TIMESTAMP;
    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RETURN deleted_count;
END;
$$ LANGUAGE plpgsql; 