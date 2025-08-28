const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { uploadImage, deleteImage } = require('../configs/cloudinary');

// Import the AppDataSource from index.js
let AppDataSource = null;
const getDataSource = () => {
  if (!AppDataSource) {
    AppDataSource = require('../index').AppDataSource;
  }
  return AppDataSource;
};

const router = express.Router();

// Configure multer for memory storage (upload directly to Cloudinary)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Middleware to verify JWT token
const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || '';
    const match = authHeader.match(/^Bearer\s+(.*)$/i);
    
    if (!match) {
      return res.status(401).json({ error: 'Missing Bearer token' });
    }

    const token = match[1];
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    if (payload.type !== 'access') {
      return res.status(401).json({ error: 'Invalid token type' });
    }

    req.user = payload;
    next();
  } catch (error) {
    console.error('🚨 Token verification error:', error);
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// GET /offers - Get all offers for authenticated seller
router.get('/', verifyToken, async (req, res) => {
  try {
    const AppDataSource = getDataSource();
    const offers = await AppDataSource.query(`
      SELECT 
        offer_id,
        offer_title,
        offer_description,
        offer_image,
        discount_type,
        discount_value,
        min_order_amount,
        max_discount_amount,
        valid_from,
        valid_until,
        is_active,
        usage_limit,
        used_count,
        created_at,
        updated_at
      FROM offers 
      WHERE seller_id = $1 
      ORDER BY created_at DESC
    `, [req.user.userId]);

    console.log(`📋 Retrieved ${offers.length} offers for seller: ${req.user.userId}`);

    res.json({
      success: true,
      offers: offers,
      count: offers.length
    });

  } catch (error) {
    console.error('🚨 Get offers error:', error);
    res.status(500).json({ error: 'Failed to retrieve offers' });
  }
});

// GET /offers/active - Get only active offers for authenticated seller
router.get('/active', verifyToken, async (req, res) => {
  try {
    const AppDataSource = getDataSource();
    const offers = await AppDataSource.query(`
      SELECT 
        offer_id,
        offer_title,
        offer_description,
        offer_image,
        discount_type,
        discount_value,
        min_order_amount,
        max_discount_amount,
        valid_from,
        valid_until,
        usage_limit,
        used_count,
        created_at
      FROM offers 
      WHERE seller_id = $1 
        AND is_active = TRUE 
        AND (valid_until IS NULL OR valid_until > NOW())
        AND (usage_limit IS NULL OR used_count < usage_limit)
      ORDER BY created_at DESC
    `, [req.user.userId]);

    console.log(`✅ Retrieved ${offers.length} active offers for seller: ${req.user.userId}`);

    res.json({
      success: true,
      offers: offers,
      count: offers.length
    });

  } catch (error) {
    console.error('🚨 Get active offers error:', error);
    res.status(500).json({ error: 'Failed to retrieve active offers' });
  }
});

// -----------------------------------------------------------------------------
// PUBLIC ENDPOINT (No Auth) - Get active offers across ALL sellers (for User app)
// -----------------------------------------------------------------------------
router.get('/public/active', async (_req, res) => {
  try {
    const AppDataSource = getDataSource();
    const offers = await AppDataSource.query(`
      SELECT 
        offer_id,
        seller_id,
        offer_title,
        offer_description,
        offer_image,
        discount_type,
        discount_value,
        min_order_amount,
        max_discount_amount,
        valid_from,
        valid_until,
        usage_limit,
        used_count,
        created_at
      FROM offers 
      WHERE is_active = TRUE 
        AND (valid_until IS NULL OR valid_until > NOW())
        AND (usage_limit IS NULL OR used_count < usage_limit)
      ORDER BY created_at DESC
    `);

    console.log(`✅ Retrieved ${offers.length} public active offers`);

    res.json({
      success: true,
      offers,
      count: offers.length,
    });
  } catch (error) {
    console.error('🚨 Get public active offers error:', error);
    res.status(500).json({ error: 'Failed to retrieve offers' });
  }
});

// POST /offers - Create new offer
router.post('/', verifyToken, async (req, res) => {
  try {
    const {
      valid_from,
      valid_until
    } = req.body;

    const AppDataSource = getDataSource();
    const result = await AppDataSource.query(`
      INSERT INTO offers (
        seller_id, valid_from, valid_until
      ) VALUES ($1, $2, $3)
      RETURNING *
    `, [
      req.user.userId,
      valid_from || null,
      valid_until || null
    ]);

    const newOffer = result[0];
    console.log(`✅ Created new offer: ${newOffer.offer_id} for seller: ${req.user.userId}`);

    res.status(201).json({
      success: true,
      message: 'Offer created successfully',
      offer: newOffer
    });

  } catch (error) {
    console.error('🚨 Create offer error:', error);
    res.status(500).json({ error: 'Failed to create offer' });
  }
});

// POST /offers/:offerId/image - Upload image for specific offer
router.post('/:offerId/image', verifyToken, upload.single('image'), async (req, res) => {
  try {
    const { offerId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Verify offer belongs to authenticated seller
    const AppDataSource = getDataSource();
    const offers = await AppDataSource.query(
      'SELECT offer_id, offer_image_public_id FROM offers WHERE offer_id = $1 AND seller_id = $2',
      [offerId, req.user.userId]
    );

    if (offers.length === 0) {
      return res.status(404).json({ error: 'Offer not found or not authorized' });
    }

    console.log(`📸 Uploading offer image for offer: ${offerId}, seller: ${req.user.userId}`);
    console.log(`📁 File size: ${req.file.size} bytes, type: ${req.file.mimetype}`);

    // Delete existing image if present
    const existingPublicId = offers[0].offer_image_public_id;
    if (existingPublicId) {
      console.log(`🗑️ Deleting existing offer image: ${existingPublicId}`);
      await deleteImage(existingPublicId);
    }

    // Convert buffer to base64 for Cloudinary upload
    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    // Upload to Cloudinary with offer-specific options
    const uploadResult = await uploadImage(base64Image, {
      public_id: `offer_${offerId}_${Date.now()}`,
      folder: 'nazdeeki/offers', // Separate folder for offers
      transformation: [
        { width: 800, height: 600, crop: 'limit' }, // Offer images
        { quality: 'auto' },
        { fetch_format: 'auto' }
      ]
    });

    if (!uploadResult.success) {
      return res.status(500).json({ 
        error: 'Failed to upload image', 
        details: uploadResult.error 
      });
    }

    // Update offer with new image URL and public_id
    await AppDataSource.query(`
      UPDATE offers 
      SET offer_image = $1, offer_image_public_id = $2, updated_at = NOW() 
      WHERE offer_id = $3 AND seller_id = $4
    `, [uploadResult.url, uploadResult.publicId, offerId, req.user.userId]);

    console.log(`✅ Offer image uploaded successfully for offer: ${offerId}`);
    console.log(`🔗 Image URL: ${uploadResult.url}`);

    res.json({
      success: true,
      message: 'Offer image uploaded successfully',
      image: {
        url: uploadResult.url,
        publicId: uploadResult.publicId,
        width: uploadResult.width,
        height: uploadResult.height,
        format: uploadResult.format,
        size: uploadResult.bytes
      }
    });

  } catch (error) {
    console.error('🚨 Offer image upload error:', error);
    res.status(500).json({ error: 'Failed to upload offer image' });
  }
});

// PUT /offers/:offerId - Update offer
router.put('/:offerId', verifyToken, async (req, res) => {
  try {
    const { offerId } = req.params;
    const updates = req.body;

    // Remove fields that shouldn't be updated directly
    delete updates.offer_id;
    delete updates.seller_id;
    delete updates.created_at;
    delete updates.used_count;
    delete updates.offer_image; // Use separate endpoint for image updates
    delete updates.offer_image_public_id;

    // No validation needed for simplified offers

    const AppDataSource = getDataSource();
    
    // Verify offer exists and belongs to seller
    const existingOffers = await AppDataSource.query(
      'SELECT offer_id FROM offers WHERE offer_id = $1 AND seller_id = $2',
      [offerId, req.user.userId]
    );

    if (existingOffers.length === 0) {
      return res.status(404).json({ error: 'Offer not found or not authorized' });
    }

    // Build dynamic update query
    const fields = Object.keys(updates);
    if (fields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    const setClause = fields.map((field, index) => `${field} = $${index + 3}`).join(', ');
    const values = [offerId, req.user.userId, ...fields.map(field => updates[field])];

    const updateQuery = `
      UPDATE offers 
      SET ${setClause}, updated_at = NOW() 
      WHERE offer_id = $1 AND seller_id = $2 
      RETURNING *
    `;

    const result = await AppDataSource.query(updateQuery, values);
    const updatedOffer = result[0];

    console.log(`✅ Updated offer: ${offerId} for seller: ${req.user.userId}`);

    res.json({
      success: true,
      message: 'Offer updated successfully',
      offer: updatedOffer
    });

  } catch (error) {
    console.error('🚨 Update offer error:', error);
    res.status(500).json({ error: 'Failed to update offer' });
  }
});

// DELETE /offers/:offerId - Delete offer
router.delete('/:offerId', verifyToken, async (req, res) => {
  try {
    const { offerId } = req.params;

    const AppDataSource = getDataSource();
    
    // Get offer details including image info
    const offers = await AppDataSource.query(
      'SELECT offer_image_public_id FROM offers WHERE offer_id = $1 AND seller_id = $2',
      [offerId, req.user.userId]
    );

    if (offers.length === 0) {
      return res.status(404).json({ error: 'Offer not found or not authorized' });
    }

    // Delete image from Cloudinary if exists
    const publicId = offers[0].offer_image_public_id;
    if (publicId) {
      console.log(`🗑️ Deleting offer image from Cloudinary: ${publicId}`);
      await deleteImage(publicId);
    }

    // Delete offer from database
    await AppDataSource.query(
      'DELETE FROM offers WHERE offer_id = $1 AND seller_id = $2',
      [offerId, req.user.userId]
    );

    console.log(`✅ Deleted offer: ${offerId} for seller: ${req.user.userId}`);

    res.json({
      success: true,
      message: 'Offer deleted successfully'
    });

  } catch (error) {
    console.error('🚨 Delete offer error:', error);
    res.status(500).json({ error: 'Failed to delete offer' });
  }
});

// POST /offers/:offerId/toggle - Toggle offer active status
router.post('/:offerId/toggle', verifyToken, async (req, res) => {
  try {
    const { offerId } = req.params;

    const AppDataSource = getDataSource();
    const result = await AppDataSource.query(`
      UPDATE offers 
      SET is_active = NOT is_active, updated_at = NOW() 
      WHERE offer_id = $1 AND seller_id = $2 
      RETURNING offer_id, is_active
    `, [offerId, req.user.userId]);

    if (result.length === 0) {
      return res.status(404).json({ error: 'Offer not found or not authorized' });
    }

    const updatedOffer = result[0];
    console.log(`🔄 Toggled offer ${offerId} to ${updatedOffer.is_active ? 'active' : 'inactive'}`);

    res.json({
      success: true,
      message: `Offer ${updatedOffer.is_active ? 'activated' : 'deactivated'} successfully`,
      offer: updatedOffer
    });

  } catch (error) {
    console.error('🚨 Toggle offer error:', error);
    res.status(500).json({ error: 'Failed to toggle offer status' });
  }
});

module.exports = router;