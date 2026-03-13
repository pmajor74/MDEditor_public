/**
 * Path Validator
 *
 * Security utilities for validating file paths in the file browser.
 * Prevents path traversal attacks and ensures paths are within allowed roots.
 */

const path = require('path');
const fs = require('fs').promises;

// Set of allowed root paths
let allowedRoots = new Set();

/**
 * Add an allowed root path
 * @param {string} rootPath - The root path to allow
 */
function addAllowedRoot(rootPath) {
  const normalized = path.resolve(rootPath);
  allowedRoots.add(normalized);
  console.log('[Path Validator] Added allowed root:', normalized);
}

/**
 * Remove an allowed root path
 * @param {string} rootPath - The root path to remove
 */
function removeAllowedRoot(rootPath) {
  const normalized = path.resolve(rootPath);
  allowedRoots.delete(normalized);
  console.log('[Path Validator] Removed allowed root:', normalized);
}

/**
 * Get all allowed roots
 * @returns {string[]} Array of allowed root paths
 */
function getAllowedRoots() {
  return Array.from(allowedRoots);
}

/**
 * Clear all allowed roots
 */
function clearAllowedRoots() {
  allowedRoots.clear();
  console.log('[Path Validator] Cleared all allowed roots');
}

/**
 * Check if a path is within any allowed root
 * @param {string} targetPath - The path to validate
 * @returns {boolean} True if path is within an allowed root
 */
function isWithinAllowedRoot(targetPath) {
  if (allowedRoots.size === 0) {
    // If no roots configured, nothing is allowed
    return false;
  }

  const normalizedTarget = path.resolve(targetPath);

  for (const root of allowedRoots) {
    // Check if the target path starts with the root path
    // Use path.relative to handle edge cases properly
    const relative = path.relative(root, normalizedTarget);

    // If relative path doesn't start with '..' and isn't absolute, it's within the root
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return true;
    }
  }

  return false;
}

/**
 * Validate a path for file browser operations
 * @param {string} targetPath - The path to validate
 * @returns {Object} Validation result with isValid and error
 */
function validatePath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') {
    return {
      isValid: false,
      error: 'Path is required and must be a string'
    };
  }

  // Resolve to absolute path
  const resolvedPath = path.resolve(targetPath);

  // Check for path traversal attempts
  if (targetPath.includes('..')) {
    // Allow '..' in paths, but verify final resolved path is within allowed roots
    if (!isWithinAllowedRoot(resolvedPath)) {
      return {
        isValid: false,
        error: 'Path traversal detected: path is outside allowed roots'
      };
    }
  }

  // Check if within allowed roots
  if (!isWithinAllowedRoot(resolvedPath)) {
    return {
      isValid: false,
      error: 'Path is outside allowed directories'
    };
  }

  return {
    isValid: true,
    resolvedPath
  };
}

/**
 * Validate path and check it exists
 * @param {string} targetPath - The path to validate
 * @returns {Promise<Object>} Validation result
 */
async function validatePathExists(targetPath) {
  const validation = validatePath(targetPath);
  if (!validation.isValid) {
    return validation;
  }

  try {
    await fs.access(validation.resolvedPath);
    return validation;
  } catch (err) {
    return {
      isValid: false,
      error: `Path does not exist: ${targetPath}`
    };
  }
}

/**
 * Sanitize a filename (for creating new files/folders)
 * @param {string} filename - The filename to sanitize
 * @returns {Object} Sanitization result
 */
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    return {
      isValid: false,
      error: 'Filename is required and must be a string'
    };
  }

  // Trim whitespace
  const trimmed = filename.trim();

  // Check for empty
  if (!trimmed) {
    return {
      isValid: false,
      error: 'Filename cannot be empty'
    };
  }

  // Check for reserved characters (Windows)
  const invalidChars = /[<>:"/\\|?*\x00-\x1F]/;
  if (invalidChars.test(trimmed)) {
    return {
      isValid: false,
      error: 'Filename contains invalid characters'
    };
  }

  // Check for reserved names (Windows)
  const reservedNames = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
  const nameWithoutExt = trimmed.split('.')[0];
  if (reservedNames.test(nameWithoutExt)) {
    return {
      isValid: false,
      error: 'Filename uses a reserved name'
    };
  }

  // Check length
  if (trimmed.length > 255) {
    return {
      isValid: false,
      error: 'Filename is too long (max 255 characters)'
    };
  }

  // Check for hidden file starting with dot
  const isHidden = trimmed.startsWith('.');

  return {
    isValid: true,
    sanitized: trimmed,
    isHidden
  };
}

module.exports = {
  addAllowedRoot,
  removeAllowedRoot,
  getAllowedRoots,
  clearAllowedRoots,
  isWithinAllowedRoot,
  validatePath,
  validatePathExists,
  sanitizeFilename
};
