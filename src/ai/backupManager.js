/**
 * Backup Manager for AI-assisted edits
 *
 * Creates automatic backups before AI modifications to allow easy restoration.
 * Backups are stored in the Electron userData directory.
 */

const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');

// Maximum number of backups to keep
const MAX_BACKUPS = 10;

/**
 * Get the backup directory path
 */
function getBackupDir() {
  return path.join(app.getPath('userData'), 'ai-backups');
}

/**
 * Ensure backup directory exists
 */
async function ensureBackupDir() {
  const backupDir = getBackupDir();
  try {
    await fs.mkdir(backupDir, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }
  return backupDir;
}

/**
 * Create a backup of article content
 * @param {string} content - The article content to backup
 * @param {string} pagePath - The wiki page path (used for naming)
 * @returns {string} The backup filename
 */
async function createBackup(content, pagePath = 'untitled') {
  const backupDir = await ensureBackupDir();

  // Create safe filename from page path (handle null/undefined)
  const pathStr = pagePath || 'untitled';
  const safePath = pathStr
    .replace(/^\/+/, '')  // Remove leading slashes
    .replace(/[/\\:*?"<>|]/g, '_')  // Replace invalid chars
    .substring(0, 50) || 'untitled';  // Limit length

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${safePath}_${timestamp}.md`;
  const filePath = path.join(backupDir, filename);

  await fs.writeFile(filePath, content, 'utf8');
  console.log('[Backup] Created backup:', filename);

  // Prune old backups
  await pruneOldBackups(backupDir);

  return filename;
}

/**
 * Remove old backups, keeping only the most recent MAX_BACKUPS
 */
async function pruneOldBackups(backupDir) {
  try {
    const files = await fs.readdir(backupDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    if (mdFiles.length <= MAX_BACKUPS) {
      return;
    }

    // Get file stats and sort by modification time
    const fileStats = await Promise.all(
      mdFiles.map(async (file) => {
        const filePath = path.join(backupDir, file);
        const stats = await fs.stat(filePath);
        return { file, mtime: stats.mtime };
      })
    );

    fileStats.sort((a, b) => b.mtime - a.mtime);  // Newest first

    // Delete old backups
    const toDelete = fileStats.slice(MAX_BACKUPS);
    for (const { file } of toDelete) {
      const filePath = path.join(backupDir, file);
      await fs.unlink(filePath);
      console.log('[Backup] Pruned old backup:', file);
    }
  } catch (error) {
    console.error('[Backup] Error pruning backups:', error);
  }
}

/**
 * Get the most recent backup for a page
 * @param {string} pagePath - The wiki page path to find backups for
 * @returns {string|null} The backup content or null if not found
 */
async function getLatestBackup(pagePath = '') {
  const backupDir = getBackupDir();

  try {
    const files = await fs.readdir(backupDir);

    // Create safe path prefix for matching (handle null/undefined)
    const pathStr = pagePath || '';
    const safePath = pathStr
      .replace(/^\/+/, '')
      .replace(/[/\\:*?"<>|]/g, '_')
      .substring(0, 50);

    // Filter files that match the page path prefix (or get all if no path specified)
    let matchingFiles = files.filter(f => f.endsWith('.md'));
    if (safePath) {
      matchingFiles = matchingFiles.filter(f => f.startsWith(safePath));
    }

    if (matchingFiles.length === 0) {
      return null;
    }

    // Get file stats and find most recent
    const fileStats = await Promise.all(
      matchingFiles.map(async (file) => {
        const filePath = path.join(backupDir, file);
        const stats = await fs.stat(filePath);
        return { file, filePath, mtime: stats.mtime };
      })
    );

    fileStats.sort((a, b) => b.mtime - a.mtime);
    const mostRecent = fileStats[0];

    // Read and return content
    const content = await fs.readFile(mostRecent.filePath, 'utf8');
    console.log('[Backup] Restored from:', mostRecent.file);
    return content;
  } catch (error) {
    console.error('[Backup] Error getting latest backup:', error);
    return null;
  }
}

/**
 * List all backups
 * @returns {Array} List of backup info objects
 */
async function listBackups() {
  const backupDir = getBackupDir();

  try {
    const files = await fs.readdir(backupDir);
    const mdFiles = files.filter(f => f.endsWith('.md'));

    const backups = await Promise.all(
      mdFiles.map(async (file) => {
        const filePath = path.join(backupDir, file);
        const stats = await fs.stat(filePath);
        return {
          filename: file,
          created: stats.mtime,
          size: stats.size
        };
      })
    );

    backups.sort((a, b) => b.created - a.created);
    return backups;
  } catch (error) {
    console.error('[Backup] Error listing backups:', error);
    return [];
  }
}

module.exports = {
  createBackup,
  getLatestBackup,
  listBackups
};
