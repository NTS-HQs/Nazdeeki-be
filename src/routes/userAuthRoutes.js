const express = require('express');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { send2FactorOTP, verify2FactorOTP } = require('../configs/smsService');

const router = express.Router();

// Get AppDataSource dynamically to avoid circular dependency
const getDataSource = () => {
  const { AppDataSource } = require('../index');
  return AppDataSource;
};

// Environment variable validation
if (!process.env.JWT_SECRET) {
  console.error('🚨 [ENV-ERROR] JWT_SECRET environment variable is not set!');
  process.env.JWT_SECRET = 'fallback-secret-for-development-only';
}

// Helper functions
const generateOTP = () => Math.floor(1000 + Math.random() * 9000).toString();
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const getClientInfo = (req) => ({
  ip: req.ip || req.connection.remoteAddress,
  userAgent: req.get('User-Agent') || 'Unknown'
});

const logAuthEvent = async (eventType, phoneNumber, userId = null, success = true, error = null, req) => {
  const { ip, userAgent } = getClientInfo(req);
  try {
    const AppDataSource = getDataSource();
    await AppDataSource.query(
      `INSERT INTO auth_logs (seller_id, phone_number, event_type, ip_address, user_agent, success, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [userId ? `USER_${userId}` : null, phoneNumber, `USER_${eventType}`, ip, userAgent, success, error]
    );
    console.log(`📝 User Auth Log: ${eventType} for ${phoneNumber} - ${success ? 'SUCCESS' : 'FAILED'}`);
  } catch (err) {
    console.error('Failed to log user auth event:', err);
  }
};

// POST /auth/user/send-otp
router.post('/send-otp', async (req, res) => {
  const requestStart = Date.now();
  const { phoneNumber } = req.body;
  const { ip } = getClientInfo(req);
  
  console.log(`\n🔐 [USER-OTP-REQUEST-START] New user OTP request`);
  console.log(`📞 Phone number: ${phoneNumber}`);
  console.log(`🌐 Client IP: ${ip}`);
  
  if (!phoneNumber || phoneNumber.length < 10) {
    console.log(`❌ [USER-OTP-VALIDATION-FAILED] Invalid phone number: ${phoneNumber}`);
    await logAuthEvent('otp_request', phoneNumber, null, false, 'Invalid phone number', req);
    return res.status(400).json({ error: 'Valid phone number required' });
  }

  try {
    const AppDataSource = getDataSource();
    
    // Check if user exists
    console.log(`🔍 [USER-DB-QUERY] Checking if user exists for phone: ${phoneNumber}`);
    const users = await AppDataSource.query(
      'SELECT user_id, name, phone FROM users WHERE phone = $1',
      [phoneNumber]
    );

    const isSignup = users.length === 0;
    const user = users[0] || null;

    console.log(`📱 [USER-CHECK] Phone ${phoneNumber} - ${isSignup ? 'NEW USER (SIGNUP)' : 'EXISTING USER (LOGIN)'}`);
    if (!isSignup) {
      console.log(`👤 [USER-INFO] Existing user: ${user.name} (${user.user_id})`);
    }

    // Rate limiting check
    console.log(`⏱️ [USER-RATE-LIMIT-CHECK] Checking recent OTP attempts for ${phoneNumber}`);
    const recentAttempts = await AppDataSource.query(
      'SELECT COUNT(*) as count FROM otp_attempts WHERE phone_number = $1 AND created_at > NOW() - INTERVAL \'1 hour\'',
      [phoneNumber]
    );

    const attemptCount = parseInt(recentAttempts[0].count);
    console.log(`📊 [USER-RATE-LIMIT-RESULT] Recent attempts in last hour: ${attemptCount}/5`);

    if (attemptCount >= 5) {
      console.log(`🚫 [USER-RATE-LIMIT-EXCEEDED] Too many attempts (${attemptCount}) for ${phoneNumber}`);
      await logAuthEvent('otp_request', phoneNumber, user?.user_id, false, 'Rate limit exceeded', req);
      return res.status(429).json({ error: 'Too many OTP requests. Try again later.' });
    }

    // Generate OTP
    const otp = generateOTP();
    const otpHash = hashToken(otp);
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes

    // Send OTP via 2Factor API
    console.log(`📱 [USER-SMS-INITIATE] Attempting to send OTP via 2Factor to: ${phoneNumber}`);
    const smsResult = await send2FactorOTP(phoneNumber, otp);
    
    let smsProvider = 'console';
    let smsStatus = 'sent';
    let sessionId = null;
    
    if (smsResult.success) {
      smsProvider = '2factor';
      sessionId = smsResult.sessionId;
      console.log(`✅ [USER-SMS-SUCCESS] SMS sent via 2Factor successfully!`);
    } else {
      console.log(`⚠️ [USER-SMS-FALLBACK] 2Factor SMS failed, falling back to console mode`);
      console.log(`🔐 [USER-CONSOLE-OTP] FALLBACK - OTP for ${phoneNumber}: ${otp} (${isSignup ? 'SIGNUP' : 'LOGIN'})`);
    }

    // Store OTP attempt in database
    await AppDataSource.query(
      `INSERT INTO otp_attempts (phone_number, otp_hash, expires_at, ip_address, is_signup, session_id, sms_provider, sms_status, attempts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0)`,
      [phoneNumber, otpHash, expiresAt, ip, isSignup, sessionId, smsProvider, smsStatus]
    );

    await logAuthEvent('otp_sent', phoneNumber, user?.user_id, smsResult.success, smsResult.success ? null : smsResult.error, req);

    const totalRequestDuration = Date.now() - requestStart;
    console.log(`🎉 [USER-OTP-REQUEST-COMPLETE] Total request processing time: ${totalRequestDuration}ms`);

    const responseMessage = smsResult.success ? 'OTP sent successfully via SMS' : 'OTP generated (check console for development)';
    
    res.json({ 
      success: true, 
      message: responseMessage,
      isSignup,
      expiresIn: 300,
      smsProvider,
      smsStatus: smsResult.success ? 'sent' : 'fallback'
    });

  } catch (error) {
    console.error('🚨 [USER-OTP-ERROR] Send OTP error:', error);
    await logAuthEvent('otp_request', phoneNumber, null, false, error.message, req);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// POST /auth/user/verify-otp
router.post('/verify-otp', async (req, res) => {
  const { phoneNumber, otp } = req.body;
  const { ip } = getClientInfo(req);

  console.log(`🔍 [USER-OTP-VERIFICATION] ${phoneNumber} with OTP: ${otp}`);

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

    // Check OTP attempts
    if (otpRecord.attempts >= 3) {
      await logAuthEvent('otp_verify', phoneNumber, null, false, 'Too many attempts', req);
      return res.status(400).json({ error: 'Too many failed attempts' });
    }

    let otpVerified = false;
    let verificationMethod = 'local';

    // Try 2Factor verification first if session_id exists
    if (otpRecord.session_id && otpRecord.sms_provider === '2factor') {
      console.log(`🔍 [USER-2FACTOR-VERIFY] Attempting 2Factor verification for session: ${otpRecord.session_id}`);
      const factorResult = await verify2FactorOTP(otpRecord.session_id, otp);
      
      if (factorResult.success) {
        otpVerified = true;
        verificationMethod = '2factor';
        console.log(`✅ [USER-OTP-VERIFIED] OTP verified via 2Factor API`);
      }
    }

    // Fall back to local hash verification if 2Factor failed or not available
    if (!otpVerified) {
      console.log(`🔍 [USER-LOCAL-VERIFY] Using local hash verification`);
      const otpHash = hashToken(otp);
      
      if (otpRecord.otp_hash === otpHash) {
        otpVerified = true;
        verificationMethod = 'local';
        console.log(`✅ [USER-OTP-VERIFIED] OTP verified via local hash`);
      }
    }

    // Handle verification failure
    if (!otpVerified) {
      await AppDataSource.query(
        'UPDATE otp_attempts SET attempts = attempts + 1 WHERE id = $1',
        [otpRecord.id]
      );
      await logAuthEvent('otp_verify', phoneNumber, null, false, 'Invalid OTP', req);
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Mark OTP as verified
    await AppDataSource.query(
      'UPDATE otp_attempts SET verified_at = NOW(), sms_status = $2 WHERE id = $1',
      [otpRecord.id, `verified_${verificationMethod}`]
    );

    let user;
    let isNewUser = otpRecord.is_signup;

    if (isNewUser) {
      // SIGNUP: Create new user
      console.log(`👤 [USER-SIGNUP] Creating new user account for ${phoneNumber}`);
      
      // Generate next user_id manually since it's a required primary key
      const maxUserIdResult = await AppDataSource.query('SELECT COALESCE(MAX(user_id), 0) + 1 as next_id FROM users');
      const nextUserId = maxUserIdResult[0].next_id;
      
      const result = await AppDataSource.query(
        `INSERT INTO users (user_id, phone, name) VALUES ($1, $2, $3) RETURNING *`,
        [nextUserId, phoneNumber, `User ${phoneNumber.slice(-4)}`]
      );
      user = result[0];

      await logAuthEvent('signup', phoneNumber, user.user_id, true, null, req);
      console.log(`✅ [USER-SIGNUP-SUCCESS] Signup completed for ${phoneNumber} - User ID: ${user.user_id}`);

    } else {
      // LOGIN: Get existing user
      const users = await AppDataSource.query(
        'SELECT * FROM users WHERE phone = $1',
        [phoneNumber]
      );

      if (users.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      user = users[0];
      await logAuthEvent('login', phoneNumber, user.user_id, true, null, req);
      console.log(`✅ [USER-LOGIN-SUCCESS] Login successful for ${phoneNumber} - User ID: ${user.user_id}`);
    }

    // Generate JWT tokens
    const accessToken = jwt.sign(
      {
        userId: user.user_id,
        phone: phoneNumber,
        name: user.name,
        type: 'access'
      },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      {
        userId: user.user_id,
        phone: phoneNumber,
        type: 'refresh'
      },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log(`🎫 [USER-TOKENS] Tokens generated for ${user.user_id}`);

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
        id: user.user_id,
        name: user.name,
        phone: phoneNumber,
        email: user.email,
        gender: user.gender,
        dob: user.dob,
        preference: user.preference
      }
    });

  } catch (error) {
    console.error('🚨 [USER-VERIFY-ERROR] Verify OTP error:', error);
    await logAuthEvent('otp_verify', phoneNumber, null, false, error.message, req);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

// POST /auth/user/refresh
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  const { ip } = getClientInfo(req);

  console.log(`🔄 [USER-TOKEN-REFRESH] Token refresh request from ${ip}`);

  if (!refreshToken) {
    return res.status(400).json({ error: 'Refresh token required' });
  }

  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_SECRET);

    if (payload.type !== 'refresh') {
      return res.status(400).json({ error: 'Invalid token type' });
    }

    const AppDataSource = getDataSource();
    
    // Get fresh user data
    const users = await AppDataSource.query(
      'SELECT * FROM users WHERE user_id = $1',
      [payload.userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    const newAccessToken = jwt.sign(
      {
        userId: user.user_id,
        phone: user.phone,
        name: user.name,
        type: 'access'
      },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    console.log(`✅ [USER-TOKEN-REFRESHED] Token refreshed for ${user.user_id}`);

    res.json({
      success: true,
      tokens: {
        accessToken: newAccessToken,
        expiresIn: 900
      },
      user: {
        id: user.user_id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        gender: user.gender,
        dob: user.dob,
        preference: user.preference
      }
    });

  } catch (error) {
    console.error('🚨 [USER-REFRESH-ERROR] Token refresh error:', error);
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
});

// POST /auth/user/logout
router.post('/logout', async (req, res) => {
  console.log(`👋 [USER-LOGOUT] User logout request`);
  res.json({ success: true, message: 'Logged out successfully' });
});

// GET /auth/user/me
router.get('/me', async (req, res) => {
  try {
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

    const AppDataSource = getDataSource();
    const users = await AppDataSource.query(
      'SELECT * FROM users WHERE user_id = $1',
      [payload.userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = users[0];

    res.json({
      success: true,
      user: {
        id: user.user_id,
        name: user.name,
        phone: user.phone,
        email: user.email,
        gender: user.gender,
        dob: user.dob,
        preference: user.preference
      }
    });

  } catch (error) {
    console.error('🚨 [USER-GET-ME-ERROR] Get user error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
});

// PUT /auth/user/update-profile
router.put('/update-profile', async (req, res) => {
  try {
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

    const { name, email, gender, dob, preference } = req.body;

    const AppDataSource = getDataSource();
    
    // Build dynamic update query
    const updateFields = [];
    const values = [];
    let paramCount = 1;

    if (name !== undefined) {
      updateFields.push(`name = $${paramCount++}`);
      values.push(name);
    }
    if (email !== undefined) {
      updateFields.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (gender !== undefined) {
      updateFields.push(`gender = $${paramCount++}`);
      values.push(gender);
    }
    if (dob !== undefined) {
      updateFields.push(`dob = $${paramCount++}`);
      values.push(dob);
    }
    if (preference !== undefined) {
      updateFields.push(`preference = $${paramCount++}`);
      values.push(preference);
    }

    values.push(payload.userId);

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const sql = `UPDATE users SET ${updateFields.join(', ')} WHERE user_id = $${paramCount} RETURNING *`;
    const result = await AppDataSource.query(sql, values);

    if (result.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const updatedUser = result[0];

    console.log(`✅ [USER-PROFILE-UPDATED] Profile updated for user: ${payload.userId}`);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: updatedUser.user_id,
        name: updatedUser.name,
        phone: updatedUser.phone,
        email: updatedUser.email,
        gender: updatedUser.gender,
        dob: updatedUser.dob,
        preference: updatedUser.preference
      }
    });

  } catch (error) {
    console.error('🚨 [USER-UPDATE-ERROR] Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

module.exports = router;