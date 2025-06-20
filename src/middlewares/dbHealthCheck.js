const { pingDatabase } = require('../configs/dbHealth');

async function dbHealthCheck(req, res, next) {
  const ok = await pingDatabase();
  if (!ok) {
    return res.status(503).json({ error: 'Database unavailable' });
  }
  next();
}

module.exports = dbHealthCheck; 