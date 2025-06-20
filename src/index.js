require('dotenv/config');
require('reflect-metadata');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { DataSource } = require('typeorm');
const { registerTableRoutes } = require('./routes/routes');
const authRoutes = require('./routes/authRoutes');

const authMiddleware = require('./middlewares/authMiddleware');
const dbHealthCheck = require('./middlewares/dbHealthCheck');
const { pingDatabase } = require('./configs/dbHealth');

// Check for required environment variables
if (!process.env.JWT_SECRET) {
  console.log('🚨 JWT_SECRET environment variable is not set!');
  console.log('🔧 Using fallback JWT secret for development');
}

if (!process.env.DATABASE_URL) {
  console.log('🚨 DATABASE_URL environment variable is not set!');
  console.log('🔧 Please create a .env file with DATABASE_URL');
}

// -----------------------------------------------------------------------------
// Express bootstrap
// -----------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(morgan('dev'));

// -----------------------------------------------------------------------------
// Database (TypeORM) configuration
// -----------------------------------------------------------------------------
const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL || 'postgresql://postgres:BTUpfHJMcDNUjBVNweZzsuUloBxODELx@mainline.proxy.rlwy.net:19943/railway',
  synchronize: false, // never set to true in production
  logging: false,
  entities: [], // using raw SQL for now
  ssl: { rejectUnauthorized: false }, // Railway requires SSL
});

// Make the datasource available to other modules (tests, routers)
module.exports.AppDataSource = AppDataSource;
// -----------------------------------------------------------------------------
// Initialise DB then mount all routes
// -----------------------------------------------------------------------------
AppDataSource.initialize()
  .then(() => {
    console.log('Data Source has been initialized!');
    // Mount auth routes first (no auth required)
    app.use('/auth', authRoutes);
    
    // Apply auth & DB health check to all API routes
    app.use('/api', authMiddleware, dbHealthCheck);
    registerTableRoutes(app);
  })
  .catch((err) => {
    console.error('Error during Data Source initialization', err);
  });

// Basic health-check route
app.get('/', (_req, res) => {
  res.send('Hello from JS Express + TypeORM + PostgreSQL! Nazdeeki backend!!');
});

// Test route without auth for frontend testing
app.get('/test/tables', async (_req, res) => {
  try {
    const tables = ['addresses', 'admin', 'collection', 'likes', 'menu', 'order_list', 'orders', 'rating', 'sellers', 'users'];
    res.json({ tables });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Test CRUD without auth
const testRouter = express.Router();
testRouter.get('/:table', async (req, res) => {
  const { table } = req.params;
  try {
    const rows = await AppDataSource.query(`SELECT * FROM ${table} LIMIT 10`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

testRouter.post('/:table', async (req, res) => {
  const { table } = req.params;
  const body = req.body;
  try {
    const keys = Object.keys(body);
    if (keys.length === 0) return res.status(400).json({ message: 'Body is empty' });
    
    const values = Object.values(body);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(',');
    const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${placeholders}) RETURNING *`;
    const rows = await AppDataSource.query(sql, values);
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

testRouter.put('/:table/:id', async (req, res) => {
  const { table, id } = req.params;
  const body = req.body;
  try {
    const keys = Object.keys(body);
    if (keys.length === 0) return res.status(400).json({ message: 'Body is empty' });
    
    const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(',');
    const values = Object.values(body);
    values.push(id);
    
    // Get primary key for the table (simplified mapping)
    const primaryKeys = {
      addresses: 'address_id',
      admin: 'admin',
      collection: 'user_id',
      likes: 'user_id',
      menu: 'item_id',
      order_list: 'order_id',
      orders: 'order_id',
      rating: 'user_id',
      sellers: 'seller_id',
      users: 'user_id'
    };
    
    const primaryKey = primaryKeys[table] || 'id';
    const sql = `UPDATE ${table} SET ${setClause} WHERE ${primaryKey} = $${keys.length + 1} RETURNING *`;
    const rows = await AppDataSource.query(sql, values);
    
    if (rows.length === 0) return res.status(404).json({ message: 'Record not found' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

testRouter.delete('/:table/:id', async (req, res) => {
  const { table, id } = req.params;
  try {
    // Get primary key for the table
    const primaryKeys = {
      addresses: 'address_id',
      admin: 'admin',
      collection: 'user_id',
      likes: 'user_id',
      menu: 'item_id',
      order_list: 'order_id',
      orders: 'order_id',
      rating: 'user_id',
      sellers: 'seller_id',
      users: 'user_id'
    };
    
    const primaryKey = primaryKeys[table] || 'id';
    const sql = `DELETE FROM ${table} WHERE ${primaryKey} = $1`;
    await AppDataSource.query(sql, [id]);
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.use('/test', testRouter);

app.get('/health', async (_req, res) => {
  const ok = await pingDatabase();
  res.status(ok ? 200 : 503).json({ db: ok ? 'up' : 'down' });
});

// -----------------------------------------------------------------------------
// Start HTTP server
// -----------------------------------------------------------------------------
const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Export app for testing or serverless integration (optional)
module.exports.app = app; 