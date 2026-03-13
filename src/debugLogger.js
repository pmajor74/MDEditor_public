/**
 * Debug Logger
 *
 * File-based debug logger that writes to userData/debug.log.
 * Controlled by config.editor.debugLogMode:
 *   - "session" (default): clears log on startup, each run is a clean session
 *   - "forever": appends to existing log, never auto-deletes
 *   - "off": no file logging
 *
 * Intercepts console.log/warn/error, adds timestamps, deduplicates consecutive
 * identical messages, and still outputs to stdout/stderr.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logStream = null;
let logMode = 'session';
let initialized = false;
let lastMessage = '';
let lastMessageCount = 0;
let lastMessageTime = 0;
const DEDUP_WINDOW_MS = 2000;

const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

/**
 * Read debugLogMode directly from config.json (sync, before configService loads)
 */
function readModeFromConfig() {
  try {
    const basePath = app.isPackaged
      ? path.dirname(app.getPath('exe'))
      : path.resolve('.');
    const configPath = path.join(basePath, 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    return config?.editor?.debugLogMode || 'session';
  } catch {
    return 'session';
  }
}

/**
 * Format a log line with timestamp and level
 */
function formatLine(level, args) {
  const now = new Date();
  const ts = now.toTimeString().slice(0, 8) + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const msg = args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  return `[${ts}] [${level}] ${msg}`;
}

/**
 * Write a line to the log file with deduplication
 */
function writeToFile(line) {
  if (!logStream || logMode === 'off') return;
  const now = Date.now();

  if (line === lastMessage && (now - lastMessageTime) < DEDUP_WINDOW_MS) {
    lastMessageCount++;
    lastMessageTime = now;
    return;
  }

  // Flush any dedup count before writing the new message
  if (lastMessageCount > 0) {
    const repeat = `  ... repeated ${lastMessageCount} more time${lastMessageCount > 1 ? 's' : ''}\n`;
    logStream.write(repeat);
  }

  lastMessage = line;
  lastMessageCount = 0;
  lastMessageTime = now;

  logStream.write(line + '\n');
}

/**
 * Create a safe console wrapper that also logs to file
 */
function makeSafeLogger(original, level) {
  return (...args) => {
    // Always output to stdout/stderr (safe from EPIPE)
    try { original.apply(console, args); } catch {}
    // Write to file
    writeToFile(formatLine(level, args));
  };
}

/**
 * Initialize the debug logger. Call this early in main.js.
 */
function init() {
  if (initialized) return;
  initialized = true;

  logMode = readModeFromConfig();
  const logFilePath = path.join(app.getPath('userData'), 'debug.log');

  if (logMode !== 'off') {
    // 'w' flag truncates for session mode, 'a' flag appends for forever mode
    const flags = logMode === 'session' ? 'w' : 'a';
    logStream = fs.createWriteStream(logFilePath, { flags });
    logStream.on('error', () => {}); // Prevent crashes on write errors
  }

  // Install interceptors
  console.log = makeSafeLogger(originalConsoleLog, 'LOG');
  console.warn = makeSafeLogger(originalConsoleWarn, 'WARN');
  console.error = makeSafeLogger(originalConsoleError, 'ERROR');

  if (logMode !== 'off') {
    console.log('[DebugLogger] Initialized — mode:', logMode, '— file:', logFilePath);
  }
}

/**
 * Update log mode at runtime (called when config changes)
 */
function setMode(mode) {
  if (['session', 'forever', 'off'].includes(mode)) {
    logMode = mode;
  }
}

module.exports = { init, setMode, originalConsoleLog, originalConsoleError, originalConsoleWarn };
