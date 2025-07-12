# 2Factor SMS Integration Guide

This guide explains how the 2Factor SMS API has been integrated into the Nazdeeki authentication system.

## Overview

The system now supports sending OTP via 2Factor SMS API while maintaining fallback to console logging for development. The integration automatically:

- ✅ Sends OTP via 2Factor SMS API to real phone numbers
- ✅ Falls back to console logging if SMS fails
- ✅ Stores SMS delivery status in database
- ✅ Supports both 2Factor API verification and local hash verification
- ✅ Tracks SMS provider and session details

## Database Changes

### New Columns Added to `otp_attempts` Table

```sql
-- Run this migration to add 2Factor support
-- File: database_2factor_integration.sql

ALTER TABLE otp_attempts 
ADD COLUMN IF NOT EXISTS session_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS sms_provider VARCHAR(20) DEFAULT 'console',
ADD COLUMN IF NOT EXISTS sms_status VARCHAR(20) DEFAULT 'pending';
```

**Column Descriptions:**
- `session_id`: Stores 2Factor API session ID for verification
- `sms_provider`: Tracks which SMS service was used (`console`, `2factor`, `twilio`, etc.)
- `sms_status`: Tracks delivery status (`pending`, `sent`, `failed`, `verified_2factor`, `verified_local`)

## Environment Configuration

Add your 2Factor API key to `.env`:

```env
# 2Factor SMS API Configuration
TWOFACTOR_API_KEY=68289a55-4d40-11f0-a562-0200cd936042
```

## API Integration Details

### 2Factor API Endpoints Used

1. **Send OTP**: `https://2factor.in/API/V1/{API_KEY}/SMS/{PHONE_NUMBER}/{OTP}`
2. **Auto-Generate OTP**: `https://2factor.in/API/V1/{API_KEY}/SMS/{PHONE_NUMBER}/AUTOGEN`
3. **Verify OTP**: `https://2factor.in/API/V1/{API_KEY}/SMS/VERIFY/{SESSION_ID}/{OTP}`

### Phone Number Processing

The system automatically:
- Removes `+91` prefix if present
- Strips all non-digit characters
- Validates 10-digit Indian phone numbers
- Rejects invalid formats with clear error messages

## How It Works

### 1. Send OTP Flow (`POST /auth/send-otp`)

```javascript
// User enters phone number in frontend
const phoneNumber = "9325235592";

// Backend process:
1. Validate phone number format
2. Check if user exists (signup vs login)
3. Generate 4-digit OTP
4. Send OTP via 2Factor API
5. Store OTP details in database with SMS status
6. Return success/failure response
```

**Database Storage:**
```sql
INSERT INTO otp_attempts (
  phone_number, otp_hash, expires_at, ip_address, is_signup,
  session_id, sms_provider, sms_status
) VALUES (
  '9325235592', 'hash...', '2024-01-15 10:35:00', '192.168.1.1', false,
  'ccf23189-9915-415b-bf45-b977559a4a49', '2factor', 'sent'
);
```

### 2. Verify OTP Flow (`POST /auth/verify-otp`)

```javascript
// User enters OTP in frontend
const otp = "1234";

// Backend verification process:
1. Find latest OTP attempt for phone number
2. Check attempt count (max 3 attempts)
3. Try 2Factor API verification if session_id exists
4. Fall back to local hash verification if needed
5. Mark as verified and proceed with login/signup
```

**Verification Priority:**
1. **2Factor API** (if `session_id` exists and `sms_provider` is `'2factor'`)
2. **Local Hash** (fallback for console mode or API failure)

## Response Examples

### Send OTP Success (SMS)
```json
{
  "success": true,
  "message": "OTP sent successfully via SMS",
  "isSignup": false,
  "expiresIn": 300,
  "smsProvider": "2factor",
  "smsStatus": "sent"
}
```

### Send OTP Fallback (Console)
```json
{
  "success": true,
  "message": "OTP generated (check console for development)",
  "isSignup": false,
  "expiresIn": 300,
  "smsProvider": "console",
  "smsStatus": "fallback"
}
```

### Verify OTP Success
```json
{
  "success": true,
  "message": "Login successful",
  "isSignup": false,
  "tokens": { "accessToken": "...", "refreshToken": "..." },
  "user": { "id": "SELLER_123", "name": "John Doe", ... }
}
```

## Frontend Integration

The frontend automatically adapts messages based on SMS status:

```typescript
// LoginPage.tsx handles different SMS providers
if (result.smsProvider === '2factor' && result.smsStatus === 'sent') {
  message = 'OTP sent to your phone successfully!';
} else {
  message = 'OTP generated successfully! Check console for development.';
}
```

## Error Handling

### SMS Service Errors
- **Timeout**: 10-second timeout with graceful fallback
- **API Errors**: Detailed error logging with fallback to console
- **Invalid Phone**: Clear validation messages
- **Rate Limiting**: Built-in protection (5 attempts per hour)

### Verification Errors
- **Invalid OTP**: Clear error messages
- **Expired OTP**: 5-minute expiry with clear messaging
- **Too Many Attempts**: 3-attempt limit per OTP

## Testing

### 1. Test with Real Phone Number
```bash
# Send OTP to real number
curl -X POST http://localhost:3000/auth/send-otp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "9325235592"}'

# Check SMS on phone and verify
curl -X POST http://localhost:3000/auth/verify-otp \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "9325235592", "otp": "1234"}'
```

### 2. Test Fallback Mode
```bash
# Temporarily set invalid API key to test fallback
export TWOFACTOR_API_KEY="invalid_key"
npm run dev

# OTP will fall back to console logging
```

### 3. Database Verification
```sql
-- Check OTP attempts with SMS details
SELECT 
  phone_number, session_id, sms_provider, sms_status, 
  created_at, verified_at 
FROM otp_attempts 
ORDER BY created_at DESC 
LIMIT 10;
```

## Monitoring & Logs

### Console Logs
```
📱 Attempting to send OTP via 2Factor to: 9325235592
🔗 2Factor API URL: https://2factor.in/API/V1/.../SMS/9325235592/1234
✅ 2Factor API Response: {"Status":"Success","Details":"ccf23189-..."}
✅ SMS sent via 2Factor - Session ID: ccf23189-9915-415b-bf45-b977559a4a49
✅ OTP stored in database with SMS details
```

### Database Audit
```sql
-- SMS delivery statistics
SELECT 
  sms_provider, 
  sms_status, 
  COUNT(*) as count,
  AVG(CASE WHEN verified_at IS NOT NULL THEN 1 ELSE 0 END) as success_rate
FROM otp_attempts 
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY sms_provider, sms_status;
```

## Production Considerations

### 1. API Key Security
- Store API key in environment variables
- Never commit API keys to version control
- Use different keys for staging/production

### 2. Rate Limiting
- 2Factor has API rate limits
- Current system limits: 5 OTP requests per hour per phone
- Consider implementing exponential backoff

### 3. Cost Management
- 2Factor charges per SMS
- Monitor usage in 2Factor dashboard
- Set up alerts for unusual usage patterns

### 4. Fallback Strategy
- System gracefully falls back to console logging
- Consider implementing backup SMS providers
- Monitor SMS delivery success rates

## Troubleshooting

### Common Issues

#### 1. SMS Not Received
```bash
# Check logs for 2Factor response
grep "2Factor API Response" logs/app.log

# Check database SMS status
SELECT session_id, sms_status FROM otp_attempts WHERE phone_number = '9325235592';
```

#### 2. API Key Issues
```bash
# Test API key manually
curl "https://2factor.in/API/V1/YOUR_API_KEY/SMS/9325235592/AUTOGEN"
```

#### 3. Phone Number Format Issues
```bash
# System accepts these formats:
9325235592      # ✅ Valid
+919325235592   # ✅ Valid (strips +91)
91-9325235592   # ✅ Valid (strips non-digits)
932523559       # ❌ Invalid (9 digits)
```

## Future Enhancements

### 1. Multiple SMS Providers
- Add Twilio, AWS SNS, MSG91 support
- Implement provider failover
- Cost optimization based on provider rates

### 2. International Support
- Support country codes beyond +91
- International phone number validation
- Multi-region SMS providers

### 3. Advanced Features
- SMS templates for different use cases
- Delivery receipts and read confirmations
- A/B testing for SMS content

---

**Support**: For 2Factor API issues, contact their support at https://2factor.in/support 