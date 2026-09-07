import * as userStore from './userStore.js';
import * as sessionManager from './sessionManager.js';
import { listGenerativeModels } from './geminiClient.js';
import { formatModelList } from './textUtils.js';

const HELP_TEXT = `Commands:
/help - show this message
/model - change your Gemini model
/newkey - replace your stored API key
/clear - end the current conversation now
/status - show your current settings
/delete_me - permanently delete all your stored data

Just send a normal message (with or without a photo/file attached) to chat.`;

export async function handleCommand(jid, lookupKey, command, sock) {
  switch (command) {
    case '/help':
      await sock.sendMessage(jid, { text: HELP_TEXT });
      return;

    case '/model': {
      const apiKey = userStore.getDecryptedApiKey(jid);
      if (!apiKey) {
        await sock.sendMessage(jid, { text: "You don't have a key set up yet. Send /newkey to add one." });
        return;
      }
      try {
        await sock.sendMessage(jid, { text: 'Fetching available models from Gemini...' });
        const models = await listGenerativeModels(apiKey);
        if (models.length === 0) {
          await sock.sendMessage(jid, {
            text: 'No models found for your key. Please send /newkey to configure a new key.',
          });
          return;
        }
        userStore.savePendingModelList(jid, models);
        userStore.setStage(jid, 'awaiting_model');
        await sock.sendMessage(jid, { text: `Pick a model by number:\n\n${formatModelList(models)}` });
      } catch (err) {
        await sock.sendMessage(jid, {
          text: `Could not fetch model list: ${err.message}. Send /newkey if you need to update your key.`,
        });
      }
      return;
    }

    case '/newkey':
      userStore.setStage(jid, 'awaiting_key');
      await sock.sendMessage(jid, { text: 'Send your new Gemini API key.' });
      return;

    case '/clear':
      sessionManager.clearSession(lookupKey);
      await sock.sendMessage(jid, { text: 'Conversation cleared. Next message starts fresh.' });
      return;

    case '/status': {
      const user = userStore.getUser(jid);
      const remainingMs = sessionManager.msRemaining(lookupKey);
      const remainingMin = Math.ceil(remainingMs / 60000);
      await sock.sendMessage(jid, {
        text: [
          `Model: ${user?.model || 'not set'}`,
          `Setup: ${user?.stage || 'not started'}`,
          remainingMs > 0
            ? `Active conversation, clears in ~${remainingMin} min if idle.`
            : 'No active conversation right now.',
        ].join('\n'),
      });
      return;
    }

    case '/delete_me':
      userStore.deleteUser(jid);
      sessionManager.clearSession(lookupKey);
      await sock.sendMessage(jid, {
        text: 'All your data has been deleted. Message me again anytime to start over.',
      });
      return;

    default:
      await sock.sendMessage(jid, { text: `Unknown command.\n\n${HELP_TEXT}` });
  }
}
