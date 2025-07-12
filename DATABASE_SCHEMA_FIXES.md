# Database Schema Fixes

## Overview
This document outlines the fixes applied to resolve database schema inconsistencies identified in the `str.csv` analysis.

## Issues Identified

### 1. Missing `operating_hours` Column
- **Problem**: The main `sellers` table was missing the `operating_hours` column at ordinal position 16
- **Impact**: Backend code in `authRoutes.js` still referenced this column, causing potential errors
- **Solution**: Added `operating_hours` column back for backward compatibility

### 2. Skipped Ordinal Position
- **Problem**: Ordinal positions jumped from 15 to 17, missing position 16
- **Impact**: Schema inconsistency and potential issues with automated tools
- **Solution**: Restored proper column ordering by adding the missing column

### 3. Self-Referential Foreign Key
- **Problem**: `sellers.rest_phone` had a self-referential foreign key constraint
- **Impact**: Incorrect relationship modeling
- **Solution**: Removed self-referential constraint, kept unique constraint

## Fixes Applied

### 1. Database Structure Fixes (`database_fix_operational_fields.sql`)

#### Added Missing Column
```sql
ALTER TABLE sellers 
ADD COLUMN IF NOT EXISTS operating_hours VARCHAR(100);
```

#### Fixed Foreign Key Constraints
```sql
-- Remove incorrect self-referential foreign key
ALTER TABLE sellers DROP CONSTRAINT sellers_rest_phone_fkey;

-- Ensure proper unique constraint
ALTER TABLE sellers ADD CONSTRAINT unique_phone UNIQUE(rest_phone);
```

#### Data Synchronization
- Created automatic sync between new time fields (`opening_time`, `closing_time`) and legacy `operating_hours`
- Database trigger maintains consistency automatically

### 2. Backend Code Updates (`authRoutes.js`)

#### Smart Field Handling
- **New approach**: Prefer `opening_time`/`closing_time` and `service_types` array
- **Legacy support**: Maintain `operating_hours` and `serviceType` for backward compatibility
- **Auto-conversion**: Single service types automatically converted to arrays

#### Response Structure
```javascript
// New format (preferred)
openingTime: seller.opening_time,
closingTime: seller.closing_time,
serviceTypes: seller.service_types || [],

// Legacy format (maintained for compatibility)
operatingHours: seller.operating_hours,
serviceType: seller.service_types?.[0] || null
```

### 3. Test Interface Updates (`TestPage.tsx`)

#### Primary Key Mapping
Added support for all tables:
```javascript
const primaryKeys = {
  // ... existing mappings
  auth_sessions: 'session_id',
  auth_logs: 'id',
  otp_attempts: 'id',
  seller_services: 'seller_id',
  sellers_backup: 'seller_id'
};
```

## Migration Steps

### 1. Run Database Fixes
```bash
# Apply the schema fixes
psql -d your_database -f database_fix_operational_fields.sql
```

### 2. Verify Schema
```sql
-- Check table structure
SELECT column_name, ordinal_position, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'sellers' 
ORDER BY ordinal_position;

-- Check constraints
SELECT constraint_name, table_name 
FROM information_schema.table_constraints 
WHERE table_name = 'sellers';
```

### 3. Regenerate Schema CSV
```bash
# Run the regeneration script
psql -d your_database -f regenerate_schema_csv.sql
```

### 4. Test Backend Integration
```bash
# Start the backend server
cd Nazdeeki-be
npm start

# Test the /test endpoint
curl http://localhost:3000/test/tables
```

## Data Flow

### New Operational Data Flow
1. **Frontend sends**: `{ openingTime: "09:00", closingTime: "22:00", serviceTypes: ["Delivery", "Dine-in"] }`
2. **Backend processes**: Updates both new and legacy fields
3. **Database trigger**: Auto-syncs `operating_hours = "09:00 - 22:00"`
4. **Response includes**: Both new and legacy formats for compatibility

### Legacy Data Flow (Still Supported)
1. **Frontend sends**: `{ operatingHours: "9 AM - 10 PM", serviceType: "Delivery" }`
2. **Backend processes**: Updates legacy fields and converts to new format
3. **Database stores**: Both formats maintained
4. **Response includes**: Both formats for maximum compatibility

## Benefits

### 1. Backward Compatibility
- Existing code continues to work without changes
- Legacy fields maintained and auto-synced
- Gradual migration path available

### 2. Forward Compatibility
- New structured fields provide better data handling
- Array-based service types support multiple selections
- Time fields enable better scheduling features

### 3. Data Integrity
- Automatic synchronization prevents inconsistencies
- Database triggers ensure data stays in sync
- Proper constraints maintain data quality

## Testing

### 1. Schema Verification
```sql
-- Verify all columns exist
SELECT COUNT(*) FROM information_schema.columns 
WHERE table_name = 'sellers' AND column_name IN 
('operating_hours', 'opening_time', 'closing_time', 'service_types');
-- Should return 4
```

### 2. Data Sync Testing
```sql
-- Test automatic sync
UPDATE sellers 
SET opening_time = '10:00', closing_time = '23:00' 
WHERE seller_id = 'test_seller';

-- Check sync worked
SELECT operating_hours FROM sellers WHERE seller_id = 'test_seller';
-- Should return '10:00 - 23:00'
```

### 3. API Testing
```bash
# Test profile update with new format
curl -X PUT http://localhost:3000/auth/update-profile \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"openingTime": "08:30", "closingTime": "22:30", "serviceTypes": ["Delivery", "Takeaway"]}'
```

## Maintenance

### Regular Tasks
1. **Monitor sync trigger**: Ensure automatic synchronization continues working
2. **Check constraints**: Verify foreign key and unique constraints remain valid
3. **Update CSV**: Regenerate schema documentation when structure changes

### Future Considerations
1. **Deprecation path**: Plan eventual removal of legacy fields once all clients migrate
2. **Performance monitoring**: Watch for impact of automatic sync triggers
3. **Data migration**: Consider one-time migration of all legacy data to new format

## Troubleshooting

### Common Issues

#### 1. Trigger Not Working
```sql
-- Check if trigger exists
SELECT * FROM information_schema.triggers WHERE trigger_name = 'sync_operating_hours_trigger';

-- Recreate if missing
DROP TRIGGER IF EXISTS sync_operating_hours_trigger ON sellers;
CREATE TRIGGER sync_operating_hours_trigger...
```

#### 2. Foreign Key Errors
```sql
-- Check existing constraints
SELECT * FROM information_schema.table_constraints 
WHERE table_name = 'sellers' AND constraint_type = 'FOREIGN KEY';

-- Remove problematic constraints
ALTER TABLE sellers DROP CONSTRAINT constraint_name;
```

#### 3. Data Inconsistency
```sql
-- Force resync of all data
UPDATE sellers SET opening_time = opening_time WHERE opening_time IS NOT NULL;
``` 