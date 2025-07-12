const express = require('express');

// Get AppDataSource dynamically to avoid circular dependency
const getDataSource = () => {
  const { AppDataSource } = require('../index');
  return AppDataSource;
};

// -----------------------------------------------------------------------------
// Configuration: list of tables and their primary-key column
// -----------------------------------------------------------------------------
const tableConfigs = [
  { name: 'addresses', primaryKey: 'address_id' },
  { name: 'admin', primaryKey: 'admin' },
  { name: 'collection', primaryKey: 'user_id' },
  { name: 'likes', primaryKey: 'user_id' },
  { name: 'menu', primaryKey: 'item_id' },
  { name: 'order_list', primaryKey: 'order_id' },
  { name: 'orders', primaryKey: 'order_id' },
  { name: 'rating', primaryKey: 'user_id' },
  { name: 'sellers', primaryKey: 'seller_id' },
  { name: 'users', primaryKey: 'user_id' },
];

// -----------------------------------------------------------------------------
// Helper: build a CRUD router for a given table
// -----------------------------------------------------------------------------
function createCrudRouter(tableName, primaryKey) {
  const router = express.Router();

  // GET /                → list first 100 rows
  router.get('/', async (_req, res) => {
    try {
      const AppDataSource = getDataSource();
      const rows = await AppDataSource.query(`SELECT * FROM ${tableName} LIMIT 100`);
      res.json(rows);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /:id             → single row
  router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const AppDataSource = getDataSource();
      const rows = await AppDataSource.query(`SELECT * FROM ${tableName} WHERE ${primaryKey} = $1`, [id]);
      if (rows.length === 0) {
        res.status(404).json({ message: 'Not found' });
        return;
      }
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /               → create row
  router.post('/', async (req, res) => {
    const body = req.body;
    try {
      const AppDataSource = getDataSource();
      const keys = Object.keys(body);
      if (keys.length === 0) {
        res.status(400).json({ message: 'Body is empty' });
        return;
      }

      const values = Object.values(body);
      const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
      const sql = `INSERT INTO ${tableName} (${keys.join(',')}) VALUES (${placeholders}) RETURNING *`;
      const rows = await AppDataSource.query(sql, values);
      res.status(201).json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // PUT /:id             → update row
  router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const body = req.body;
    try {
      const AppDataSource = getDataSource();
      const keys = Object.keys(body);
      if (keys.length === 0) {
        res.status(400).json({ message: 'Body is empty' });
        return;
      }

      const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(',');
      const values = Object.values(body);
      values.push(id); // WHERE clause param

      const sql = `UPDATE ${tableName} SET ${setClause} WHERE ${primaryKey} = $${keys.length + 1} RETURNING *`;
      const rows = await AppDataSource.query(sql, values);
      if (rows.length === 0) {
        res.status(404).json({ message: 'Not found' });
        return;
      }
      res.json(rows[0]);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /:id          → delete row
  router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
      const AppDataSource = getDataSource();
      
      // Special handling for sellers table - handle foreign key relationships
      if (tableName === 'sellers') {
        await handleSellerDeletion(AppDataSource, id);
      } else {
        await AppDataSource.query(`DELETE FROM ${tableName} WHERE ${primaryKey} = $1`, [id]);
      }
      
      res.status(204).send();
    } catch (err) {
      console.error(`Delete error for ${tableName}:`, err);
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

// Helper function to handle seller deletion with foreign key cleanup
async function handleSellerDeletion(AppDataSource, sellerId) {
  // Start transaction
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  
  try {
    console.log(`🗑️ Starting seller deletion process for: ${sellerId}`);
    
    // 1. Delete from auth_sessions (CASCADE should handle this, but being explicit)
    await queryRunner.query('DELETE FROM auth_sessions WHERE seller_id = $1', [sellerId]);
    console.log(`✅ Deleted auth_sessions for seller: ${sellerId}`);
    
    // 2. Delete from auth_logs (keep logs for audit, but can be deleted if needed)
    // await queryRunner.query('DELETE FROM auth_logs WHERE seller_id = $1', [sellerId]);
    
    // 3. Delete related records by rest_id (assuming rest_id = seller_id)
    const relatedTables = [
      { table: 'collection', key: 'rest_id' },
      { table: 'likes', key: 'rest_id' },
      { table: 'menu', key: 'rest_id' },
      { table: 'order_list', key: 'rest_id' },
      { table: 'orders', key: 'rest_id' },
      { table: 'rating', key: 'rest_id' }
    ];
    
    for (const { table, key } of relatedTables) {
      const result = await queryRunner.query(`DELETE FROM ${table} WHERE ${key} = $1`, [sellerId]);
      console.log(`✅ Deleted ${result.affectedRows || 0} records from ${table} for seller: ${sellerId}`);
    }
    
    // 4. Get the address_id before deleting seller
    const sellerResult = await queryRunner.query('SELECT address_id FROM sellers WHERE seller_id = $1', [sellerId]);
    const addressId = sellerResult.length > 0 ? sellerResult[0].address_id : null;
    
    // 5. Delete the seller
    await queryRunner.query('DELETE FROM sellers WHERE seller_id = $1', [sellerId]);
    console.log(`✅ Deleted seller: ${sellerId}`);
    
    // 6. Delete associated address if it exists and is only used by this seller
    if (addressId) {
      // Check if any other sellers use this address
      const otherSellers = await queryRunner.query('SELECT COUNT(*) as count FROM sellers WHERE address_id = $1', [addressId]);
      if (parseInt(otherSellers[0].count) === 0) {
        await queryRunner.query('DELETE FROM addresses WHERE address_id = $1', [addressId]);
        console.log(`✅ Deleted associated address: ${addressId}`);
      }
    }
    
    // Commit transaction
    await queryRunner.commitTransaction();
    console.log(`🎉 Successfully deleted seller and all related data: ${sellerId}`);
    
  } catch (error) {
    // Rollback transaction
    await queryRunner.rollbackTransaction();
    console.error(`🚨 Error during seller deletion, transaction rolled back:`, error);
    throw error;
  } finally {
    await queryRunner.release();
  }
}

// -----------------------------------------------------------------------------
// Public: register all routers on an Express app instance
// -----------------------------------------------------------------------------
function registerTableRoutes(app) {
  tableConfigs.forEach(({ name, primaryKey }) => {
    app.use(`/api/${name}`, createCrudRouter(name, primaryKey));
  });
}

module.exports = { registerTableRoutes }; 