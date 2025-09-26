const fs = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const crypto = require('crypto');
const config = require('../config');

class ImageService {
  constructor() {
    this.loadedImages = new Map(); // Cache for loaded image metadata
    this.processingQueue = new Set(); // Prevent duplicate processing
  }

  /**
   * Load image metadata and prepare for display
   * @param {string} filePath - Path to the image file
   * @returns {Promise<Object>} Image metadata including dimensions, format, etc.
   */
  async loadImageMetadata(filePath) {
    try {
      // Check if already cached
      if (this.loadedImages.has(filePath)) {
        return this.loadedImages.get(filePath);
      }

      // Get file stats
      const stats = await fs.stat(filePath);
      const fileSize = stats.size;

      // Get image metadata using Sharp
      const metadata = await sharp(filePath).metadata();

      const imageData = {
        path: filePath,
        filename: path.basename(filePath),
        size: fileSize,
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        aspectRatio: metadata.width / metadata.height,
        lastModified: stats.mtime.getTime(),
        id: this.generateImageId(filePath)
      };

      // Cache the metadata
      this.loadedImages.set(filePath, imageData);

      return imageData;
    } catch (error) {
      console.error(`Failed to load image metadata for ${filePath}:`, error);
      throw new Error(`Unable to load image: ${error.message}`);
    }
  }

  /**
   * Generate a unique ID for an image based on its path
   * @param {string} filePath - Path to the image file
   * @returns {string} Unique image ID
   */
  generateImageId(filePath) {
    return crypto.createHash('md5').update(filePath).digest('hex').substring(0, 8);
  }

  /**
   * Process an image for display with smart scaling
   * @param {string} filePath - Path to the image file
   * @param {number} targetWidth - Target display width
   * @param {number} targetHeight - Target display height (optional)
   * @returns {Promise<Buffer>} Processed image buffer
   */
  async processImageForDisplay(filePath, targetWidth, targetHeight = null) {
    try {
      const cacheKey = `${filePath}_${targetWidth}_${targetHeight}`;

      // Prevent duplicate processing
      if (this.processingQueue.has(cacheKey)) {
        // Wait for existing processing to complete
        while (this.processingQueue.has(cacheKey)) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        return this.processImageForDisplay(filePath, targetWidth, targetHeight);
      }

      this.processingQueue.add(cacheKey);

      try {
        let pipeline = sharp(filePath);

        // If targetHeight is not specified, scale to fit width while maintaining aspect ratio
        if (targetHeight === null) {
          pipeline = pipeline.resize(targetWidth, null, {
            withoutEnlargement: true,
            fit: 'inside'
          });
        } else {
          // Scale to fit within both dimensions
          pipeline = pipeline.resize(targetWidth, targetHeight, {
            withoutEnlargement: true,
            fit: 'inside',
            position: 'center'
          });
        }

        // Convert to JPEG for consistent display format (maintain quality)
        const buffer = await pipeline
          .jpeg({ quality: 95, progressive: true })
          .toBuffer();

        return buffer;
      } finally {
        this.processingQueue.delete(cacheKey);
      }
    } catch (error) {
      console.error(`Failed to process image ${filePath}:`, error);
      throw new Error(`Image processing failed: ${error.message}`);
    }
  }

  /**
   * Get raw image data for full-quality display
   * @param {string} filePath - Path to the image file
   * @returns {Promise<Buffer>} Raw image buffer
   */
  async getFullQualityImage(filePath) {
    try {
      return await fs.readFile(filePath);
    } catch (error) {
      console.error(`Failed to read full-quality image ${filePath}:`, error);
      throw new Error(`Unable to load image: ${error.message}`);
    }
  }

  /**
   * Validate if a file is a supported image format
   * @param {string} filePath - Path to check
   * @returns {boolean} True if supported image format
   */
  isSupportedImageFormat(filePath) {
    const supportedFormats = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.tiff', '.tif'];
    const ext = path.extname(filePath).toLowerCase();
    return supportedFormats.includes(ext);
  }

  /**
   * Copy image to the gallery's images directory
   * @param {string} sourcePath - Source image path
   * @param {string} filename - Desired filename
   * @returns {Promise<string>} Path to copied image
   */
  async copyImageToGallery(sourcePath, filename) {
    try {
      // Ensure images directory exists
      await fs.mkdir(config.paths.images, { recursive: true });

      const targetPath = path.join(config.paths.images, filename);

      // Copy the file
      await fs.copyFile(sourcePath, targetPath);

      return targetPath;
    } catch (error) {
      console.error(`Failed to copy image to gallery:`, error);
      throw new Error(`Failed to add image to gallery: ${error.message}`);
    }
  }

  /**
   * Clear the image metadata cache
   */
  clearCache() {
    this.loadedImages.clear();
    this.processingQueue.clear();
  }

  /**
   * Get supported image formats for file dialogs
   * @returns {Array<string>} Array of supported format extensions
   */
  getSupportedFormats() {
    return [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/bmp',
      'image/tiff'
    ];
  }
}

module.exports = new ImageService();
