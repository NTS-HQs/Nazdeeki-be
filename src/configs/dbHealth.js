// Get AppDataSource dynamically to avoid circular dependency
const getDataSource = () => {
  const { AppDataSource } = require('../index');
  return AppDataSource;
};

let healthy = true;
let lastChecked = 0;
const CHECK_INTERVAL = 30 * 1000; // 30 seconds

async function pingDatabase() {
  const now = Date.now();
  if (now - lastChecked < CHECK_INTERVAL) {
    return healthy;
  }
  lastChecked = now;
  try {
    const AppDataSource = getDataSource();
    await AppDataSource.query('SELECT 1');
    healthy = true;
  } catch (e) {
    healthy = false;
  }
  return healthy;
}

module.exports = { pingDatabase }; 