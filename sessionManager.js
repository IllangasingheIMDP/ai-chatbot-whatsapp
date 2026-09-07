import { config } from './config.js';

// Conversation history lives ONLY in memory, keyed by the hashed lookup key.
// It is never written to disk, and it disappears automatically after
// config.sessionTimeoutMs of inactivity, or immediately on /clear.
const sessions = new Map();

function newSession() {
  return { history: [], lastActiveAt: Date.now(), timer: null };
}

function scheduleExpiry(lookupKey) {
  const session = sessions.get(lookupKey);
  if (!session) return;
  if (session.timer) clearTimeout(session.timer);
  session.timer = setTimeout(() => {
    sessions.delete(lookupKey);
  }, config.sessionTimeoutMs);
  session.timer.unref?.();
}

export function getSession(lookupKey) {
  return sessions.get(lookupKey) || null;
}

/** Returns { session, isNew } and resets the inactivity timer. */
export function touchSession(lookupKey) {
  let session = sessions.get(lookupKey);
  const isNew = !session;
  if (!session) {
    session = newSession();
    sessions.set(lookupKey, session);
  }
  session.lastActiveAt = Date.now();
  scheduleExpiry(lookupKey);
  return { session, isNew };
}

export function appendTurn(lookupKey, role, parts) {
  const { session } = touchSession(lookupKey);
  session.history.push({ role, parts });
  const maxEntries = config.maxHistoryTurns * 2; // one user + one model entry per turn
  if (session.history.length > maxEntries) {
    session.history.splice(0, session.history.length - maxEntries);
  }
}

export function clearSession(lookupKey) {
  const session = sessions.get(lookupKey);
  if (session?.timer) clearTimeout(session.timer);
  sessions.delete(lookupKey);
}

export function msRemaining(lookupKey) {
  const session = sessions.get(lookupKey);
  if (!session) return 0;
  const elapsed = Date.now() - session.lastActiveAt;
  return Math.max(0, config.sessionTimeoutMs - elapsed);
}
