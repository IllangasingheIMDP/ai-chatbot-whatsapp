import * as userStore from './userStore.js';
import { listGenerativeModels } from './geminiClient.js';
import { formatModelList } from './textUtils.js';

const HELP_TEXT = `Commands:
/help - show this message
/model - change your Gemini model
/newkey - replace your stored API key
/clear - about conversation history
/status - show your current settings
/delete_me - permanently delete all your stored data

To continue a conversation: reply to one of my messages.
Every new message (not a reply) starts a fresh context.`;

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
      await sock.sendMessage(jid, {
        text: 'There is no persistent conversation history to clear.\n\nEvery message you send starts fresh. To continue a previous conversation, reply to one of my earlier messages.',
      });
      return;

    case '/status': {
      const user = userStore.getUser(jid);
      await sock.sendMessage(jid, {
        text: [
          `Model: ${user?.model || 'not set'}`,
          `Setup: ${user?.stage || 'not started'}`,
          'Context: reply-chain only (no persistent history).',
        ].join('\n'),
      });
      return;
    }

    case '/delete_me':
      userStore.deleteUser(jid);
      await sock.sendMessage(jid, {
        text: 'All your data has been deleted. Message me again anytime to start over.',
      });
      return;

    default:
      await sock.sendMessage(jid, { text: `Unknown command.\n\n${HELP_TEXT}` });
  }
}
