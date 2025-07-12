#!/usr/bin/env node

/**
 * 2Factor Integration Test Script
 * 
 * This script tests the 2Factor SMS integration without starting the full server.
 * Run with: node test_2factor_integration.js
 */

require('dotenv/config');
const { send2FactorOTP, verify2FactorOTP } = require('./src/configs/smsService');

async function test2FactorIntegration() {
  console.log('🧪 Testing 2Factor SMS Integration\n');
  
  // Test phone number (replace with your actual number for testing)
  const testPhoneNumber = '9325235592';
  const testOTP = '1234';
  
  console.log(`📱 Test Phone Number: ${testPhoneNumber}`);
  console.log(`🔐 Test OTP: ${testOTP}\n`);
  
  try {
    // Test 1: Send OTP with custom OTP
    console.log('📤 Test 1: Sending custom OTP via 2Factor...');
    const sendResult = await send2FactorOTP(testPhoneNumber, testOTP);
    
    if (sendResult.success) {
      console.log('✅ SMS sent successfully!');
      console.log(`📋 Session ID: ${sendResult.sessionId}`);
      console.log(`📱 Phone: ${sendResult.phoneNumber}\n`);
      
      // Test 2: Verify the OTP
      console.log('🔍 Test 2: Verifying OTP via 2Factor...');
      const verifyResult = await verify2FactorOTP(sendResult.sessionId, testOTP);
      
      if (verifyResult.success) {
        console.log('✅ OTP verified successfully!');
        console.log(`📋 Details: ${verifyResult.details}\n`);
      } else {
        console.log('❌ OTP verification failed:');
        console.log(`📋 Error: ${verifyResult.error}`);
        console.log(`📋 Details: ${verifyResult.details}\n`);
      }
      
    } else {
      console.log('❌ SMS sending failed:');
      console.log(`📋 Error: ${sendResult.error}`);
      console.log(`📋 Details: ${sendResult.details}\n`);
    }
    
    // Test 3: Test AUTOGEN OTP
    console.log('📤 Test 3: Sending AUTOGEN OTP via 2Factor...');
    const autogenResult = await send2FactorOTP(testPhoneNumber);
    
    if (autogenResult.success) {
      console.log('✅ AUTOGEN SMS sent successfully!');
      console.log(`📋 Session ID: ${autogenResult.sessionId}`);
      console.log(`📱 Phone: ${autogenResult.phoneNumber}`);
      console.log('ℹ️  Check your phone for the OTP and manually verify if needed\n');
    } else {
      console.log('❌ AUTOGEN SMS sending failed:');
      console.log(`📋 Error: ${autogenResult.error}`);
      console.log(`📋 Details: ${autogenResult.details}\n`);
    }
    
    // Test 4: Test phone number formatting
    console.log('📞 Test 4: Testing phone number formatting...');
    const testNumbers = [
      '9325235592',
      '+919325235592',
      '91-9325-235-592',
      '932523559',  // Invalid - 9 digits
      'abc9325235592def'
    ];
    
    for (const number of testNumbers) {
      try {
        console.log(`Testing: ${number}`);
        const result = await send2FactorOTP(number, '0000');
        console.log(`✅ Processed as: ${result.phoneNumber || 'N/A'}`);
      } catch (error) {
        console.log(`❌ Error: ${error.message}`);
      }
    }
    
  } catch (error) {
    console.error('🚨 Test failed with error:', error);
  }
  
  console.log('\n🏁 Test completed!');
  console.log('\n📋 Next Steps:');
  console.log('1. Run the database migration: database_2factor_integration.sql');
  console.log('2. Add TWOFACTOR_API_KEY to your .env file');
  console.log('3. Start the server: npm run dev');
  console.log('4. Test login with a real phone number');
}

// Run the test
test2FactorIntegration().catch(console.error); 