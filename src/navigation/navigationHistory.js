/**
 * Navigation History
 *
 * Browser-style back/forward history for wiki page navigation.
 * Tracks page paths in a stack with cursor position.
 */

const MAX_HISTORY = 50;

let history = [];
let cursor = -1;
let isNavigating = false; // True during back/forward to prevent recording
let listeners = [];

/**
 * Push a new page path onto the history stack.
 * Truncates forward history if navigating to new page after going back.
 * @param {string} pagePath - The page path to record
 */
export function pushPage(pagePath) {
  if (isNavigating) return;
  if (!pagePath) return;

  // Don't push duplicates at current position
  if (cursor >= 0 && history[cursor] === pagePath) return;

  // Truncate forward history
  history = history.slice(0, cursor + 1);

  history.push(pagePath);

  // Cap history size
  if (history.length > MAX_HISTORY) {
    history.shift();
  }

  cursor = history.length - 1;
  notifyListeners();
}

/**
 * Go back one page in history.
 * @returns {string|null} The page path to navigate to, or null if can't go back
 */
export function goBack() {
  if (!canGoBack()) return null;
  cursor--;
  notifyListeners();
  return history[cursor];
}

/**
 * Go forward one page in history.
 * @returns {string|null} The page path to navigate to, or null if can't go forward
 */
export function goForward() {
  if (!canGoForward()) return null;
  cursor++;
  notifyListeners();
  return history[cursor];
}

/**
 * @returns {boolean} True if back navigation is possible
 */
export function canGoBack() {
  return cursor > 0;
}

/**
 * @returns {boolean} True if forward navigation is possible
 */
export function canGoForward() {
  return cursor < history.length - 1;
}

/**
 * Set the navigating flag. Call with true before programmatic back/forward,
 * and false after navigation completes, to prevent pushPage from recording.
 * @param {boolean} value
 */
export function setNavigating(value) {
  isNavigating = value;
}

/**
 * Register a listener for history state changes (for UI button updates).
 * @param {Function} listener - Called with { canGoBack, canGoForward }
 */
export function addListener(listener) {
  listeners.push(listener);
}

/**
 * Remove a previously registered listener.
 * @param {Function} listener
 */
export function removeListener(listener) {
  listeners = listeners.filter(l => l !== listener);
}

function notifyListeners() {
  const state = { canGoBack: canGoBack(), canGoForward: canGoForward() };
  for (const listener of listeners) {
    try { listener(state); } catch (e) { console.error('[NavHistory] Listener error:', e); }
  }
}

/**
 * Get current history state for debugging
 */
export function getState() {
  return {
    history: [...history],
    cursor,
    canGoBack: canGoBack(),
    canGoForward: canGoForward()
  };
}
