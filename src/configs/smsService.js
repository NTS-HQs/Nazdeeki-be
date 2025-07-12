const axios = require('axios');

// 2Factor API Configuration
const TWOFACTOR_API_KEY = process.env.TWOFACTOR_API_KEY || '68289a55-4d40-11f0-a562-0200cd936042';
const TWOFACTOR_BASE_URL = 'https://2factor.in/API/V1';

// Environment variable logging
console.log('🔧 SMS Service Configuration:');
console.log(`📡 2Factor Base URL: ${TWOFACTOR_BASE_URL}`);
console.log(`🔑 2Factor API Key: ${TWOFACTOR_API_KEY ? `${TWOFACTOR_API_KEY.substring(0, 8)}...${TWOFACTOR_API_KEY.substring(-4)}` : 'NOT SET'}`);
console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`📱 SMS Service Status: ${TWOFACTOR_API_KEY ? 'CONFIGURED' : 'FALLBACK MODE'}\n`);

/**
 * Send OTP via 2Factor SMS API
 * @param {string} phoneNumber - Phone number to send OTP to
 * @param {string} otp - OTP to send (optional, use AUTOGEN if not provided)
 * @returns {Promise<object>} - API response
 */
const send2FactorOTP = async (phoneNumber, otp = null) => {
  const startTime = Date.now();
  console.log(`\n📱 [SMS-SEND-START] Initiating OTP send process`);
  console.log(`📞 Original phone number: ${phoneNumber}`);
  console.log(`🔐 OTP mode: ${otp ? 'CUSTOM' : 'AUTOGEN'}`);
  console.log(`⏰ Start time: ${new Date().toISOString()}`);
  
  try {
    // Clean phone number (remove +91 if present, ensure 10 digits)
    console.log(`🧹 Cleaning phone number...`);
    const originalNumber = phoneNumber;
    const cleanPhoneNumber = phoneNumber.replace(/^\+91/, '').replace(/\D/g, '');
    console.log(`📞 Cleaned: ${originalNumber} → ${cleanPhoneNumber}`);
    
    if (cleanPhoneNumber.length !== 10) {
      console.log(`❌ [SMS-VALIDATION-FAILED] Invalid phone number length: ${cleanPhoneNumber.length} digits`);
      throw new Error('Invalid phone number format. Must be 10 digits.');
    }
    console.log(`✅ [SMS-VALIDATION-PASSED] Phone number format valid`);

    // Build API URL
    console.log(`🔗 Building 2Factor API URL...`);
    let apiUrl;
    if (otp) {
      // Send custom OTP
      apiUrl = `${TWOFACTOR_BASE_URL}/${TWOFACTOR_API_KEY}/SMS/${cleanPhoneNumber}/${otp}`;
      console.log(`🔗 Custom OTP URL: ${TWOFACTOR_BASE_URL}/***API_KEY***/SMS/${cleanPhoneNumber}/${otp}`);
    } else {
      // Use AUTOGEN for automatic OTP generation
      apiUrl = `${TWOFACTOR_BASE_URL}/${TWOFACTOR_API_KEY}/SMS/${cleanPhoneNumber}/AUTOGEN`;
      console.log(`🔗 AUTOGEN URL: ${TWOFACTOR_BASE_URL}/***API_KEY***/SMS/${cleanPhoneNumber}/AUTOGEN`);
    }

    console.log(`🌐 [SMS-API-CALL] Making request to 2Factor API...`);
    console.log(`📡 Full API URL: ${apiUrl.replace(TWOFACTOR_API_KEY, '***API_KEY***')}`);

    // Make API call
    const apiCallStart = Date.now();
    console.log(`⏱️ API call timeout: 10 seconds`);
    const response = await axios.get(apiUrl, {
      timeout: 10000, // 10 second timeout
      headers: {
        'Content-Type': 'application/json'
      }
    });

    const apiCallDuration = Date.now() - apiCallStart;
    console.log(`⏱️ [SMS-API-RESPONSE] API call completed in ${apiCallDuration}ms`);
    console.log(`📋 Response status: ${response.status}`);
    console.log(`📋 Response headers:`, response.headers);
    console.log(`✅ 2Factor API Response:`, response.data);

    // Check if API call was successful
    if (response.data && response.data.Status === 'Success') {
      const totalDuration = Date.now() - startTime;
      console.log(`🎉 [SMS-SEND-SUCCESS] OTP sent successfully!`);
      console.log(`📋 Session ID: ${response.data.Details}`);
      console.log(`📱 Target phone: ${cleanPhoneNumber}`);
      console.log(`⏱️ Total process time: ${totalDuration}ms`);
      console.log(`⏰ Completion time: ${new Date().toISOString()}`);
      
      return {
        success: true,
        sessionId: response.data.Details,
        message: 'OTP sent successfully via 2Factor',
        phoneNumber: cleanPhoneNumber
      };
    } else {
      console.log(`❌ [SMS-API-ERROR] 2Factor API returned error status`);
      console.log(`📋 API Status: ${response.data?.Status || 'Unknown'}`);
      console.log(`📋 API Details: ${response.data?.Details || 'No details'}`);
      throw new Error(`2Factor API Error: ${response.data?.Details || 'Unknown error'}`);
    }

  } catch (error) {
    const totalDuration = Date.now() - startTime;
    console.log(`💥 [SMS-SEND-FAILED] Error occurred after ${totalDuration}ms`);
    console.log(`⏰ Failure time: ${new Date().toISOString()}`);
    console.error('🚨 2Factor SMS Error Details:', {
      message: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data
    });
    
    // Handle different types of errors
    if (error.code === 'ECONNABORTED') {
      console.log(`⏰ [SMS-TIMEOUT] Request timed out after 10 seconds`);
      return {
        success: false,
        error: 'SMS service timeout. Please try again.',
        details: error.message
      };
    } else if (error.response) {
      console.log(`🌐 [SMS-HTTP-ERROR] HTTP error response received`);
      console.log(`📋 Status: ${error.response.status}`);
      console.log(`📋 Status Text: ${error.response.statusText}`);
      console.log(`📋 Response Data:`, error.response.data);
      return {
        success: false,
        error: `SMS service error: ${error.response.status}`,
        details: error.response.data
      };
    } else {
      console.log(`🔧 [SMS-GENERAL-ERROR] General error occurred`);
      console.log(`📋 Error type: ${error.constructor.name}`);
      console.log(`📋 Error message: ${error.message}`);
      return {
        success: false,
        error: 'Failed to send SMS',
        details: error.message
      };
    }
  }
};

/**
 * Verify OTP via 2Factor API
 * @param {string} sessionId - Session ID from send OTP response
 * @param {string} otp - OTP entered by user
 * @returns {Promise<object>} - Verification result
 */
const verify2FactorOTP = async (sessionId, otp) => {
  try {
    console.log(`🔍 Verifying OTP via 2Factor - Session: ${sessionId}, OTP: ${otp}`);
    
    const apiUrl = `${TWOFACTOR_BASE_URL}/${TWOFACTOR_API_KEY}/SMS/VERIFY/${sessionId}/${otp}`;
    
    console.log(`🔗 2Factor Verify URL: ${apiUrl}`);

    const response = await axios.get(apiUrl, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ 2Factor Verify Response:`, response.data);

    // Check verification result
    if (response.data && response.data.Status === 'Success') {
      return {
        success: true,
        message: 'OTP verified successfully',
        details: response.data.Details
      };
    } else {
      return {
        success: false,
        error: 'Invalid OTP',
        details: response.data?.Details || 'OTP verification failed'
      };
    }

  } catch (error) {
    console.error('🚨 2Factor OTP Verification Error:', error);
    
    if (error.code === 'ECONNABORTED') {
      return {
        success: false,
        error: 'Verification service timeout. Please try again.',
        details: error.message
      };
    } else if (error.response) {
      return {
        success: false,
        error: `Verification service error: ${error.response.status}`,
        details: error.response.data
      };
    } else {
      return {
        success: false,
        error: 'Failed to verify OTP',
        details: error.message
      };
    }
  }
};

/**
 * Send custom SMS message via 2Factor
 * @param {string} phoneNumber - Phone number to send SMS to
 * @param {string} message - Custom message to send
 * @returns {Promise<object>} - API response
 */
const send2FactorSMS = async (phoneNumber, message) => {
  try {
    console.log(`📱 Sending custom SMS via 2Factor to: ${phoneNumber}`);
    
    const cleanPhoneNumber = phoneNumber.replace(/^\+91/, '').replace(/\D/g, '');
    
    if (cleanPhoneNumber.length !== 10) {
      throw new Error('Invalid phone number format. Must be 10 digits.');
    }

    // For custom messages, use different endpoint
    const apiUrl = `${TWOFACTOR_BASE_URL}/${TWOFACTOR_API_KEY}/ADDON_SERVICES/SEND/TSMS`;
    
    const response = await axios.post(apiUrl, {
      From: 'NAZDEEKI',
      To: cleanPhoneNumber,
      Msg: message
    }, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log(`✅ 2Factor SMS Response:`, response.data);

    if (response.data && response.data.Status === 'Success') {
      return {
        success: true,
        message: 'SMS sent successfully',
        details: response.data.Details
      };
    } else {
      throw new Error(`2Factor SMS Error: ${response.data?.Details || 'Unknown error'}`);
    }

  } catch (error) {
    console.error('🚨 2Factor Custom SMS Error:', error);
    return {
      success: false,
      error: 'Failed to send SMS',
      details: error.message
    };
  }
};

module.exports = {
  send2FactorOTP,
  verify2FactorOTP,
  send2FactorSMS
}; 