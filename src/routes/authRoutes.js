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

// Environment variable validation and logging
console.log('\n🔧 Auth Routes Environment Configuration:');
console.log(`📡 Node Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`🔑 JWT Secret: ${process.env.JWT_SECRET ? 'CONFIGURED' : 'NOT SET'}`);
console.log(`🌐 Backend URL: ${process.env.VITE_BACKEND_URL || 'NOT SET'}`);
console.log(`🗄️ Database URL: ${process.env.DATABASE_URL ? 'CONFIGURED' : 'NOT SET'}`);
console.log(`📱 2Factor API Key: ${process.env.TWOFACTOR_API_KEY ? 'CONFIGURED' : 'NOT SET'}`);

if (!process.env.JWT_SECRET) {
  console.error('🚨 [ENV-ERROR] JWT_SECRET environment variable is not set!');
  process.env.JWT_SECRET = 'fallback-secret-for-development-only';
  console.log('🔧 [ENV-FALLBACK] Using fallback JWT secret for development');
}

if (!process.env.VITE_BACKEND_URL) {
  console.error('🚨 [ENV-WARNING] VITE_BACKEND_URL environment variable is not set!');
}

console.log('✅ Auth Routes environment validation completed\n');

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
  const requestStart = Date.now();
  const { phoneNumber } = req.body;
  const { ip } = getClientInfo(req);
  
  console.log(`\n🔐 [OTP-REQUEST-START] New OTP request initiated`);
  console.log(`📞 Phone number: ${phoneNumber}`);
  console.log(`🌐 Client IP: ${ip}`);
  console.log(`⏰ Request time: ${new Date().toISOString()}`);
  console.log(`📋 Request body:`, req.body);
  
  if (!phoneNumber || phoneNumber.length < 10) {
    console.log(`❌ [OTP-VALIDATION-FAILED] Invalid phone number: ${phoneNumber}`);
    console.log(`📏 Phone number length: ${phoneNumber?.length || 0}`);
    await logAuthEvent('otp_request', phoneNumber, null, false, 'Invalid phone number', req);
    return res.status(400).json({ error: 'Valid phone number required' });
  }
  
  console.log(`✅ [OTP-VALIDATION-PASSED] Phone number format valid`);

  try {
    const AppDataSource = getDataSource();
    console.log(`🗄️ [DB-CONNECTION] DataSource available: ${!!AppDataSource}`);
    
    // Check if seller exists
    console.log(`🔍 [DB-QUERY] Checking if seller exists for phone: ${phoneNumber}`);
    const dbQueryStart = Date.now();
    const sellers = await AppDataSource.query(
      'SELECT seller_id, owner_name, restaurant_name, phone_verified, account_status FROM sellers WHERE rest_phone = $1',
      [phoneNumber]
    );
    const dbQueryDuration = Date.now() - dbQueryStart;
    console.log(`⏱️ [DB-QUERY] Database query completed in ${dbQueryDuration}ms`);

    const isSignup = sellers.length === 0;
    const seller = sellers[0] || null;

    console.log(`📱 [USER-CHECK] Phone ${phoneNumber} - ${isSignup ? 'NEW USER (SIGNUP)' : 'EXISTING USER (LOGIN)'}`);
    if (!isSignup) {
      console.log(`👤 [USER-INFO] Existing user: ${seller.owner_name} (${seller.seller_id})`);
      console.log(`📊 [USER-STATUS] Account status: ${seller.account_status}, Phone verified: ${seller.phone_verified}`);
    }

    // Check account status for existing users
    if (!isSignup && seller.account_status === 'suspended') {
      console.log(`🚫 [ACCOUNT-SUSPENDED] Account ${seller.seller_id} is suspended`);
      await logAuthEvent('otp_request', phoneNumber, seller.seller_id, false, 'Account suspended', req);
      return res.status(403).json({ error: 'Account is suspended' });
    }

    // Rate limiting check
    console.log(`⏱️ [RATE-LIMIT-CHECK] Checking recent OTP attempts for ${phoneNumber}`);
    const rateLimitStart = Date.now();
    const recentAttempts = await AppDataSource.query(
      'SELECT COUNT(*) as count FROM otp_attempts WHERE phone_number = $1 AND created_at > NOW() - INTERVAL \'1 hour\'',
      [phoneNumber]
    );
    const rateLimitDuration = Date.now() - rateLimitStart;
    console.log(`⏱️ [RATE-LIMIT-CHECK] Rate limit query completed in ${rateLimitDuration}ms`);

    const attemptCount = parseInt(recentAttempts[0].count);
    console.log(`📊 [RATE-LIMIT-RESULT] Recent attempts in last hour: ${attemptCount}/5`);

    if (attemptCount >= 5) {
      console.log(`🚫 [RATE-LIMIT-EXCEEDED] Too many attempts (${attemptCount}) for ${phoneNumber}`);
      await logAuthEvent('otp_request', phoneNumber, seller?.seller_id, false, 'Rate limit exceeded', req);
      return res.status(429).json({ error: 'Too many OTP requests. Try again later.' });
    }
    
    console.log(`✅ [RATE-LIMIT-PASSED] Rate limit check passed`);

    // Generate OTP and send via 2Factor API
    console.log(`🎲 [OTP-GENERATION] Generating OTP...`);
    const otpGenStart = Date.now();
    const otp = generateOTP();
    const otpGenDuration = Date.now() - otpGenStart;
    console.log(`🎲 [OTP-GENERATED] OTP: ${otp} (generated in ${otpGenDuration}ms)`);
    
    console.log(`🔒 [OTP-HASHING] Creating hash for storage...`);
    const hashStart = Date.now();
    const otpHash = hashToken(otp);
    const hashDuration = Date.now() - hashStart;
    console.log(`🔒 [OTP-HASHED] Hash: ${otpHash.substring(0, 10)}... (hashed in ${hashDuration}ms)`);
    
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
    console.log(`⏰ [OTP-EXPIRY] OTP expires at: ${expiresAt.toISOString()}`);

    // Send OTP via 2Factor API
    console.log(`📱 [SMS-INITIATE] Attempting to send OTP via 2Factor to: ${phoneNumber}`);
    const smsStart = Date.now();
    const smsResult = await send2FactorOTP(phoneNumber, otp);
    const smsDuration = Date.now() - smsStart;
    console.log(`📱 [SMS-COMPLETED] SMS process completed in ${smsDuration}ms`);
    
    let smsProvider = 'console';
    let smsStatus = 'sent';
    let sessionId = null;
    
    console.log(`📋 [SMS-RESULT] Processing SMS delivery result...`);
    if (smsResult.success) {
      smsProvider = '2factor';
      smsStatus = 'sent';
      sessionId = smsResult.sessionId;
      console.log(`✅ [SMS-SUCCESS] SMS sent via 2Factor successfully!`);
      console.log(`📋 [SMS-SESSION] Session ID: ${sessionId}`);
      console.log(`📱 [SMS-TARGET] Target phone: ${smsResult.phoneNumber}`);
    } else {
      console.log(`⚠️ [SMS-FALLBACK] 2Factor SMS failed, falling back to console mode`);
      console.log(`📋 [SMS-ERROR] Error details: ${smsResult.error}`);
      console.log(`📋 [SMS-DETAILS] Additional details: ${smsResult.details}`);
      smsProvider = 'console';
      smsStatus = 'fallback';
      // Still log OTP to console for development
      console.log(`🔐 [CONSOLE-OTP] FALLBACK - OTP for ${phoneNumber}: ${otp} (${isSignup ? 'SIGNUP' : 'LOGIN'})`);
    }

    // Store OTP attempt in database with SMS details
    console.log(`🗄️ [DB-STORE] Storing OTP attempt in database...`);
    const dbStoreStart = Date.now();
    await AppDataSource.query(
      `INSERT INTO otp_attempts (phone_number, otp_hash, expires_at, ip_address, is_signup, session_id, sms_provider, sms_status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [phoneNumber, otpHash, expiresAt, ip, isSignup, sessionId, smsProvider, smsStatus]
    );
    const dbStoreDuration = Date.now() - dbStoreStart;
    console.log(`✅ [DB-STORED] OTP stored in database in ${dbStoreDuration}ms`);
    console.log(`📋 [DB-RECORD] Provider: ${smsProvider}, Status: ${smsStatus}, Session: ${sessionId || 'N/A'}`);

    await logAuthEvent('otp_sent', phoneNumber, seller?.seller_id, smsResult.success, smsResult.success ? null : smsResult.error, req);

    const totalRequestDuration = Date.now() - requestStart;
    console.log(`🎉 [OTP-REQUEST-COMPLETE] Total request processing time: ${totalRequestDuration}ms`);
    console.log(`⏰ [OTP-REQUEST-END] Request completed at: ${new Date().toISOString()}`);

    const responseMessage = smsResult.success ? 'OTP sent successfully via SMS' : 'OTP generated (check console for development)';
    console.log(`📤 [RESPONSE] Sending response: ${responseMessage}`);

    res.json({ 
      success: true, 
      message: responseMessage,
      isSignup,
      expiresIn: 300,
      smsProvider,
      smsStatus: smsResult.success ? 'sent' : 'fallback'
    });

  } catch (error) {
    const totalRequestDuration = Date.now() - requestStart;
    console.log(`💥 [OTP-REQUEST-FAILED] Request failed after ${totalRequestDuration}ms`);
    console.log(`⏰ [OTP-REQUEST-ERROR-TIME] Error occurred at: ${new Date().toISOString()}`);
    console.error('🚨 [OTP-ERROR-DETAILS] Send OTP error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      name: error.name
    });
    await logAuthEvent('otp_request', phoneNumber, null, false, error.message, req);
    console.log(`📤 [ERROR-RESPONSE] Sending error response: Failed to send OTP`);
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
    console.log(`🔍 OTP Record found - Provider: ${otpRecord.sms_provider}, Session: ${otpRecord.session_id}`);

    // Check OTP attempts
    if (otpRecord.attempts >= 3) {
      await logAuthEvent('otp_verify', phoneNumber, null, false, 'Too many attempts', req);
      return res.status(400).json({ error: 'Too many failed attempts' });
    }

    let otpVerified = false;
    let verificationMethod = 'local';

    // Try 2Factor verification first if session_id exists
    if (otpRecord.session_id && otpRecord.sms_provider === '2factor') {
      console.log(`🔍 Attempting 2Factor verification for session: ${otpRecord.session_id}`);
      const factorResult = await verify2FactorOTP(otpRecord.session_id, otp);
      
      if (factorResult.success) {
        otpVerified = true;
        verificationMethod = '2factor';
        console.log(`✅ OTP verified via 2Factor API`);
      } else {
        console.log(`❌ 2Factor verification failed: ${factorResult.error}`);
        // Fall back to local hash verification
      }
    }

    // Fall back to local hash verification if 2Factor failed or not available
    if (!otpVerified) {
      console.log(`🔍 Using local hash verification`);
      const otpHash = hashToken(otp);
      
      if (otpRecord.otp_hash === otpHash) {
        otpVerified = true;
        verificationMethod = 'local';
        console.log(`✅ OTP verified via local hash`);
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
    console.log(`✅ OTP marked as verified using ${verificationMethod} method`);

    let seller;
    let isNewUser = otpRecord.is_signup;

    if (isNewUser) {
      // SIGNUP: Create new seller
      console.log(`👤 Creating new seller account for ${phoneNumber}`);
      
      if (!signupData || !signupData.ownerName || !signupData.restaurantName) {
        return res.status(400).json({ error: 'Owner name and restaurant name required for signup' });
      }

      const sellerId = `SELLER_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Generate address_id as integer (foreign key to addresses table)
      const addressIdResult = await AppDataSource.query('SELECT get_next_address_id() as next_id');
      const addressId = addressIdResult[0].next_id;
      
      // For menu_id, we'll keep it as integer as well (assuming menu table has integer primary key)
      const menuIdResult = await AppDataSource.query('SELECT COALESCE(MAX(item_id), 0) + 1 as next_id FROM menu');
      const menuId = menuIdResult[0].next_id;
      
      console.log(`🏠 Generated address_id: ${addressId}`);
      console.log(`📋 Generated menu_id: ${menuId}`);
      
      // Insert seller record - the trigger will automatically create the address record
      await AppDataSource.query(
        `INSERT INTO sellers (seller_id, owner_name, restaurant_name, rest_phone, phone_verified, account_status, address_id, menu_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())`,
        [sellerId, signupData.ownerName, signupData.restaurantName, phoneNumber, true, 'active', addressId, menuId]
      );

      seller = {
        seller_id: sellerId,
        owner_name: signupData.ownerName,
        restaurant_name: signupData.restaurantName,
        rest_phone: phoneNumber,
        address_id: addressId,
        menu_id: menuId
      };

      await logAuthEvent('signup', phoneNumber, sellerId, true, null, req);
      console.log(`✅ Signup completed for ${phoneNumber} - Seller ID: ${sellerId}`);
      console.log(`📍 Address ID: ${addressId}, Menu ID: ${menuId}`);

    } else {
      // LOGIN: Get existing seller
      const sellers = await AppDataSource.query(
        'SELECT seller_id, owner_name, restaurant_name, rest_phone, address_id, menu_id FROM sellers WHERE rest_phone = $1',
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
      console.log(`📍 Address ID: ${seller.address_id}, Menu ID: ${seller.menu_id}`);
    }

    // Generate JWT tokens
    const accessToken = jwt.sign(
      {
        userId: seller.seller_id,
        phone: phoneNumber,
        name: seller.owner_name,
        restaurant: seller.restaurant_name,
        addressId: seller.address_id,
        menuId: seller.menu_id,
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
        restaurant: seller.restaurant_name,
        addressId: seller.address_id,
        menuId: seller.menu_id
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
      'SELECT seller_id, owner_name, restaurant_name, rest_phone, address_id, menu_id FROM sellers WHERE seller_id = $1',
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
        addressId: seller.address_id,
        menuId: seller.menu_id,
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
        restaurant: seller.restaurant_name,
        addressId: seller.address_id,
        menuId: seller.menu_id
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
      `SELECT seller_id, owner_name, restaurant_name, rest_phone, address_id, menu_id, 
              restaurant_image, operating_hours, service_type, opening_time, closing_time, service_types, pan_no, gst_no, 
              fssai_license, bank_acc_no, ifsc_code, account_holder_name, bank_name, 
              email, special_offers, account_status, created_at, last_login 
       FROM sellers WHERE seller_id = $1`,
      [payload.userId]
    );

    if (sellers.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const seller = sellers[0];

    // Get address data from addresses table
    let addressData = '';
    let addressFields = {};
    if (seller.address_id) {
      try {
        const addressResult = await AppDataSource.query(
          'SELECT * FROM addresses WHERE address_id = $1',
          [seller.address_id]
        );
        if (addressResult.length > 0) {
          const addr = addressResult[0];
          addressData = addr.rest_ad || '';
          addressFields = {
            addressType: addr.address_type,
            country: addr.country,
            state: addr.state,
            city: addr.city,
            pincode: addr.pincode?.toString(),
            houseAddress: addr.house_ad,
            colonyName: addr.colony_name,
            landmark: addr.landmark,
            restaurantAddress: addr.rest_ad,
            latitude: addr.latitude,
            longitude: addr.longitude
          };
        }
      } catch (addressError) {
        console.warn('⚠️ Could not fetch address:', addressError.message);
      }
    }

    res.json({
      success: true,
      user: {
        id: seller.seller_id,
        name: seller.owner_name,
        phone: seller.rest_phone,
        restaurant: seller.restaurant_name,
        addressId: seller.address_id,
        menuId: seller.menu_id,
        restaurantImage: seller.restaurant_image,
        // Address fields (new format)
        ...addressFields,
        // Legacy address
        address: addressData,
        // Operating hours (new format - preferred)
        openingTime: seller.opening_time,
        closingTime: seller.closing_time,
        serviceTypes: seller.service_types || [],
        // Legacy operating hours (maintained for backward compatibility)
        operatingHours: seller.operating_hours,
        serviceType: seller.service_types && seller.service_types.length > 0 ? seller.service_types[0] : null,
        // Documents
        panNo: seller.pan_no,
        gstNo: seller.gst_no,
        fssaiLicense: seller.fssai_license,
        bankAccNo: seller.bank_acc_no,
        ifscCode: seller.ifsc_code,
        accountHolderName: seller.account_holder_name,
        bankName: seller.bank_name,
        email: seller.email,
        specialOffers: seller.special_offers,
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

// PUT /auth/update-profile
router.put('/update-profile', async (req, res) => {
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

    const {
      ownerName,
      restaurantName,
      restaurantImage,
      // Address fields
      addressType,
      country,
      state,
      city,
      pincode,
      houseAddress,
      colonyName,
      landmark,
      restaurantAddress,
      latitude,
      longitude,
      // Operational fields (new format)
      openingTime,
      closingTime,
      serviceTypes,
      // Legacy fields (for backward compatibility)
      address,
      operatingHours,
      serviceType,
      // Documents
      panNo,
      gstNo,
      fssaiLicense,
      bankAccNo,
      ifscCode,
      accountHolderName,
      bankName,
      email,
      specialOffers
    } = req.body;

    // Debug: Log received data
    console.log('🔍 Update profile request data:', {
      addressFields: { addressType, country, state, city, pincode, houseAddress, colonyName, landmark, restaurantAddress, latitude, longitude },
      operationalFields: { openingTime, closingTime, serviceTypes },
      legacyFields: { address, operatingHours, serviceType }
    });

    // Build dynamic update query for sellers table
    const updateFields = [];
    const values = [];
    let paramCount = 1;

    if (ownerName !== undefined) {
      updateFields.push(`owner_name = $${paramCount++}`);
      values.push(ownerName);
    }
    if (restaurantName !== undefined) {
      updateFields.push(`restaurant_name = $${paramCount++}`);
      values.push(restaurantName);
    }
    if (restaurantImage !== undefined) {
      updateFields.push(`restaurant_image = $${paramCount++}`);
      values.push(restaurantImage);
    }
    
    // Handle new time fields (preferred approach)
    if (openingTime !== undefined) {
      updateFields.push(`opening_time = $${paramCount++}`);
      values.push(openingTime);
    }
    if (closingTime !== undefined) {
      updateFields.push(`closing_time = $${paramCount++}`);
      values.push(closingTime);
    }
    
    // Handle service types array (preferred approach)
    if (serviceTypes !== undefined) {
      updateFields.push(`service_types = $${paramCount++}`);
      values.push(serviceTypes);
    }
    
    // Legacy support - operating_hours will be auto-synced by trigger if time fields are updated
    // Only update operating_hours directly if no time fields are provided
    if (operatingHours !== undefined && openingTime === undefined && closingTime === undefined) {
      updateFields.push(`operating_hours = $${paramCount++}`);
      values.push(operatingHours);
    }
    
    // Legacy support for single service type - convert to array
    if (serviceType !== undefined && serviceTypes === undefined) {
      updateFields.push(`service_types = $${paramCount++}`);
      values.push([serviceType]); // Convert single service to array
    }
    
    if (panNo !== undefined) {
      updateFields.push(`pan_no = $${paramCount++}`);
      values.push(panNo);
    }
    if (gstNo !== undefined) {
      updateFields.push(`gst_no = $${paramCount++}`);
      values.push(gstNo);
    }
    if (fssaiLicense !== undefined) {
      updateFields.push(`fssai_license = $${paramCount++}`);
      values.push(fssaiLicense);
    }
    if (bankAccNo !== undefined) {
      updateFields.push(`bank_acc_no = $${paramCount++}`);
      values.push(bankAccNo);
    }
    if (ifscCode !== undefined) {
      updateFields.push(`ifsc_code = $${paramCount++}`);
      values.push(ifscCode);
    }
    if (accountHolderName !== undefined) {
      updateFields.push(`account_holder_name = $${paramCount++}`);
      values.push(accountHolderName);
    }
    if (bankName !== undefined) {
      updateFields.push(`bank_name = $${paramCount++}`);
      values.push(bankName);
    }
    if (email !== undefined) {
      updateFields.push(`email = $${paramCount++}`);
      values.push(email);
    }
    if (specialOffers !== undefined) {
      updateFields.push(`special_offers = $${paramCount++}`);
      values.push(specialOffers);
    }

    // Always update the updated_at timestamp
    updateFields.push(`updated_at = NOW()`);
    values.push(payload.userId);

    let updatedSeller = null;

    // Update sellers table if there are fields to update
    if (updateFields.length > 1) { // More than just updated_at
      const sql = `UPDATE sellers SET ${updateFields.join(', ')} WHERE seller_id = $${paramCount} RETURNING *`;
      console.log('🗃️ Executing sellers update SQL:', sql);
      console.log('🗃️ With values:', values);
      const result = await AppDataSource.query(sql, values);

      if (result.length === 0) {
        return res.status(404).json({ error: 'Seller not found' });
      }
      updatedSeller = result[0];
    } else {
      // Get current seller data
      const result = await AppDataSource.query(
        'SELECT * FROM sellers WHERE seller_id = $1',
        [payload.userId]
      );
      if (result.length === 0) {
        return res.status(404).json({ error: 'Seller not found' });
      }
      updatedSeller = result[0];
    }

    // Handle address separately in addresses table
    let addressData = '';
    let addressFields = {};
    
    // Handle new detailed address fields
    if ((addressType !== undefined || country !== undefined || state !== undefined || 
         city !== undefined || pincode !== undefined || houseAddress !== undefined || 
         colonyName !== undefined || landmark !== undefined || restaurantAddress !== undefined ||
         latitude !== undefined || longitude !== undefined) && updatedSeller.address_id) {
      try {
        // Check if address record exists, if not create it
        const existingAddress = await AppDataSource.query(
          'SELECT * FROM addresses WHERE address_id = $1',
          [updatedSeller.address_id]
        );

        // Build address update fields
        const addressUpdateFields = [];
        const addressValues = [];
        let addressParamCount = 1;
        
        if (addressType !== undefined) {
          addressUpdateFields.push(`address_type = $${addressParamCount++}`);
          addressValues.push(addressType);
        }
        if (country !== undefined) {
          addressUpdateFields.push(`country = $${addressParamCount++}`);
          addressValues.push(country);
        }
        if (state !== undefined) {
          addressUpdateFields.push(`state = $${addressParamCount++}`);
          addressValues.push(state);
        }
        if (city !== undefined) {
          addressUpdateFields.push(`city = $${addressParamCount++}`);
          addressValues.push(city);
        }
        if (pincode !== undefined) {
          addressUpdateFields.push(`pincode = $${addressParamCount++}`);
          addressValues.push(parseInt(pincode) || null);
        }
        if (houseAddress !== undefined) {
          addressUpdateFields.push(`house_ad = $${addressParamCount++}`);
          addressValues.push(houseAddress);
        }
        if (colonyName !== undefined) {
          addressUpdateFields.push(`colony_name = $${addressParamCount++}`);
          addressValues.push(colonyName);
        }
        if (landmark !== undefined) {
          addressUpdateFields.push(`landmark = $${addressParamCount++}`);
          addressValues.push(landmark);
        }
        if (restaurantAddress !== undefined) {
          addressUpdateFields.push(`rest_ad = $${addressParamCount++}`);
          addressValues.push(restaurantAddress);
        }
        if (latitude !== undefined) {
          addressUpdateFields.push(`latitude = $${addressParamCount++}`);
          addressValues.push(parseFloat(latitude) || null);
        }
        if (longitude !== undefined) {
          addressUpdateFields.push(`longitude = $${addressParamCount++}`);
          addressValues.push(parseFloat(longitude) || null);
        }

        if (existingAddress.length === 0) {
          // Create new address record
          const insertFields = ['address_id', 'rest_id'];
          const insertValues = [updatedSeller.address_id, updatedSeller.seller_id];
          const insertPlaceholders = ['$1', '$2'];
          let insertParamCount = 3;
          
          // Add all provided address fields to insert
          if (addressType !== undefined) {
            insertFields.push('address_type');
            insertValues.push(addressType);
            insertPlaceholders.push(`$${insertParamCount++}`);
          }
          if (country !== undefined) {
            insertFields.push('country');
            insertValues.push(country);
            insertPlaceholders.push(`$${insertParamCount++}`);
          }
          if (state !== undefined) {
            insertFields.push('state');
            insertValues.push(state);
            insertPlaceholders.push(`$${insertParamCount++}`);
          }
          if (city !== undefined) {
            insertFields.push('city');
            insertValues.push(city);
            insertPlaceholders.push(`$${insertParamCount++}`);
          }
          if (pincode !== undefined) {
            insertFields.push('pincode');
            insertValues.push(parseInt(pincode) || null);
            insertPlaceholders.push(`$${insertParamCount++}`);
          }
          if (houseAddress !== undefined) {
            insertFields.push('house_ad');
            insertValues.push(houseAddress);
            insertPlaceholders.push(`$${insertParamCount++}`);
          }
          if (colonyName !== undefined) {
            insertFields.push('colony_name');
            insertValues.push(colonyName);
            insertPlaceholders.push(`$${insertParamCount++}`);
          }
          if (landmark !== undefined) {
            insertFields.push('landmark');
            insertValues.push(landmark);
            insertPlaceholders.push(`$${insertParamCount++}`);
          }
          if (restaurantAddress !== undefined) {
            insertFields.push('rest_ad');
            insertValues.push(restaurantAddress);
            insertPlaceholders.push(`$${insertParamCount++}`);
          }
          if (latitude !== undefined) {
            insertFields.push('latitude');
            insertValues.push(parseFloat(latitude) || null);
            insertPlaceholders.push(`$${insertParamCount++}`);
          }
          if (longitude !== undefined) {
            insertFields.push('longitude');
            insertValues.push(parseFloat(longitude) || null);
            insertPlaceholders.push(`$${insertParamCount++}`);
          }
          
          await AppDataSource.query(
            `INSERT INTO addresses (${insertFields.join(', ')}) VALUES (${insertPlaceholders.join(', ')})`,
            insertValues
          );
          console.log('🏠 Inserted new address with fields:', insertFields);
          console.log('🏠 With values:', insertValues);
        } else if (addressUpdateFields.length > 0) {
          // Update existing address record
          addressValues.push(updatedSeller.address_id);
          const addressSql = `UPDATE addresses SET ${addressUpdateFields.join(', ')} WHERE address_id = $${addressParamCount}`;
          console.log('🏠 Executing address update SQL:', addressSql);
          console.log('🏠 With values:', addressValues);
          await AppDataSource.query(
            addressSql,
            addressValues
          );
        }
        
        // Get updated address data
        const updatedAddress = await AppDataSource.query(
          'SELECT * FROM addresses WHERE address_id = $1',
          [updatedSeller.address_id]
        );
        
        if (updatedAddress.length > 0) {
          const addr = updatedAddress[0];
          addressFields = {
            addressType: addr.address_type,
            country: addr.country,
            state: addr.state,
            city: addr.city,
            pincode: addr.pincode?.toString(),
            houseAddress: addr.house_ad,
            colonyName: addr.colony_name,
            landmark: addr.landmark,
            restaurantAddress: addr.rest_ad,
            latitude: addr.latitude,
            longitude: addr.longitude
          };
          addressData = addr.rest_ad || '';
        }
        
        console.log(`✅ Address updated for address_id: ${updatedSeller.address_id}`);
      } catch (addressError) {
        console.error('🚨 Address update error:', addressError.message);
        // Continue without failing the whole request
      }
    } else if (address !== undefined && updatedSeller.address_id) {
      // Legacy address handling
      try {
        const existingAddress = await AppDataSource.query(
          'SELECT address_id FROM addresses WHERE address_id = $1',
          [updatedSeller.address_id]
        );

        if (existingAddress.length === 0) {
          await AppDataSource.query(
            'INSERT INTO addresses (address_id, rest_id, address_type, rest_ad) VALUES ($1, $2, $3, $4)',
            [updatedSeller.address_id, updatedSeller.seller_id, 'restaurant', address]
          );
        } else {
          await AppDataSource.query(
            'UPDATE addresses SET rest_ad = $1 WHERE address_id = $2',
            [address, updatedSeller.address_id]
          );
        }
        
        addressData = address;
        console.log(`✅ Legacy address updated for address_id: ${updatedSeller.address_id}`);
      } catch (addressError) {
        console.error('🚨 Legacy address update error:', addressError.message);
      }
    }

    console.log(`✅ Profile updated for seller: ${payload.userId}`);

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: updatedSeller.seller_id,
        name: updatedSeller.owner_name,
        phone: updatedSeller.rest_phone,
        restaurant: updatedSeller.restaurant_name,
        addressId: updatedSeller.address_id,
        menuId: updatedSeller.menu_id,
        restaurantImage: updatedSeller.restaurant_image,
        // Address fields (new format)
        ...addressFields,
        // Legacy address
        address: addressData,
        // Operating hours (new format - preferred)
        openingTime: updatedSeller.opening_time,
        closingTime: updatedSeller.closing_time,
        serviceTypes: updatedSeller.service_types || [],
        // Legacy operating hours (auto-synced by database trigger)
        operatingHours: updatedSeller.operating_hours,
        serviceType: updatedSeller.service_types && updatedSeller.service_types.length > 0 ? updatedSeller.service_types[0] : null,
        // Documents
        panNo: updatedSeller.pan_no,
        gstNo: updatedSeller.gst_no,
        fssaiLicense: updatedSeller.fssai_license,
        bankAccNo: updatedSeller.bank_acc_no,
        ifscCode: updatedSeller.ifsc_code,
        accountHolderName: updatedSeller.account_holder_name,
        bankName: updatedSeller.bank_name,
        email: updatedSeller.email,
        specialOffers: updatedSeller.special_offers,
        accountStatus: updatedSeller.account_status,
        createdAt: updatedSeller.created_at,
        updatedAt: updatedSeller.updated_at
      }
    });

  } catch (error) {
    console.error('🚨 Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Test endpoint for Step 2 data (bypass auth for testing)
router.put('/test-step2-data', async (req, res) => {
  try {
    const AppDataSource = getDataSource();
    
    console.log('🧪 TEST: Received Step 2 data:', req.body);
    
    const {
      ownerName = 'Test Owner',
      restaurantName = 'Test Restaurant',
      restaurantImage,
      // Address fields
      addressType,
      country,
      state,
      city,
      pincode,
      houseAddress,
      colonyName,
      landmark,
      restaurantAddress,
      latitude,
      longitude,
      // Operational fields (new format)
      openingTime,
      closingTime,
      serviceTypes,
      // Legacy fields (for backward compatibility)
      address,
      operatingHours,
      serviceType
    } = req.body;

    const testSellerId = 'test_step2_seller';
    
    // First, ensure test seller exists
    const existingSeller = await AppDataSource.query(
      'SELECT * FROM sellers WHERE seller_id = $1',
      [testSellerId]
    );
    
    if (existingSeller.length === 0) {
      // Create test seller
      await AppDataSource.query(
        `INSERT INTO sellers (seller_id, owner_name, restaurant_name, created_at, updated_at) 
         VALUES ($1, $2, $3, NOW(), NOW())`,
        [testSellerId, ownerName, restaurantName]
      );
      console.log('✅ Created test seller');
    }

    // Build dynamic update query for sellers table
    const updateFields = [];
    const values = [];
    let paramCount = 1;

    if (restaurantImage !== undefined) {
      updateFields.push(`restaurant_image = $${paramCount++}`);
      values.push(restaurantImage);
    }
    
    // Handle new time fields (preferred approach)
    if (openingTime !== undefined) {
      updateFields.push(`opening_time = $${paramCount++}`);
      values.push(openingTime);
    }
    if (closingTime !== undefined) {
      updateFields.push(`closing_time = $${paramCount++}`);
      values.push(closingTime);
    }
    
    // Handle service types array (preferred approach)
    if (serviceTypes !== undefined) {
      updateFields.push(`service_types = $${paramCount++}`);
      values.push(serviceTypes);
    }
    
    // Legacy support - operating_hours will be auto-synced by trigger if time fields are updated
    // Only update operating_hours directly if no time fields are provided
    if (operatingHours !== undefined && openingTime === undefined && closingTime === undefined) {
      updateFields.push(`operating_hours = $${paramCount++}`);
      values.push(operatingHours);
    }
    
    // Legacy support for single service type - convert to array
    if (serviceType !== undefined && serviceTypes === undefined) {
      updateFields.push(`service_types = $${paramCount++}`);
      values.push([serviceType]); // Convert single service to array
    }

    // Always update the updated_at timestamp
    updateFields.push(`updated_at = NOW()`);
    values.push(testSellerId);

    let updatedSeller = null;

    // Update sellers table if there are fields to update
    if (updateFields.length > 1) {
      const sql = `UPDATE sellers SET ${updateFields.join(', ')} WHERE seller_id = $${paramCount} RETURNING *`;
      console.log('🗃️ TEST: Executing sellers update SQL:', sql);
      console.log('🗃️ TEST: With values:', values);
      const result = await AppDataSource.query(sql, values);
      updatedSeller = result[0];
    } else {
      const result = await AppDataSource.query(
        'SELECT * FROM sellers WHERE seller_id = $1',
        [testSellerId]
      );
      updatedSeller = result[0];
    }

    // Handle address if provided
    if (addressType || country || state || city || pincode || houseAddress || 
        colonyName || landmark || restaurantAddress || latitude || longitude) {
      
      let addressId = updatedSeller.address_id;
      
      if (!addressId) {
        // Create new address
        addressId = 99999; // Test address ID
        await AppDataSource.query(
          `INSERT INTO addresses (address_id, rest_id) VALUES ($1, $2)
           ON CONFLICT (address_id) DO NOTHING`,
          [addressId, testSellerId]
        );
        
        // Link to seller
        await AppDataSource.query(
          'UPDATE sellers SET address_id = $1 WHERE seller_id = $2',
          [addressId, testSellerId]
        );
      }

      // Update address fields
      const addressUpdateFields = [];
      const addressValues = [];
      let addressParamCount = 1;
      
      if (addressType !== undefined) {
        addressUpdateFields.push(`address_type = $${addressParamCount++}`);
        addressValues.push(addressType);
      }
      if (country !== undefined) {
        addressUpdateFields.push(`country = $${addressParamCount++}`);
        addressValues.push(country);
      }
      if (state !== undefined) {
        addressUpdateFields.push(`state = $${addressParamCount++}`);
        addressValues.push(state);
      }
      if (city !== undefined) {
        addressUpdateFields.push(`city = $${addressParamCount++}`);
        addressValues.push(city);
      }
      if (pincode !== undefined) {
        addressUpdateFields.push(`pincode = $${addressParamCount++}`);
        addressValues.push(parseInt(pincode) || null);
      }
      if (houseAddress !== undefined) {
        addressUpdateFields.push(`house_ad = $${addressParamCount++}`);
        addressValues.push(houseAddress);
      }
      if (colonyName !== undefined) {
        addressUpdateFields.push(`colony_name = $${addressParamCount++}`);
        addressValues.push(colonyName);
      }
      if (landmark !== undefined) {
        addressUpdateFields.push(`landmark = $${addressParamCount++}`);
        addressValues.push(landmark);
      }
      if (restaurantAddress !== undefined) {
        addressUpdateFields.push(`rest_ad = $${addressParamCount++}`);
        addressValues.push(restaurantAddress);
      }
      if (latitude !== undefined) {
        addressUpdateFields.push(`latitude = $${addressParamCount++}`);
        addressValues.push(parseFloat(latitude) || null);
      }
      if (longitude !== undefined) {
        addressUpdateFields.push(`longitude = $${addressParamCount++}`);
        addressValues.push(parseFloat(longitude) || null);
      }

      if (addressUpdateFields.length > 0) {
        addressValues.push(addressId);
        const addressSql = `UPDATE addresses SET ${addressUpdateFields.join(', ')} WHERE address_id = $${addressParamCount}`;
        console.log('🏠 TEST: Executing address update SQL:', addressSql);
        console.log('🏠 TEST: With values:', addressValues);
        await AppDataSource.query(addressSql, addressValues);
      }
    }

    // Return success response
    res.json({
      success: true,
      message: 'Step 2 data saved successfully',
      data: {
        sellerId: testSellerId,
        updatedFields: updateFields,
        operationalData: {
          openingTime,
          closingTime,
          serviceTypes
        }
      }
    });

  } catch (error) {
    console.error('🚨 TEST Step 2 error:', error);
    res.status(500).json({ 
      error: 'Failed to save Step 2 data',
      details: error.message,
      stack: error.stack
    });
  }
});

module.exports = router; 