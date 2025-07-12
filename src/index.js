require('dotenv/config');
require('reflect-metadata');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { DataSource } = require('typeorm');
const { registerTableRoutes } = require('./routes/routes');
const authRoutes = require('./routes/authRoutes');
const uploadRoutes = require('./routes/uploadRoutes');

const authMiddleware = require('./middlewares/authMiddleware');
const dbHealthCheck = require('./middlewares/dbHealthCheck');
const { pingDatabase } = require('./configs/dbHealth');

console.log('\n🚀 [SERVER-INIT] Nazdeeki Backend Server Starting...');
console.log(`⏰ [SERVER-INIT] Startup time: ${new Date().toISOString()}`);
console.log(`🌍 [SERVER-INIT] Node.js version: ${process.version}`);
console.log(`📁 [SERVER-INIT] Working directory: ${process.cwd()}`);

// Environment variable validation and logging
console.log('\n🔧 [ENV-INIT] Environment Variables Configuration:');
console.log(`📡 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
console.log(`🌐 PORT: ${process.env.PORT || '3000'}`);
console.log(`🔑 JWT_SECRET: ${process.env.JWT_SECRET ? 'CONFIGURED' : 'NOT SET'}`);
console.log(`🗄️ DATABASE_URL: ${process.env.DATABASE_URL ? 'CONFIGURED' : 'NOT SET'}`);
console.log(`📱 TWOFACTOR_API_KEY: ${process.env.TWOFACTOR_API_KEY ? 'CONFIGURED' : 'NOT SET'}`);
console.log(`☁️ CLOUDINARY_CLOUD_NAME: ${process.env.CLOUDINARY_CLOUD_NAME || 'NOT SET'}`);
console.log(`🔑 CLOUDINARY_API_KEY: ${process.env.CLOUDINARY_API_KEY ? 'CONFIGURED' : 'NOT SET'}`);
console.log(`🌐 FRONTEND_URL: ${process.env.FRONTEND_URL || 'http://localhost:5173'}`);

// Check for required environment variables
if (!process.env.JWT_SECRET) {
  console.log('🚨 [ENV-ERROR] JWT_SECRET environment variable is not set!');
  console.log('🔧 [ENV-FALLBACK] Using fallback JWT secret for development');
}

if (!process.env.DATABASE_URL) {
  console.log('🚨 [ENV-ERROR] DATABASE_URL environment variable is not set!');
  console.log('🔧 [ENV-WARNING] Please create a .env file with DATABASE_URL');
}

console.log('✅ [ENV-INIT] Environment variables validation completed\n');

// -----------------------------------------------------------------------------
// Express bootstrap
// -----------------------------------------------------------------------------
console.log('🌐 [EXPRESS-INIT] Initializing Express application...');
const app = express();

console.log('📋 [EXPRESS-MIDDLEWARE] Setting up middleware...');
app.use(express.json());
console.log('✅ [EXPRESS-MIDDLEWARE] JSON parser configured');

const corsOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
app.use(cors({
  origin: corsOrigin,
  credentials: true
}));
console.log(`✅ [EXPRESS-MIDDLEWARE] CORS configured for origin: ${corsOrigin}`);

app.use(morgan('dev'));
console.log('✅ [EXPRESS-MIDDLEWARE] Morgan logging configured');
console.log('✅ [EXPRESS-INIT] Express application initialized\n');

// -----------------------------------------------------------------------------
// Database (TypeORM) configuration
// -----------------------------------------------------------------------------
console.log('🗄️ [DB-INIT] Configuring database connection...');
const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:BTUpfHJMcDNUjBVNweZzsuUloBxODELx@mainline.proxy.rlwy.net:19943/railway';
console.log(`🗄️ [DB-CONFIG] Database URL: ${databaseUrl.replace(/\/\/.*@/, '//***:***@')}`);

const AppDataSource = new DataSource({
  type: 'postgres',
  url: databaseUrl,
  synchronize: false, // never set to true in production
  logging: false,
  entities: [], // using raw SQL for now
  ssl: { rejectUnauthorized: false }, // Railway requires SSL
});

console.log('🗄️ [DB-CONFIG] Database configuration:');
console.log(`  📊 Type: PostgreSQL`);
console.log(`  🔄 Synchronize: false (production safe)`);
console.log(`  📝 Logging: false`);
console.log(`  🔒 SSL: enabled (rejectUnauthorized: false)`);
console.log('✅ [DB-INIT] Database configuration completed\n');

// Make the datasource available to other modules (tests, routers)
module.exports.AppDataSource = AppDataSource;
// -----------------------------------------------------------------------------
// Initialise DB then mount all routes
// -----------------------------------------------------------------------------
console.log('🔌 [DB-CONNECT] Attempting to connect to database...');
const dbInitStart = Date.now();

AppDataSource.initialize()
  .then(() => {
    const dbInitDuration = Date.now() - dbInitStart;
    console.log(`✅ [DB-CONNECT] Database connection established in ${dbInitDuration}ms!`);
    console.log('🛣️ [ROUTES-INIT] Mounting application routes...');
    
    // Mount auth routes first (no auth required)
    app.use('/auth', authRoutes);
    console.log('✅ [ROUTES] Auth routes mounted at /auth');
    
    // Mount upload routes (with auth built-in)
    app.use('/upload', uploadRoutes);
    console.log('✅ [ROUTES] Upload routes mounted at /upload');
    
    // Apply auth & DB health check to all API routes
    app.use('/api', authMiddleware, dbHealthCheck);
    registerTableRoutes(app);
    console.log('✅ [ROUTES] Protected API routes mounted at /api');
    console.log('✅ [ROUTES-INIT] All routes successfully mounted\n');
  })
  .catch((err) => {
    const dbInitDuration = Date.now() - dbInitStart;
    console.error(`💥 [DB-CONNECT-FAILED] Database connection failed after ${dbInitDuration}ms`);
    console.error('🚨 [DB-ERROR] Error details:', {
      message: err.message,
      code: err.code,
      stack: err.stack
    });
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
      users: 'user_id',
      auth_sessions: 'session_id',
      auth_logs: 'id',
      otp_attempts: 'id',
      seller_services: 'seller_id',
      sellers_backup: 'seller_id'
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
      users: 'user_id',
      auth_sessions: 'session_id',
      auth_logs: 'id',
      otp_attempts: 'id',
      seller_services: 'seller_id',
      sellers_backup: 'seller_id'
    };
    
    const primaryKey = primaryKeys[table] || 'id';
    
    // Special handling for sellers table - handle foreign key relationships
    if (table === 'sellers') {
      await handleSellerDeletion(id);
    } else {
      // Regular delete for other tables
      const sql = `DELETE FROM ${table} WHERE ${primaryKey} = $1`;
      await AppDataSource.query(sql, [id]);
    }
    
    res.status(204).send();
  } catch (err) {
    console.error(`Delete error for ${table}:`, err);
    res.status(500).json({ error: err.message });
  }
});

// Helper function to handle seller deletion with foreign key cleanup
async function handleSellerDeletion(sellerId) {
  const AppDataSource = require('./index').AppDataSource;
  
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

app.use('/test', testRouter);

app.get('/health', async (_req, res) => {
  const ok = await pingDatabase();
  res.status(ok ? 200 : 503).json({ db: ok ? 'up' : 'down' });
});

// -----------------------------------------------------------------------------
// Start HTTP server
// -----------------------------------------------------------------------------
const port = process.env.PORT || 3000;
console.log(`🚀 [SERVER-START] Starting HTTP server on port ${port}...`);

app.listen(port, () => {
  console.log(`\n🎉 [SERVER-READY] Nazdeeki Backend Server is running!`);
  console.log(`🌐 [SERVER-INFO] Server URL: http://localhost:${port}`);
  console.log(`📡 [SERVER-INFO] Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⏰ [SERVER-INFO] Server started at: ${new Date().toISOString()}`);
  console.log('\n📋 [SERVER-ENDPOINTS] Available endpoints:');
  console.log('  🔐 Auth: /auth/send-otp, /auth/verify-otp, /auth/refresh');
  console.log('  📤 Upload: /upload/restaurant-image');
  console.log('  🛠️ API: /api/* (requires authentication)');
  console.log('  🧪 Test: /test/* (no authentication required)');
  console.log('  ❤️ Health: /health');
  console.log('\n✅ [SERVER-READY] Server is ready to accept connections!\n');
});

// Export app for testing or serverless integration (optional)
module.exports.app = app; 