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
      await AppDataSource.query(`DELETE FROM ${tableName} WHERE ${primaryKey} = $1`, [id]);
      res.status(204).send();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
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