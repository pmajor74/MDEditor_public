/**
 * Screen Reader Announcer Utility
 *
 * Provides functions to make announcements via aria-live regions
 * for screen reader users.
 */

/**
 * Announce a message to screen readers (polite mode)
 * Use for non-urgent status updates
 * @param {string} message - The message to announce
 */
export function announce(message) {
  const announcer = document.getElementById('sr-announcer');
  if (announcer) {
    // Clear first to ensure repeated messages are announced
    announcer.textContent = '';
    // Use setTimeout to ensure the clear is processed
    setTimeout(() => {
      announcer.textContent = message;
    }, 50);
  }
}

/**
 * Announce a message urgently to screen readers (assertive mode)
 * Use sparingly - only for critical alerts that require immediate attention
 * @param {string} message - The message to announce
 */
export function announceAssertive(message) {
  const announcer = document.getElementById('sr-announcer-assertive');
  if (announcer) {
    // Clear first to ensure repeated messages are announced
    announcer.textContent = '';
    // Use setTimeout to ensure the clear is processed
    setTimeout(() => {
      announcer.textContent = message;
    }, 50);
  }
}

/**
 * Clear all announcer regions
 */
export function clearAnnouncements() {
  const polite = document.getElementById('sr-announcer');
  const assertive = document.getElementById('sr-announcer-assertive');
  if (polite) polite.textContent = '';
  if (assertive) assertive.textContent = '';
}
