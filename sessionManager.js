/**
 * Minimal session stub retained for command compatibility (/clear, /status).
 *
 * Conversation history is no longer stored here. Context is derived entirely
 * from the WhatsApp reply chain via replyCache.js — each message is a fresh
 * start unless the user explicitly replies to a prior message.
 */

export function clearSession(_lookupKey) {
  // No-op: history is not stored in memory between messages.
}

export function msRemaining(_lookupKey) {
  // No persistent session — always 0.
  return 0;
}
