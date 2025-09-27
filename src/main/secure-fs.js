const fs = require('fs').promises;
const fsNative = require('fs');
const path = require('path');

// Helper function to check if a path is inside another path
// (replacement for is-path-inside library which is ESM-only)
function isPathInside(childPath, parentPath) {
  const relation = path.relative(parentPath, childPath);
  return Boolean(
    relation &&
    relation !== '..' &&
    !relation.startsWith('..') &&
    !path.isAbsolute(relation)
  );
}

// Secure file operations wrapper
// Automatically validates all paths before fs operations to prevent:
// - Path traversal attacks (../)
// - Symlink escapes
// - Directory traversal outside allowed paths
// - Null byte injection

// Allowed directories for file operations
const allowedDirectories = new Set();

// Initialize with app directories
function initializeAllowedPaths(app) {
  const userDataDir = app.getPath('userData');
  const imagesDir = path.join(userDataDir, 'images');
  const tempDir = app.getPath('temp');

  // Canonicalize and add to allowed paths
  [userDataDir, tempDir, imagesDir].forEach(dir => {
    try {
      const canonical = fsNative.realpathSync(dir);
      allowedDirectories.add(canonical);
    } catch (error) {
      console.warn(`[WARN] Could not canonicalize allowed directory ${dir}:`, error.message);
    }
  });
}

// Add user-selected directories to allowed list
function addAllowedDirectory(dirPath) {
  try {
    const canonical = fsNative.realpathSync(dirPath);
    allowedDirectories.add(canonical);
    console.log(`[SECURITY] Added allowed directory: ${canonical}`);
  } catch (error) {
    console.warn(`[WARN] Could not add allowed directory ${dirPath}:`, error.message);
  }
}

// Validate and canonicalize a file path
function validateFilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') {
    throw new Error('Invalid file path: must be a non-empty string');
  }

  // Strip null bytes (security)
  const sanitized = filePath.replace(/\0/g, '');

  // Normalize path (handle relative components)
  const normalized = process.platform === 'win32'
    ? path.win32.normalize(sanitized)
    : path.normalize(sanitized);

  // Resolve to absolute path
  const absolute = path.resolve(normalized);

  // Canonicalize to resolve symlinks (security)
  let canonical;
  try {
    canonical = fsNative.realpathSync(absolute);
  } catch (error) {
    throw new Error(`Path resolution failed: ${error.message}`);
  }

  // Check if path is within allowed directories
  const isAllowed = Array.from(allowedDirectories).some(allowedDir => {
    return isPathInside(canonical, allowedDir) || canonical === allowedDir;
  });

  if (!isAllowed) {
    throw new Error(`Access denied: path outside allowed directories`);
  }

  return canonical;
}

// Secure file operations - automatically validate paths
const secureFs = {
  // Read file with automatic path validation
  async readFile(filePath, options) {
    const validatedPath = validateFilePath(filePath);
    return fs.readFile(validatedPath, options);
  },

  // Get file stats with automatic path validation
  async stat(filePath) {
    const validatedPath = validateFilePath(filePath);
    return fs.stat(validatedPath);
  },

  // Write file with automatic path validation
  async writeFile(filePath, data, options) {
    const validatedPath = validateFilePath(filePath);
    return fs.writeFile(validatedPath, data, options);
  },

  // Append file with automatic path validation
  async appendFile(filePath, data, options) {
    const validatedPath = validateFilePath(filePath);
    return fs.appendFile(validatedPath, data, options);
  },

  // Access check with automatic path validation
  async access(filePath, mode) {
    const validatedPath = validateFilePath(filePath);
    return fs.access(validatedPath, mode);
  },

  // Utility functions
  addAllowedDirectory,
  initializeAllowedPaths,
  validateFilePath,

  // Direct access to allowed directories for reference
  getAllowedDirectories: () => Array.from(allowedDirectories)
};

module.exports = secureFs;
