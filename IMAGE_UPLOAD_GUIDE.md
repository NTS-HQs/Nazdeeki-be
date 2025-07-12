# Restaurant Image Upload Guide

This guide explains how to implement restaurant image upload functionality using Cloudinary in your Nazdeeki application.

## Overview

We've implemented a robust image upload system that:
- ✅ Uploads images to Cloudinary (cloud storage)
- ✅ Automatically optimizes images (size, format, quality)
- ✅ Stores image URLs in your PostgreSQL database
- ✅ Supports both file upload and base64 upload methods
- ✅ Includes image deletion functionality

## Setup Instructions

### 1. Cloudinary Account Setup

1. **Sign up for Cloudinary**: Go to [https://cloudinary.com](https://cloudinary.com) and create a free account
2. **Get your credentials**: After signup, go to your Dashboard and copy:
   - Cloud name
   - API Key  
   - API Secret

### 2. Environment Variables

Add these to your `.env` file:

```env
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
```

### 3. Database Migration

Run the `database_fix_simple.sql` script to ensure proper foreign key relationships.

## API Endpoints

### 1. Upload Restaurant Image (File Upload)

**Endpoint**: `POST /upload/restaurant-image`

**Headers**:
```
Authorization: Bearer your-jwt-token
Content-Type: multipart/form-data
```

**Body**: Form data with `image` field containing the image file

**Example using JavaScript/Fetch**:
```javascript
const formData = new FormData();
formData.append('image', imageFile);

const response = await fetch('/upload/restaurant-image', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`
  },
  body: formData
});

const result = await response.json();
console.log('Upload result:', result);
```

### 2. Upload Restaurant Image (Base64)

**Endpoint**: `POST /upload/restaurant-image-base64`

**Headers**:
```
Authorization: Bearer your-jwt-token
Content-Type: application/json
```

**Body**:
```json
{
  "imageData": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ..."
}
```

**Example using JavaScript/Fetch**:
```javascript
const response = await fetch('/upload/restaurant-image-base64', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    imageData: base64String
  })
});
```

### 3. Delete Restaurant Image

**Endpoint**: `DELETE /upload/restaurant-image`

**Headers**:
```
Authorization: Bearer your-jwt-token
```

## Frontend Implementation Examples

### React File Upload Component

```jsx
import React, { useState } from 'react';

const RestaurantImageUpload = ({ accessToken, onUploadSuccess }) => {
  const [uploading, setUploading] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    if (file) {
      // Create preview
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target.result);
      reader.readAsDataURL(file);
    }
  };

  const handleUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch('/upload/restaurant-image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        },
        body: formData
      });

      const result = await response.json();
      
      if (result.success) {
        onUploadSuccess(result.image.url);
        alert('Image uploaded successfully!');
      } else {
        alert('Upload failed: ' + result.error);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="image-upload">
      <input
        type="file"
        accept="image/*"
        onChange={handleUpload}
        disabled={uploading}
      />
      {uploading && <p>Uploading...</p>}
      {imagePreview && (
        <img 
          src={imagePreview} 
          alt="Preview" 
          style={{ maxWidth: '200px', maxHeight: '200px' }}
        />
      )}
    </div>
  );
};
```

### Base64 Upload (for camera captures)

```javascript
const uploadCameraImage = async (canvas, accessToken) => {
  // Convert canvas to base64
  const base64Data = canvas.toDataURL('image/jpeg', 0.8);
  
  try {
    const response = await fetch('/upload/restaurant-image-base64', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        imageData: base64Data
      })
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Upload error:', error);
    throw error;
  }
};
```

## Image Optimization Features

Cloudinary automatically applies these optimizations:

1. **Size Limiting**: Max 1200x800px for restaurant images
2. **Quality Optimization**: Automatic quality adjustment
3. **Format Optimization**: Serves WebP when supported, falls back to original format
4. **Compression**: Reduces file size while maintaining visual quality

## File Restrictions

- **Max file size**: 5MB
- **Allowed formats**: All image formats (JPEG, PNG, WebP, GIF, etc.)
- **File validation**: Server-side validation ensures only images are accepted

## Error Handling

The API returns detailed error messages:

```json
{
  "success": false,
  "error": "File too large. Maximum size is 5MB"
}
```

Common errors:
- `No image file provided`
- `Only image files are allowed!`
- `File too large. Maximum size is 5MB`
- `Failed to upload image`
- `Missing Bearer token`

## Database Schema

The restaurant image URL is stored in the `sellers` table:

```sql
-- The restaurant_image field stores the Cloudinary URL
UPDATE sellers 
SET restaurant_image = 'https://res.cloudinary.com/your-cloud/image/upload/v1234567890/nazdeeki/restaurants/restaurant_SELLER_123_1234567890.jpg'
WHERE seller_id = 'SELLER_123';
```

## Alternative Storage Options

While we recommend Cloudinary for its ease of use, here are other options:

### 1. AWS S3 + CloudFront
- More cost-effective at scale
- Requires more setup
- Full control over infrastructure

### 2. Firebase Storage
- Easy integration with Google services
- Good for small to medium applications

### 3. Local Storage + CDN
- Full control
- Requires infrastructure management

## Cloudinary vs Other Options

| Feature | Cloudinary | AWS S3+CloudFront | Firebase | Local Storage |
|---------|------------|-------------------|----------|---------------|
| **Ease of Setup** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐ |
| **Auto Optimization** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐ |
| **Cost (Small Scale)** | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Cost (Large Scale)** | ⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| **Image Transformations** | ⭐⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐ | ⭐ |
| **Global CDN** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐ |

## Testing

Test the upload functionality:

1. Start your server: `npm run dev`
2. Use a tool like Postman or create a simple HTML form
3. Upload an image and verify it appears in your Cloudinary dashboard
4. Check that the URL is saved in your database

## Security Considerations

- ✅ File type validation (images only)
- ✅ File size limits (5MB)
- ✅ JWT authentication required
- ✅ Unique filenames prevent conflicts
- ✅ Organized folder structure in Cloudinary

## Support

If you encounter issues:
1. Check your Cloudinary credentials
2. Verify environment variables are loaded
3. Check server logs for detailed error messages
4. Ensure your JWT token is valid

---

**Recommendation**: Start with Cloudinary for development and early production. You can always migrate to AWS S3 + CloudFront later if cost becomes a concern at scale. 