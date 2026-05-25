/**
 * Session Manager
 *
 * Idle-timeout watchdog. Starts a 30-minute timer on module load.
 * Every chat send calls extendSession() to reset the timer. When the
 * timer elapses, it dispatches a `session:timeout` CustomEvent that
 * AppContent listens for — the app then logs the user out and surfaces
 * a non-blocking toast.
 *
 * Event contract: `window.addEventListener('session:timeout', ...)`
 */

const SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours

export class SessionManager {
  private static instance: SessionManager;
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  private constructor() {
    this.resetTimer();
  }

  static getInstance(): SessionManager {
    if (!SessionManager.instance) {
      SessionManager.instance = new SessionManager();
    }
    return SessionManager.instance;
  }

  /**
   * Extend (reset) the idle timer. Call on any user activity that
   * should count as "still here" — e.g., sending a chat message.
   */
  extendSession(): void {
    this.resetTimer();
  }

  private resetTimer(): void {
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
    }
    this.timeoutId = setTimeout(() => {
      this.timeoutId = null;
      window.dispatchEvent(new CustomEvent('session:timeout'));
    }, SESSION_TIMEOUT_MS);
  }
}

export default SessionManager.getInstance();
