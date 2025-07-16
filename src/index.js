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
const { loadSchema, getPrimaryKey, getReferencingRelations } = require('./utils/schemaLoader');

// Load DB schema from str.csv once at startup
const dbSchema = loadSchema();

// Helper: get first primary key for a table
const primaryKeyFor = (table) => getPrimaryKey(table);

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
// 🛠️  Bootstrap migration: ensure menu table primary key + FK are configured
// -----------------------------------------------------------------------------
async function applyMenuFix() {
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  try {
    // 1) Make item_id an identity column if it is not already
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'menu' 
            AND column_name = 'item_id' 
            AND identity_generation IS NOT NULL
        ) THEN
          ALTER TABLE menu ALTER COLUMN item_id DROP DEFAULT;
          ALTER TABLE menu ALTER COLUMN item_id ADD GENERATED BY DEFAULT AS IDENTITY;
        END IF;
      END $$;
    `);

    // 2) Add foreign-key constraint on rest_id -> sellers(seller_id) if missing
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.table_constraints 
          WHERE constraint_type = 'FOREIGN KEY' 
            AND table_name = 'menu' 
            AND constraint_name = 'fk_menu_rest'
        ) THEN
          ALTER TABLE menu 
            ADD CONSTRAINT fk_menu_rest FOREIGN KEY (rest_id) REFERENCES sellers(seller_id) ON DELETE CASCADE;
        END IF;
      END $$;
    `);
    console.log('✅ [MIGRATION] Menu table verification & fixes applied');
  } catch (err) {
    console.error('⚠️  [MIGRATION] Failed to apply menu table fix:', err.message);
  } finally {
    await queryRunner.release();
  }
}

// -----------------------------------------------------------------------------
// Initialise DB then mount all routes
// -----------------------------------------------------------------------------
console.log('🔌 [DB-CONNECT] Attempting to connect to database...');
const dbInitStart = Date.now();

AppDataSource.initialize()
  .then(async () => {
    // Ensure critical migrations are applied before the server starts handling requests
    await applyMenuFix();
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

// Expose full schema for frontend (MUST come before catch-all /test/:table)
app.get('/test/schema', (_req, res) => {
  res.json(dbSchema.tables);
});

// Test route without auth for frontend testing
app.get('/test/tables', async (_req, res) => {
  try {
    const tables = Object.keys(dbSchema.tables);
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
    let keys = Object.keys(body);
    if (keys.length === 0) return res.status(400).json({ message: 'Body is empty' });
    
    // Special handling for menu table - exclude item_id since it's auto-increment
    if (table === 'menu') {
      keys = keys.filter(key => key !== 'item_id');
      const filteredBody = {};
      keys.forEach(key => { filteredBody[key] = body[key]; });
      var values = Object.values(filteredBody);
    } else {
      var values = Object.values(body);
    }
    
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
    const primaryKey = primaryKeyFor(table);
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
    const primaryKey = primaryKeyFor(table);
    
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
  const queryRunner = AppDataSource.createQueryRunner();
  await queryRunner.connect();
  await queryRunner.startTransaction();
  try {
    console.log(`🗑️ Starting seller deletion process for: ${sellerId}`);

    // 1. Delete rows in tables that have FK to sellers.seller_id (from str.csv)
    const referencing = getReferencingRelations('sellers', 'seller_id');
    for (const rel of referencing) {
      await queryRunner.query(`DELETE FROM ${rel.table} WHERE ${rel.column} = $1`, [sellerId]);
      console.log(`✅ Deleted rows from ${rel.table} referencing sellers.seller_id`);
    }

    // 2. Delete related records that use rest_id = seller_id but are not FK constrained
    const restIdTables = [
      { table: 'collection', key: 'rest_id' },
      { table: 'likes', key: 'rest_id' },
      { table: 'menu', key: 'rest_id' },
      { table: 'order_list', key: 'rest_id' },
      { table: 'orders', key: 'rest_id' },
      { table: 'rating', key: 'rest_id' }
    ];

    for (const { table, key } of restIdTables) {
      await queryRunner.query(`DELETE FROM ${table} WHERE ${key} = $1`, [sellerId]);
      console.log(`✅ Deleted rows from ${table} where ${key} = sellerId`);
    }

    // 3. Obtain address_id (if any) before deleting seller
    const sellerResult = await queryRunner.query('SELECT address_id FROM sellers WHERE seller_id = $1', [sellerId]);
    const addressId = sellerResult.length > 0 ? sellerResult[0].address_id : null;

    // 4. Delete seller row
    await queryRunner.query('DELETE FROM sellers WHERE seller_id = $1', [sellerId]);
    console.log(`✅ Deleted seller: ${sellerId}`);

    // 5. Delete address if not referenced by other sellers
    if (addressId) {
      const otherSellers = await queryRunner.query('SELECT COUNT(*) as count FROM sellers WHERE address_id = $1', [addressId]);
      if (parseInt(otherSellers[0].count, 10) === 0) {
        await queryRunner.query('DELETE FROM addresses WHERE address_id = $1', [addressId]);
        console.log(`✅ Deleted orphaned address: ${addressId}`);
      }
    }

    // Commit transaction
    await queryRunner.commitTransaction();
    console.log(`🎉 Successfully deleted seller and all related data: ${sellerId}`);
  } catch (error) {
    await queryRunner.rollbackTransaction();
    console.error('🚨 Error during seller deletion, transaction rolled back:', error);
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