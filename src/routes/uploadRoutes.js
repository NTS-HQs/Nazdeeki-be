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

// Configure multer for memory storage (we'll upload directly to Cloudinary)
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check if file is an image
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

// POST /upload/restaurant-image
router.post('/restaurant-image', verifyToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    console.log(`📸 Uploading restaurant image for seller: ${req.user.userId}`);
    console.log(`📁 File size: ${req.file.size} bytes`);
    console.log(`🎨 File type: ${req.file.mimetype}`);

    // Convert buffer to base64 for Cloudinary upload
    const base64Image = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

    // Upload to Cloudinary with seller-specific options
    const uploadResult = await uploadImage(base64Image, {
      public_id: `restaurant_${req.user.userId}_${Date.now()}`, // Unique filename
      folder: 'nazdeeki/restaurants',
      transformation: [
        { width: 1200, height: 800, crop: 'limit' }, // Restaurant images can be larger
        { quality: 'auto' },
        { fetch_format: 'auto' }
      ]
    });

    if (!uploadResult.success) {
      return res.status(500).json({ error: 'Failed to upload image', details: uploadResult.error });
    }

    // Update seller's restaurant_image in database
    const AppDataSource = getDataSource();
    await AppDataSource.query(
      'UPDATE sellers SET restaurant_image = $1, updated_at = NOW() WHERE seller_id = $2',
      [uploadResult.url, req.user.userId]
    );

    console.log(`✅ Image uploaded successfully for seller: ${req.user.userId}`);
    console.log(`🔗 Image URL: ${uploadResult.url}`);

    res.json({
      success: true,
      message: 'Restaurant image uploaded successfully',
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
    console.error('🚨 Restaurant image upload error:', error);
    res.status(500).json({ error: 'Failed to upload restaurant image' });
  }
});

// POST /upload/restaurant-image-base64 (Alternative method for base64 uploads)
router.post('/restaurant-image-base64', verifyToken, async (req, res) => {
  try {
    const { imageData } = req.body;

    if (!imageData) {
      return res.status(400).json({ error: 'No image data provided' });
    }

    // Validate base64 format
    if (!imageData.startsWith('data:image/')) {
      return res.status(400).json({ error: 'Invalid image format. Must be base64 encoded image.' });
    }

    console.log(`📸 Uploading base64 restaurant image for seller: ${req.user.userId}`);

    // Upload to Cloudinary
    const uploadResult = await uploadImage(imageData, {
      public_id: `restaurant_${req.user.userId}_${Date.now()}`,
      folder: 'nazdeeki/restaurants',
      transformation: [
        { width: 1200, height: 800, crop: 'limit' },
        { quality: 'auto' },
        { fetch_format: 'auto' }
      ]
    });

    if (!uploadResult.success) {
      return res.status(500).json({ error: 'Failed to upload image', details: uploadResult.error });
    }

    // Update seller's restaurant_image in database
    const AppDataSource = getDataSource();
    await AppDataSource.query(
      'UPDATE sellers SET restaurant_image = $1, updated_at = NOW() WHERE seller_id = $2',
      [uploadResult.url, req.user.userId]
    );

    console.log(`✅ Base64 image uploaded successfully for seller: ${req.user.userId}`);

    res.json({
      success: true,
      message: 'Restaurant image uploaded successfully',
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
    console.error('🚨 Base64 restaurant image upload error:', error);
    res.status(500).json({ error: 'Failed to upload restaurant image' });
  }
});

// DELETE /upload/restaurant-image (Delete current restaurant image)
router.delete('/restaurant-image', verifyToken, async (req, res) => {
  try {
    const AppDataSource = getDataSource();
    
    // Get current image URL
    const sellers = await AppDataSource.query(
      'SELECT restaurant_image FROM sellers WHERE seller_id = $1',
      [req.user.userId]
    );

    if (sellers.length === 0) {
      return res.status(404).json({ error: 'Seller not found' });
    }

    const currentImageUrl = sellers[0].restaurant_image;
    
    if (!currentImageUrl) {
      return res.status(400).json({ error: 'No restaurant image to delete' });
    }

    // Extract public_id from Cloudinary URL
    const publicIdMatch = currentImageUrl.match(/\/v\d+\/(.+)\./);
    if (publicIdMatch) {
      const publicId = publicIdMatch[1];
      
      // Delete from Cloudinary
      const deleteResult = await deleteImage(publicId);
      console.log(`🗑️ Cloudinary deletion result:`, deleteResult);
    }

    // Remove from database
    await AppDataSource.query(
      'UPDATE sellers SET restaurant_image = NULL, updated_at = NOW() WHERE seller_id = $1',
      [req.user.userId]
    );

    console.log(`✅ Restaurant image deleted for seller: ${req.user.userId}`);

    res.json({
      success: true,
      message: 'Restaurant image deleted successfully'
    });

  } catch (error) {
    console.error('🚨 Restaurant image deletion error:', error);
    res.status(500).json({ error: 'Failed to delete restaurant image' });
  }
});

module.exports = router; 