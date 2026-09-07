import PQueue from 'p-queue';
import * as userStore from './userStore.js';
import * as sessionManager from './sessionManager.js';
import * as mediaAggregator from './mediaAggregator.js';
import { handleOnboarding } from './onboarding.js';
import { handleCommand } from './commands.js';
import { generateReply, GeminiError } from './geminiClient.js';
import { chunkText } from './textUtils.js';
import { checkAndConsume } from './rateLimiter.js';
import { config } from './config.js';

// Caps how many Gemini calls run at once across all users, so a burst of
// traffic can't overwhelm the free-tier box.
const geminiQueue = new PQueue({ concurrency: config.maxConcurrentGeminiCalls });

async function sendChunked(sock, jid, text) {
  const chunks = chunkText(text);
  for (let i = 0; i < chunks.length; i++) {
    await sock.sendMessage(jid, { text: chunks[i] });
    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
    }
  }
}

async function runChatTurn(jid, lookupKey, sock, files, text) {
  const apiKey = userStore.getDecryptedApiKey(jid);
  const user = userStore.getUser(jid);
  if (!apiKey || !user?.model) {
    await sock.sendMessage(jid, { text: "Your setup looks incomplete. Send /newkey to fix it." });
    return;
  }

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

  const { session } = sessionManager.touchSession(lookupKey);

  await geminiQueue.add(async () => {
    await sock.sendPresenceUpdate('composing', jid).catch(() => {});
    try {
      const reply = await generateReply({
        apiKey,
        model: user.model,
        history: session.history,
        newParts: parts,
      });
      sessionManager.appendTurn(lookupKey, 'user', parts);
      sessionManager.appendTurn(lookupKey, 'model', [{ text: reply }]);
      await sendChunked(sock, jid, reply);
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

  const flushHandlers = {
    onFlush: (j, files, flushText) => runChatTurn(j, lookupKey, sock, files, flushText),
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

  await runChatTurn(jid, lookupKey, sock, [], incoming.text);
}
