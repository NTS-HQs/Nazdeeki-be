# Database Relationships & CRUD Operations Guide

## 🔗 Foreign Key Relationships

### Tables that reference `sellers` table:
- `auth_logs.seller_id` → `sellers.seller_id` (ON DELETE CASCADE)
- `auth_sessions.seller_id` → `sellers.seller_id` (ON DELETE CASCADE)

### Tables that `sellers` references:
- `sellers.address_id` → `addresses.address_id` (ON DELETE SET NULL)

### Tables related via `rest_id` (restaurant/seller identifier):
- `addresses.rest_id` (stores seller_id for restaurant addresses)
- `collection.rest_id` (user collections for specific restaurants)
- `likes.rest_id` (user likes for specific restaurants) 
- `menu.rest_id` (menu items belonging to restaurants)
- `order_list.rest_id` (order items from specific restaurants)
- `orders.rest_id` (orders placed at specific restaurants)
- `rating.rest_id` (ratings given to specific restaurants)

## 🗑️ Cascade Delete Implementation

### When deleting a `seller`, the system automatically:

1. **Auth Data Cleanup**:
   - Deletes all `auth_sessions` for the seller
   - Keeps `auth_logs` for audit trail (optional deletion)

2. **Business Data Cleanup**:
   - Deletes all `menu` items (`rest_id` = `seller_id`)
   - Deletes all `orders` and `order_list` entries
   - Deletes all `rating` and `likes` entries
   - Deletes all `collection` entries

3. **Address Cleanup**:
   - Checks if the seller's `address_id` is used by other sellers
   - Deletes the address only if no other sellers reference it

4. **Transaction Safety**:
   - All deletions are wrapped in a database transaction
   - If any step fails, the entire operation is rolled back
   - Detailed logging for audit and debugging

## 📊 Primary Key Mappings

```javascript
const primaryKeys = {
  addresses: 'address_id',
  admin: 'admin',
  collection: 'user_id',        // Note: Composite key in practice
  likes: 'user_id',            // Note: Composite key in practice  
  menu: 'item_id',
  order_list: 'order_id',
  orders: 'order_id',          // Note: May not be unique across restaurants
  rating: 'user_id',           // Note: Composite key in practice
  sellers: 'seller_id',
  users: 'user_id',
  auth_sessions: 'session_id',
  auth_logs: 'id',
  otp_attempts: 'id'
};
```

## ⚠️ Important Notes

### Composite Keys
Some tables use composite primary keys in practice:
- `collection`: (`user_id`, `rest_id`, `item_id`)
- `likes`: (`user_id`, `rest_id`)
- `rating`: (`user_id`, `rest_id`)

### Seller Deletion Impact
Deleting a seller affects multiple tables:
```
sellers (1) → affects:
├── auth_sessions (CASCADE)
├── auth_logs (KEPT for audit)
├── addresses (CONDITIONAL - only if not shared)
├── menu (CASCADE via rest_id)
├── orders (CASCADE via rest_id)
├── order_list (CASCADE via rest_id)  
├── rating (CASCADE via rest_id)
├── likes (CASCADE via rest_id)
└── collection (CASCADE via rest_id)
```

## 🛡️ Safety Measures

### Backend Implementation
1. **Transaction Wrapping**: All cascade deletes use database transactions
2. **Detailed Logging**: Each deletion step is logged for audit
3. **Error Handling**: Failed deletions trigger complete rollback
4. **Confirmation Required**: Special UI warnings for seller deletions

### Frontend Implementation  
1. **Special Warnings**: Enhanced confirmation dialogs for seller deletions
2. **Error Display**: Clear error messages when deletions fail
3. **Success Feedback**: Confirmation when cascade deletions complete

## 🔧 API Endpoints

### Test API (No Auth Required)
- `DELETE /test/sellers/:id` - Handles cascade deletion
- `DELETE /test/:table/:id` - Regular deletion for other tables

### Protected API (Auth Required)
- `DELETE /api/sellers/:id` - Handles cascade deletion  
- `DELETE /api/:table/:id` - Regular deletion for other tables

## 🧪 Testing Cascade Deletes

### Using TestPage.tsx:
1. Navigate to `/test` in the frontend
2. Select the `sellers` table
3. Try to delete a seller - you'll see the enhanced warning
4. Check the browser console for detailed deletion logs
5. Verify related data is properly cleaned up

### Using API directly:
```bash
# Delete a seller (replace SELLER_ID with actual ID)
curl -X DELETE http://localhost:3000/test/sellers/SELLER_ID

# Check logs in the backend console for detailed deletion process
```

## 🚨 Production Considerations

1. **Backup First**: Always backup data before bulk deletions
2. **Test Environment**: Test cascade deletions in staging first
3. **Audit Logs**: Keep auth_logs for compliance and debugging
4. **User Communication**: Inform users about data deletion policies
5. **Soft Deletes**: Consider implementing soft deletes for critical data

## 📝 Schema Updates

If you need to modify foreign key relationships:

```sql
-- Add new foreign key constraint
ALTER TABLE table_name 
ADD CONSTRAINT fk_name 
FOREIGN KEY (column) REFERENCES other_table(column) 
ON DELETE CASCADE;

-- Remove foreign key constraint  
ALTER TABLE table_name DROP CONSTRAINT fk_name;
```

Remember to update the cascade deletion logic in the backend when schema changes are made. 