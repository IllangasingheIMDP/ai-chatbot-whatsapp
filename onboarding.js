import * as userStore from './userStore.js';
import { validateApiKey } from './geminiClient.js';
import { formatModelList } from './textUtils.js';

const WELCOME = `Hi! I'm a personal Gemini assistant bot.

To get started I need your own Gemini API key (create one free at https://aistudio.google.com/apikey). It's encrypted before it's stored and is only ever used to call Gemini on your behalf.

Send it now, or reply /cancel to stop.

Tip: once I confirm it's saved, you can delete your message containing the key yourself — WhatsApp only lets an account delete messages it sent, so I can't remove it for you.`;

export async function handleOnboarding(jid, text, sock) {
  const user = userStore.ensureUserRecord(jid);
  const trimmed = (text || '').trim();

  if (trimmed === '/cancel') {
    userStore.deleteUser(jid);
    await sock.sendMessage(jid, { text: 'Setup cancelled. Message me anytime to start again.' });
    return;
  }

  if (user.stage === 'awaiting_key') {
    if (!trimmed) {
      await sock.sendMessage(jid, { text: WELCOME });
      return;
    }
    await sock.sendMessage(jid, { text: 'Checking your key with Gemini...' });
    const { valid, models, error } = await validateApiKey(trimmed);
    if (!valid || models.length === 0) {
      await sock.sendMessage(jid, {
        text: `That key didn't work${error ? ` (${error})` : ''}. Double-check it and send it again, or /cancel to stop.`,
      });
      return;
    }
    userStore.saveApiKey(jid, trimmed);
    userStore.savePendingModelList(jid, models);
    await sock.sendMessage(jid, {
      text: `Key saved. Now pick a model by replying with its number:\n\n${formatModelList(models)}`,
    });
    return;
  }

  if (user.stage === 'awaiting_model') {
    const models = userStore.getPendingModelList(jid);
    if (models.length === 0) {
      // Shouldn't normally happen, but recover gracefully.
      userStore.setStage(jid, 'awaiting_key');
      await sock.sendMessage(jid, { text: 'Something reset — please send your Gemini API key again.' });
      return;
    }
    const choice = Number.parseInt(trimmed, 10);
    if (!Number.isInteger(choice) || choice < 1 || choice > models.length) {
      await sock.sendMessage(jid, {
        text: `Please reply with a number between 1 and ${models.length}:\n\n${formatModelList(models)}`,
      });
      return;
    }
    const picked = models[choice - 1];
    userStore.saveModel(jid, picked.name);
    await sock.sendMessage(jid, {
      text: `All set! I'll use ${picked.displayName} for you.\n\nJust send a message, or a file/image with a question, and I'll reply. Send /help anytime to see commands.`,
    });
    return;
  }
}
