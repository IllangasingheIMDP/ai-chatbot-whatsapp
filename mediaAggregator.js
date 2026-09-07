import { config } from './config.js';

// WhatsApp delivers each attachment as its own message, even when a user
// picks several photos at once from their gallery. This aggregator waits a
// short window for more files to arrive, then either flushes immediately
// (once a text message/caption shows up) or prompts the user for
// instructions and gives them a couple of minutes to reply before dropping
// the buffered files.
const buffers = new Map();

function clearBuffer(jid) {
  const buf = buffers.get(jid);
  if (buf) {
    if (buf.debounceTimer) clearTimeout(buf.debounceTimer);
    if (buf.captionTimer) clearTimeout(buf.captionTimer);
  }
  buffers.delete(jid);
}

/**
 * handlers:
 *   onPromptForCaption(jid, fileCount)
 *   onFlush(jid, files, text)
 *   onDrop(jid, fileCount)
 *   onLimitReached(jid, maxFiles)
 */
export function addMedia(jid, file, handlers) {
  let buf = buffers.get(jid);
  if (!buf) {
    buf = { files: [], caption: null, debounceTimer: null, captionTimer: null };
    buffers.set(jid, buf);
  }

  if (buf.files.length >= config.maxFilesPerBurst) {
    handlers.onLimitReached?.(jid, config.maxFilesPerBurst);
    return;
  }

  buf.files.push(file);
  if (file.caption && !buf.caption) {
    buf.caption = file.caption;
  }

  if (buf.debounceTimer) clearTimeout(buf.debounceTimer);
  if (buf.captionTimer) clearTimeout(buf.captionTimer);

  buf.debounceTimer = setTimeout(() => {
    const current = buffers.get(jid);
    if (!current) return;

    if (current.caption) {
      const files = current.files;
      const caption = current.caption;
      clearBuffer(jid);
      handlers.onFlush(jid, files, caption);
      return;
    }

    handlers.onPromptForCaption(jid, current.files.length);
    current.captionTimer = setTimeout(() => {
      const stillThere = buffers.get(jid);
      if (!stillThere) return;
      const count = stillThere.files.length;
      clearBuffer(jid);
      handlers.onDrop(jid, count);
    }, config.mediaCaptionWaitMs);
  }, config.mediaDebounceMs);
}

/** Attaches an incoming text/caption to whatever is buffered and flushes right away. */
export function addTextAndFlush(jid, text, handlers) {
  const buf = buffers.get(jid);
  if (!buf || buf.files.length === 0) {
    handlers.onFlush(jid, [], text);
    return;
  }
  const files = buf.files;
  clearBuffer(jid);
  handlers.onFlush(jid, files, text);
}

export function hasPendingMedia(jid) {
  const buf = buffers.get(jid);
  return !!buf && buf.files.length > 0;
}
