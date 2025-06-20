const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const router = express.Router();

// Get AppDataSource dynamically to avoid circular dependency
const getDataSource = () => {
  const { AppDataSource } = require('../index');
  return AppDataSource;
};

// Validate environment variables
if (!process.env.JWT_SECRET) {
  console.error('🚨 JWT_SECRET environment variable is not set!');
  process.env.JWT_SECRET = 'fallback-secret-for-development-only';
  console.log('🔧 Using fallback JWT secret for development');
}

if (!process.env.VITE_BACKEND_URL) {
  console.error('🚨 VITE_BACKEND_URL environment variable is not set!');
}

// Temporary OTP store (in production, use Redis or database)
let otpStore = {};

// Helper functions
const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const getClientInfo = (req) => ({
  ip: req.ip || req.connection.remoteAddress,
  userAgent: req.get('User-Agent') || 'Unknown'
});

const logAuthEvent = async (eventType, phoneNumber, sellerId = null, success = true, error = null, req) => {
  const { ip, userAgent } = getClientInfo(req);
  try {
    const AppDataSource = getDataSource();
    await AppDataSource.query(
      `INSERT INTO auth_logs (seller_id, phone_number, event_type, ip_address, user_agent, success, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [sellerId, phoneNumber, eventType, ip, userAgent, success, error]
    );
    console.log(`📝 Auth Log: ${eventType} for ${phoneNumber} - ${success ? 'SUCCESS' : 'FAILED'}`);
  } catch (err) {
    console.error('Failed to log auth event:', err);
  }
};

// POST /auth/send-otp (Unified signup/login)
router.post('/send-otp', async (req, res) => {
  const { phoneNumber } = req.body;
  const { ip } = getClientInfo(req);
  
  console.log(`🔐 OTP Request: ${phoneNumber} from ${ip}`);
  
  if (!phoneNumber || phoneNumber.length < 10) {
    await logAuthEvent('otp_request', phoneNumber, null, false, 'Invalid phone number', req);
    return res.status(400).json({ error: 'Valid phone number required' });
  }

  try {
    const AppDataSource = getDataSource();
    console.log(`🔍 DataSource available: ${!!AppDataSource}`);
    
    // Check if seller exists
    const sellers = await AppDataSource.query(
      'SELECT seller_id, owner_name, restaurant_name, phone_verified, account_status FROM sellers WHERE rest_phone = $1',
      [phoneNumber]
    );

    const isSignup = sellers.length === 0;
    const seller = sellers[0] || null;

    console.log(`📱 Phone Check: ${phoneNumber} - ${isSignup ? 'NEW USER (SIGNUP)' : 'EXISTING USER (LOGIN)'}`);

    // Check account status for existing users
    if (!isSignup && seller.account_status === 'suspended') {
      await logAuthEvent('otp_request', phoneNumber, seller.seller_id, false, 'Account suspended', req);
      return res.status(403).json({ error: 'Account is suspended' });
    }

    // Rate limiting check
    const recentAttempts = await AppDataSource.query(
      'SELECT COUNT(*) as count FROM otp_attempts WHERE phone_number = $1 AND created_at > NOW() - INTERVAL \'1 hour\'',
      [phoneNumber]
    );

    if (parseInt(recentAttempts[0].count) >= 5) {
      await logAuthEvent('otp_request', phoneNumber, seller?.seller_id, false, 'Rate limit exceeded', req);
      return res.status(429).json({ error: 'Too many OTP requests. Try again later.' });
    }

    // Generate and store OTP
    const otp = generateOTP();
    console.log(`🎲 Generated OTP: ${otp}`);
    const otpHash = hashToken(otp);
    console.log(`🔒 OTP Hash: ${otpHash.substring(0, 10)}...`);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    console.log(`⏰ OTP expires at: ${expiresAt}`);

    await AppDataSource.query(
      `INSERT INTO otp_attempts (phone_number, otp_hash, expires_at, ip_address, is_signup)
       VALUES ($1, $2, $3, $4, $5)`,
      [phoneNumber, otpHash, expiresAt, ip, isSignup]
    );
    console.log(`✅ OTP stored in database`);

    // In production, send SMS/WhatsApp here
    console.log(`🔐 OTP Generated: ${otp} for ${phoneNumber} (${isSignup ? 'SIGNUP' : 'LOGIN'})`);
    console.log(`⏰ Expires at: ${expiresAt.toLocaleTimeString()}`);

    await logAuthEvent('otp_sent', phoneNumber, seller?.seller_id, true, null, req);

    res.json({ 
      success: true, 
      message: 'OTP sent successfully',
      isSignup,
      expiresIn: 300
    });

  } catch (error) {
    console.error('🚨 Send OTP error:', error);
    await logAuthEvent('otp_request', phoneNumber, null, false, error.message, req);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// POST /auth/verify-otp (Handles both signup completion and login)
router.post('/verify-otp', async (req, res) => {
  const { phoneNumber, otp, signupData } = req.body;
  const { ip } = getClientInfo(req);

  console.log(`🔍 OTP Verification: ${phoneNumber} with OTP: ${otp}`);

  if (!phoneNumber || !otp) {
    return res.status(400).json({ error: 'Phone number and OTP required' });
  }

  try {
    const AppDataSource = getDataSource();
    // Get the latest OTP attempt
    const otpAttempts = await AppDataSource.query(
      `SELECT * FROM otp_attempts 
       WHERE phone_number = $1 AND expires_at > NOW() 
       ORDER BY created_at DESC LIMIT 1`,
      [phoneNumber]
    );

    if (otpAttempts.length === 0) {
      await logAuthEvent('otp_verify', phoneNumber, null, false, 'No valid OTP found', req);
      return res.status(400).json({ error: 'No valid OTP found or OTP expired' });
    }

    const otpRecord = otpAttempts[0];
    const otpHash = hashToken(otp);

    // Check OTP attempts
    if (otpRecord.attempts >= 3) {
      await logAuthEvent('otp_verify', phoneNumber, null, false, 'Too many attempts', req);
      return res.status(400).json({ error: 'Too many failed attempts' });
    }

    // Verify OTP
    if (otpRecord.otp_hash !== otpHash) {
      await AppDataSource.query(
        'UPDATE otp_attempts SET attempts = attempts + 1 WHERE id = $1',
        [otpRecord.id]
      );
      await logAuthEvent('otp_verify', phoneNumber, null, false, 'Invalid OTP', req);
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Mark OTP as verified
    await AppDataSource.query(
      'UPDATE otp_attempts SET verified_at = NOW() WHERE id = $1',
      [otpRecord.id]
    );

    let seller;
    let isNewUser = otpRecord.is_signup;

    if (isNewUser) {
      // SIGNUP: Create new seller
      console.log(`👤 Creating new seller account for ${phoneNumber}`);
      
      if (!signupData || !signupData.ownerName || !signupData.restaurantName) {
        return res.status(400).json({ error: 'Owner name and restaurant name required for signup' });
      }

      const sellerId = `SELLER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      await AppDataSource.query(
        `INSERT INTO sellers (seller_id, owner_name, restaurant_name, rest_phone, phone_verified, account_status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [sellerId, signupData.ownerName, signupData.restaurantName, phoneNumber, true, 'active']
      );

      seller = {
        seller_id: sellerId,
        owner_name: signupData.ownerName,
        restaurant_name: signupData.restaurantName,
        rest_phone: phoneNumber
      };

      await logAuthEvent('signup', phoneNumber, sellerId, true, null, req);
      console.log(`✅ Signup completed for ${phoneNumber} - Seller ID: ${sellerId}`);

    } else {
      // LOGIN: Get existing seller
      const sellers = await AppDataSource.query(
        'SELECT seller_id, owner_name, restaurant_name, rest_phone FROM sellers WHERE rest_phone = $1',
        [phoneNumber]
      );

      if (sellers.length === 0) {
        return res.status(404).json({ error: 'Seller not found' });
      }

      seller = sellers[0];

      // Update login info
      await AppDataSource.query(
        'UPDATE sellers SET last_login = NOW(), phone_verified = TRUE WHERE seller_id = $1',
        [seller.seller_id]
      );

      await logAuthEvent('login', phoneNumber, seller.seller_id, true, null, req);
      console.log(`✅ Login successful for ${phoneNumber} - Seller ID: ${seller.seller_id}`);
    }

    // Generate JWT tokens
    const accessToken = jwt.sign(
      {
        userId: seller.seller_id,
        phone: phoneNumber,
        name: seller.owner_name,
        restaurant: seller.restaurant_name,
        type: 'access'
      },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      {
        userId: seller.seller_id,
        phone: phoneNumber,
        type: 'refresh'
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Store refresh token session
    const refreshTokenHash = hashToken(refreshToken);
    await AppDataSource.query(
      `INSERT INTO auth_sessions (seller_id, refresh_token_hash, device_info, ip_address, expires_at)
       VALUES ($1, $2, $3, $4, NOW() + INTERVAL '7 days')`,
      [seller.seller_id, refreshTokenHash, req.get('User-Agent'), ip]
    );

    console.log(`🎫 Tokens generated for ${seller.seller_id}`);

    res.json({
      success: true,
      message: isNewUser ? 'Signup successful' : 'Login successful',
      isSignup: isNewUser,
      tokens: {
        accessToken,
        refreshToken,
        expiresIn: 900 // 15 minutes
      },
      user: {
        id: seller.seller_id,
        name: seller.owner_name,
        phone: phoneNumber,
        restaurant: seller.restaurant_name
      }
    });

  } catch (error) {
    console.error('🚨 Verify OTP error:', error);
    await logAuthEvent('otp_verify', phoneNumber, null, false, error.message, req);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  const { ip } = getClientInfo(req);

  console.log(`🔄 Token refresh request from ${ip}`);

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  try {
    const AppDataSource = getDataSource();
    const payload = jwt.verify(refreshToken, process.env.JWT_SECRET);

    if (payload.type !== 'refresh') {
      return res.status(400).json({ error: 'Invalid token type' });
    }

    // Check if refresh token session exists and is active
    const refreshTokenHash = hashToken(refreshToken);
    const sessions = await AppDataSource.query(
      `SELECT * FROM auth_sessions 
       WHERE seller_id = $1 AND refresh_token_hash = $2 AND is_active = TRUE AND expires_at > NOW()`,
      [payload.userId, refreshTokenHash]
    );

    if (sessions.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired refresh token' });
    }

    // Update session last used
    await AppDataSource.query(
      'UPDATE auth_sessions SET last_used = NOW() WHERE session_id = $1',
      [sessions[0].session_id]
    );

    // Get fresh user data
    const sellers = await AppDataSource.query(
      'SELECT seller_id, owner_name, restaurant_name, rest_phone FROM sellers WHERE seller_id = $1',
      [payload.userId]
    );

    if (sellers.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const seller = sellers[0];

    const newAccessToken = jwt.sign(
      {
        userId: seller.seller_id,
        phone: seller.rest_phone,
        name: seller.owner_name,
        restaurant: seller.restaurant_name,
        type: 'access'
      },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    console.log(`✅ Token refreshed for ${seller.seller_id}`);

    res.json({
      success: true,
      tokens: {
        accessToken: newAccessToken,
        expiresIn: 900
      },
      user: {
        id: seller.seller_id,
        name: seller.owner_name,
        phone: seller.rest_phone,
        restaurant: seller.restaurant_name
      }
    });

  } catch (error) {
    console.error('🚨 Token refresh error:', error);
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// POST /auth/logout
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;
  const authHeader = req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.*)$/i);
  
  console.log(`👋 Logout request`);

  try {
    const AppDataSource = getDataSource();
    let sellerId = null;

    // Get user from access token if available
    if (match) {
      try {
        const accessToken = match[1];
        const payload = jwt.verify(accessToken, process.env.JWT_SECRET);
        sellerId = payload.userId;
      } catch (err) {
        // Token might be expired, continue with refresh token
      }
    }

    // Deactivate refresh token session
    if (refreshToken) {
      const refreshTokenHash = hashToken(refreshToken);
      await AppDataSource.query(
        'UPDATE auth_sessions SET is_active = FALSE WHERE refresh_token_hash = $1',
        [refreshTokenHash]
      );
    }

    if (sellerId) {
      await logAuthEvent('logout', null, sellerId, true, null, req);
    }

    console.log(`✅ Logout successful for seller: ${sellerId || 'unknown'}`);
    res.json({ success: true, message: 'Logged out successfully' });

  } catch (error) {
    console.error('🚨 Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// GET /auth/me
router.get('/me', async (req, res) => {
  try {
    const AppDataSource = getDataSource();
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.*)$/i);
    
    if (!match) {
      return res.status(401).json({ error: 'Missing Bearer token' });
    }

    const token = match[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.type !== 'access') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    const sellers = await AppDataSource.query(
      'SELECT seller_id, owner_name, restaurant_name, rest_phone, account_status, created_at, last_login FROM sellers WHERE seller_id = $1',
      [payload.userId]
    );

    if (sellers.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const seller = sellers[0];

    res.json({
      success: true,
      user: {
        id: seller.seller_id,
        name: seller.owner_name,
        phone: seller.rest_phone,
        restaurant: seller.restaurant_name,
        accountStatus: seller.account_status,
        createdAt: seller.created_at,
        lastLogin: seller.last_login
      }
    });

  } catch (error) {
    console.error('🚨 Get user error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

module.exports = router; 