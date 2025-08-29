const express = require('express');

let AppDataSource = null;
const getDataSource = () => {
  if (!AppDataSource) AppDataSource = require('../index').AppDataSource;
  return AppDataSource;
};

const router = express.Router();

// PUBLIC endpoint: distinct categories with sample image
router.get('/public', async (_req, res) => {
  try {
    const ds = getDataSource();
    const rows = await ds.query(`
      SELECT DISTINCT ON (item_cat) item_cat AS name, image
      FROM menu
      WHERE item_cat IS NOT NULL AND image IS NOT NULL
      ORDER BY item_cat, item_id DESC
    `);
    res.json({ success: true, categories: rows, count: rows.length });
  } catch (err) {
    console.error('Get categories error', err);
    res.status(500).json({ error: 'Failed to retrieve categories' });
  }
});

module.exports = router;
