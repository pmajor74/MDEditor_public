/**
 * Index Task Persistence
 * Manages crash recovery state for indexing tasks
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

// In-memory task cache
let tasks = {};
let persistPath = null;

// Task status constants
const TASK_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled'
};

/**
 * Initialize persistence with storage path
 * @param {string} storagePath - Path to store task data
 */
async function initialize(storagePath) {
  persistPath = path.join(storagePath, 'indexing-tasks.json');

  try {
    const data = await fs.readFile(persistPath, 'utf-8');
    tasks = JSON.parse(data);
    console.log(`[Task Persistence] Loaded ${Object.keys(tasks).length} tasks`);

    // Clean up old completed tasks (older than 24 hours)
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    let cleaned = 0;

    for (const taskId of Object.keys(tasks)) {
      const task = tasks[taskId];
      if (task.status === TASK_STATUS.COMPLETED || task.status === TASK_STATUS.CANCELLED) {
        if (now - (task.completedAt || task.updatedAt || 0) > dayMs) {
          delete tasks[taskId];
          cleaned++;
        }
      }
    }

    if (cleaned > 0) {
      console.log(`[Task Persistence] Cleaned up ${cleaned} old tasks`);
      await save();
    }

  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[Task Persistence] Error loading tasks:', error.message);
    }
    tasks = {};
  }
}

/**
 * Save tasks to disk
 */
async function save() {
  if (!persistPath) return;

  try {
    await fs.writeFile(persistPath, JSON.stringify(tasks, null, 2));
  } catch (error) {
    console.error('[Task Persistence] Error saving tasks:', error.message);
  }
}

/**
 * Generate unique task ID
 */
function generateTaskId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Create a new indexing task
 * @param {Object} options - Task options
 * @returns {string} Task ID
 */
async function createTask(options) {
  const taskId = generateTaskId();
  const now = Date.now();

  tasks[taskId] = {
    taskId,
    status: TASK_STATUS.PENDING,
    catalogName: options.catalogName,
    qualityLevel: options.qualityLevel || 'low',
    totalFiles: options.totalFiles || 0,
    processedFiles: 0,
    files: {},  // filePath -> { status, tokens, timeMs }
    config: {
      rootPaths: options.rootPaths || [],
      extensions: options.extensions || [],
      includeSubfolders: options.includeSubfolders !== false
    },
    tokenUsage: {
      estimated: options.estimatedTokens || 0,
      actual: 0
    },
    createdAt: now,
    updatedAt: now
  };

  await save();
  console.log(`[Task Persistence] Created task ${taskId}`);

  return taskId;
}

/**
 * Update task status
 * @param {string} taskId - Task ID
 * @param {string} status - New status
 */
async function updateStatus(taskId, status) {
  const task = tasks[taskId];
  if (!task) return;

  task.status = status;
  task.updatedAt = Date.now();

  if (status === TASK_STATUS.COMPLETED || status === TASK_STATUS.CANCELLED) {
    task.completedAt = Date.now();
  }

  await save();
}

/**
 * Update file status within a task
 * @param {string} taskId - Task ID
 * @param {string} filePath - File path
 * @param {Object} fileStatus - File status info
 */
async function updateFileStatus(taskId, filePath, fileStatus) {
  const task = tasks[taskId];
  if (!task) return;

  task.files[filePath] = {
    status: fileStatus.status,
    tokens: fileStatus.tokens || 0,
    timeMs: fileStatus.timeMs || 0,
    updatedAt: Date.now()
  };

  // Update processed count
  const completedStatuses = ['completed', 'skipped', 'error'];
  task.processedFiles = Object.values(task.files)
    .filter(f => completedStatuses.includes(f.status))
    .length;

  task.updatedAt = Date.now();

  // Save periodically (every 10 files) to balance performance and recovery
  if (task.processedFiles % 10 === 0) {
    await save();
  }
}

/**
 * Update token usage
 * @param {string} taskId - Task ID
 * @param {number} inputTokens - Input tokens used
 * @param {number} outputTokens - Output tokens used
 */
async function updateTokenUsage(taskId, inputTokens, outputTokens) {
  const task = tasks[taskId];
  if (!task) return;

  task.tokenUsage.actual += inputTokens + outputTokens;
  task.updatedAt = Date.now();

  // Don't save on every token update - will save on file status
}

/**
 * Get task by ID
 * @param {string} taskId - Task ID
 * @returns {Object|null} Task data
 */
function getTask(taskId) {
  return tasks[taskId] || null;
}

/**
 * Get all incomplete tasks
 * @returns {Array} Array of incomplete tasks
 */
function getIncompleteTasks() {
  return Object.values(tasks).filter(task =>
    task.status === TASK_STATUS.IN_PROGRESS ||
    task.status === TASK_STATUS.PAUSED ||
    task.status === TASK_STATUS.PENDING
  );
}

/**
 * Get tasks for a specific catalog
 * @param {string} catalogName - Catalog name
 * @returns {Array} Array of tasks
 */
function getTasksForCatalog(catalogName) {
  return Object.values(tasks).filter(task => task.catalogName === catalogName);
}

/**
 * Delete a task
 * @param {string} taskId - Task ID
 */
async function deleteTask(taskId) {
  if (tasks[taskId]) {
    delete tasks[taskId];
    await save();
    console.log(`[Task Persistence] Deleted task ${taskId}`);
  }
}

/**
 * Mark task as started (in progress)
 * @param {string} taskId - Task ID
 * @param {number} totalFiles - Total files to process
 */
async function markStarted(taskId, totalFiles) {
  const task = tasks[taskId];
  if (!task) return;

  task.status = TASK_STATUS.IN_PROGRESS;
  task.totalFiles = totalFiles;
  task.startedAt = Date.now();
  task.updatedAt = Date.now();

  await save();
}

/**
 * Mark task as paused
 * @param {string} taskId - Task ID
 */
async function markPaused(taskId) {
  await updateStatus(taskId, TASK_STATUS.PAUSED);
}

/**
 * Mark task as completed
 * @param {string} taskId - Task ID
 * @param {Object} summary - Completion summary
 */
async function markCompleted(taskId, summary = {}) {
  const task = tasks[taskId];
  if (!task) return;

  task.status = TASK_STATUS.COMPLETED;
  task.summary = summary;
  task.completedAt = Date.now();
  task.updatedAt = Date.now();

  await save();
}

/**
 * Mark task as failed
 * @param {string} taskId - Task ID
 * @param {string} error - Error message
 */
async function markFailed(taskId, error) {
  const task = tasks[taskId];
  if (!task) return;

  task.status = TASK_STATUS.FAILED;
  task.error = error;
  task.updatedAt = Date.now();

  await save();
}

/**
 * Get the last processed file path for resumption
 * @param {string} taskId - Task ID
 * @returns {string|null} Last completed file path
 */
function getResumePoint(taskId) {
  const task = tasks[taskId];
  if (!task) return null;

  // Find files that are not yet completed
  const pendingFiles = Object.entries(task.files)
    .filter(([_, status]) => status.status === 'pending' || !status.status)
    .map(([path]) => path);

  if (pendingFiles.length > 0) {
    return pendingFiles[0];
  }

  return null;
}

/**
 * Set files for a task (when scanning is complete)
 * @param {string} taskId - Task ID
 * @param {Array} filePaths - Array of file paths
 */
async function setTaskFiles(taskId, filePaths) {
  const task = tasks[taskId];
  if (!task) return;

  // Initialize all files as pending
  for (const filePath of filePaths) {
    if (!task.files[filePath]) {
      task.files[filePath] = { status: 'pending' };
    }
  }

  task.totalFiles = filePaths.length;
  task.updatedAt = Date.now();

  await save();
}

/**
 * Force save (useful before app exit)
 */
async function forceSave() {
  await save();
}

module.exports = {
  initialize,
  createTask,
  updateStatus,
  updateFileStatus,
  updateTokenUsage,
  getTask,
  getIncompleteTasks,
  getTasksForCatalog,
  deleteTask,
  markStarted,
  markPaused,
  markCompleted,
  markFailed,
  getResumePoint,
  setTaskFiles,
  forceSave,
  TASK_STATUS
};
