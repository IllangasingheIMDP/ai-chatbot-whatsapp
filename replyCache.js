import { config } from './config.js';

/**
 * Caches user and bot message turns so that reply-chain history can be
 * reconstructed on demand. Each entry is keyed by the WhatsApp message ID
 * (stanzaId) and holds:
 *   - role:     'user' | 'model'
 *   - parts:    Gemini content parts array
 *   - parentId: stanzaId of the message this one was replying to (if any)
 *
 * Entries expire automatically after config.messageCacheTtlMs, matching the
 * disappearing-messages window so the chain dies at the same time the user
 * can no longer reply to it in WhatsApp.
 */
const cache = new Map();

function set(stanzaId, entry) {
  // Clear any existing timer so re-storing a stanzaId resets the clock
  const existing = cache.get(stanzaId);
  if (existing?.timerId) clearTimeout(existing.timerId);

  const timerId = setTimeout(() => cache.delete(stanzaId), config.messageCacheTtlMs);
  timerId.unref?.();
  cache.set(stanzaId, { ...entry, timerId });
}

/**
 * Store an outgoing bot message in the cache.
 * @param {string}      stanzaId - WhatsApp message ID of the outgoing message.
 * @param {Array}       parts    - Gemini content parts that were sent.
 * @param {string|null} parentId - stanzaId this bot message was replying to.
 */
export function storeOutgoing(stanzaId, parts, parentId = null) {
  if (!stanzaId) return;
  set(stanzaId, { role: 'model', parts, parentId });
}

/**
 * Store an incoming user message in the cache.
 * @param {string}      stanzaId - WhatsApp message ID of the incoming message.
 * @param {Array}       parts    - Gemini content parts representing the user's turn.
 * @param {string|null} parentId - stanzaId this user message was replying to.
 */
export function storeIncoming(stanzaId, parts, parentId = null) {
  if (!stanzaId) return;
  set(stanzaId, { role: 'user', parts, parentId });
}

/**
 * Walk the reply chain starting from parentId and return a history array
 * in chronological order (oldest first) ready to pass to generateReply.
 *
 * @param {string|null} parentId - The stanzaId of the message being replied to.
 * @returns {{ role: string, parts: Array }[]}
 */
export function buildHistory(parentId) {
  if (!parentId) return [];
  const chain = [];
  let id = parentId;
  let depth = 0;
  while (id && depth < config.replyChainMaxDepth) {
    const entry = cache.get(id);
    if (!entry) break;
    chain.push({ role: entry.role, parts: entry.parts });
    id = entry.parentId;
    depth++;
  }
  // chain is newest-first; reverse for chronological order
  chain.reverse();
  return chain;
}

/** How many entries are currently cached (useful for /status diagnostics). */
export function cacheSize() {
  return cache.size;
}
