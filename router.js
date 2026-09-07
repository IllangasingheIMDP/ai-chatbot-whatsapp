import PQueue from 'p-queue';
import * as userStore from './userStore.js';
import * as mediaAggregator from './mediaAggregator.js';
import { handleOnboarding } from './onboarding.js';
import { handleCommand } from './commands.js';
import { generateReply, GeminiError } from './geminiClient.js';
import { chunkText, markdownToWhatsApp } from './textUtils.js';
import { checkAndConsume } from './rateLimiter.js';
import { config } from './config.js';
import * as replyCache from './replyCache.js';

// Caps how many Gemini calls run at once across all users, so a burst of
// traffic can't overwhelm the free-tier box.
const geminiQueue = new PQueue({ concurrency: config.maxConcurrentGeminiCalls });

/**
 * Send text in WhatsApp-friendly chunks with a small random delay between
 * them (reduces bot-detection likelihood). Returns the WhatsApp message ID
 * of the last chunk sent, which is stored in the reply cache so future
 * replies from the user can reconstruct the conversation chain.
 */
async function sendChunked(sock, jid, text) {
  const chunks = chunkText(text);
  let lastSent = null;
  for (let i = 0; i < chunks.length; i++) {
    lastSent = await sock.sendMessage(jid, { text: chunks[i] });
    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
    }
  }
  return lastSent?.key?.id || null;
}

/**
 * Execute one Gemini chat turn.
 *
 * History is derived entirely from the WhatsApp reply chain: if `incoming`
 * has a quotedStanzaId, replyCache.buildHistory walks backwards through
 * cached turns to reconstruct the conversation the user threaded together.
 * Every message without a reply starts with a completely empty context.
 *
 * @param {string}      jid
 * @param {string}      lookupKey
 * @param {object}      sock       - Baileys socket
 * @param {Array}       files      - Downloaded media objects { mimetype, buffer }
 * @param {string}      text       - Text content (may be empty when files present)
 * @param {object|null} incoming   - Full incoming descriptor from whatsapp.js,
 *                                   used to read stanzaId / quotedStanzaId.
 */
async function runChatTurn(jid, lookupKey, sock, files, text, incoming) {
  const apiKey = userStore.getDecryptedApiKey(jid);
  const user = userStore.getUser(jid);
  if (!apiKey || !user?.model) {
    await sock.sendMessage(jid, { text: "Your setup looks incomplete. Send /newkey to fix it." });
    return;
  }

  // Build the content parts for this user turn
  const parts = [];
  for (const file of files) {
    const cleanMime = (file.mimetype || 'application/octet-stream').split(';')[0].trim();
    parts.push({ inlineData: { mimeType: cleanMime, data: file.buffer.toString('base64') } });
  }
  const trimmedText = (text || '').trim();
  if (trimmedText) {
    parts.push({ text: trimmedText });
  } else if (files.length > 0) {
    parts.push({ text: 'Please describe or analyze the attached file(s).' });
  }
  if (parts.length === 0) return;

  // Reconstruct conversation history from the WhatsApp reply chain.
  // If the user didn't reply to anything this is an empty array → fresh context.
  const history = replyCache.buildHistory(incoming?.quotedStanzaId ?? null);

  await geminiQueue.add(async () => {
    await sock.sendPresenceUpdate('composing', jid).catch(() => {});
    try {
      const rawReply = await generateReply({
        apiKey,
        model: user.model,
        history,
        newParts: parts,
      });
      const reply = markdownToWhatsApp(rawReply);

      // Cache the user's incoming turn BEFORE sending the reply so that if
      // the user replies to the bot's response, both sides of the exchange
      // are available in the chain.
      if (incoming?.stanzaId) {
        replyCache.storeIncoming(incoming.stanzaId, parts, incoming.quotedStanzaId ?? null);
      }

      // Send the reply and cache the bot's turn, parented to the user's message.
      const sentMsgId = await sendChunked(sock, jid, reply);
      if (sentMsgId) {
        replyCache.storeOutgoing(sentMsgId, [{ text: reply }], incoming?.stanzaId ?? null);
      }
    } catch (err) {
      if (err instanceof GeminiError && [400, 401, 403].includes(err.status)) {
        await sock.sendMessage(jid, { text: 'Gemini rejected your API key. Send /newkey to update it.' });
      } else if (err instanceof GeminiError && err.status === 429) {
        await sock.sendMessage(jid, { text: "You've hit your Gemini quota/rate limit. Try again shortly." });
      } else if (err instanceof GeminiError && err.message.includes('SAFETY')) {
        await sock.sendMessage(jid, { text: 'The response was blocked by Gemini safety filters.' });
      } else {
        console.error('Gemini call failed:', err);
        await sock.sendMessage(jid, { text: 'Something went wrong talking to Gemini. Please try again.' });
      }
    }
  });
}

export async function routeMessage(jid, lookupKey, sock, incoming) {
  const rl = checkAndConsume(lookupKey);
  if (!rl.allowed) {
    await sock.sendMessage(jid, {
      text:
        rl.reason === 'minute'
          ? "You're sending messages too fast — please slow down a little."
          : "You've hit today's message limit for this bot. Try again tomorrow.",
    });
    return;
  }

  if (!userStore.isSetupComplete(jid)) {
    await handleOnboarding(jid, incoming.type === 'text' ? incoming.text : '', sock);
    return;
  }

  if (incoming.type === 'text' && incoming.text?.trim().startsWith('/')) {
    const command = incoming.text.trim().split(/\s+/)[0].toLowerCase();
    await handleCommand(jid, lookupKey, command, sock);
    return;
  }

  // For media bursts, reply-chain context is not propagated (the burst itself
  // is the context). For plain text messages, `incoming` carries stanzaId and
  // quotedStanzaId so the chain is reconstructed correctly.
  const flushHandlers = {
    onFlush: (j, files, flushText) => runChatTurn(j, lookupKey, sock, files, flushText, null),
  };

  if (incoming.type === 'media') {
    if (incoming.tooLarge) {
      await sock.sendMessage(jid, {
        text: `That file is larger than my ${config.maxFileSizeMb}MB limit — I skipped it.`,
      });
      return;
    }
    mediaAggregator.addMedia(
      jid,
      { mimetype: incoming.mimetype, buffer: incoming.buffer, caption: incoming.caption },
      {
        onPromptForCaption: (j, count) =>
          sock.sendMessage(j, {
            text: `Got ${count} file(s). What would you like me to do with them? (I'll wait a couple of minutes.)`,
          }),
        onFlush: flushHandlers.onFlush,
        onDrop: (j, count) =>
          sock.sendMessage(j, {
            text: `I dropped the ${count} file(s) you sent earlier since I didn't hear back — feel free to resend.`,
          }),
        onLimitReached: (j, max) =>
          sock.sendMessage(j, { text: `I can only take ${max} files at a time — send the rest separately.` }),
      }
    );
    return;
  }

  // Plain text: if files are already buffered for this sender, this text is
  // the question that completes them; otherwise it's a normal chat turn.
  if (mediaAggregator.hasPendingMedia(jid)) {
    mediaAggregator.addTextAndFlush(jid, incoming.text, flushHandlers);
    return;
  }

  await runChatTurn(jid, lookupKey, sock, [], incoming.text, incoming);
}
