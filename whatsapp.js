import makeWASocket, { useMultiFileAuthState, DisconnectReason, downloadMediaMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcodeTerminal from 'qrcode-terminal';
import { config } from './config.js';
import { routeMessage } from './router.js';
import { keyFor } from './userStore.js';

const logger = pino({ level: config.logLevel });

// Tracks which chats we've already tried to set disappearing messages for in
// this process run, so we don't resend the request on every single message.
const disappearingSetFor = new Set();

function unwrapMessage(message) {
  return (
    message?.ephemeralMessage?.message ||
    message?.viewOnceMessage?.message ||
    message?.viewOnceMessageV2?.message ||
    message?.documentWithCaptionMessage?.message ||
    message
  );
}

function extractIncoming(waMessage) {
  const message = unwrapMessage(waMessage.message);
  if (!message) return null;

  if (message.conversation) {
    return { type: 'text', text: message.conversation };
  }
  if (message.extendedTextMessage?.text) {
    return { type: 'text', text: message.extendedTextMessage.text };
  }

  const mediaContents = [message.imageMessage, message.videoMessage, message.audioMessage, message.documentMessage];
  for (const content of mediaContents) {
    if (content) {
      const fileLength = Number(content.fileLength || 0);
      const maxBytes = config.maxFileSizeMb * 1024 * 1024;
      return {
        type: 'media',
        mimetype: content.mimetype || 'application/octet-stream',
        caption: content.caption || '',
        tooLarge: fileLength > 0 && fileLength > maxBytes,
      };
    }
  }
  return null;
}

export async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);

  const sock = makeWASocket({
    auth: state,
    logger,
    browser: ['Gemini Bot', 'Chrome', '1.0.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;
    if (qr) {
      console.log('\nScan this QR code with the WhatsApp account you want to use for the bot:\n');
      qrcodeTerminal.generate(qr, { small: true });
    }
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = statusCode === DisconnectReason.loggedOut;
      logger.warn({ statusCode }, 'Connection closed');
      if (loggedOut) {
        console.error(
          `\nLogged out by WhatsApp. Delete the "${config.authDir}" folder and restart the bot to re-pair.\n`
        );
      } else {
        setTimeout(() => {
          startBot().catch((err) => logger.error(err, 'Reconnect attempt failed'));
        }, 3000);
      }
    } else if (connection === 'open') {
      logger.info('Connected to WhatsApp');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const waMessage of messages) {
      try {
        if (!waMessage.message || waMessage.key.fromMe) continue;

        const jid = waMessage.key.remoteJid;
        // Only handle 1:1 chats: skip group chats, newsletters, and status updates, since
        // each user's config/session is tied to a single JID.
        if (!jid || jid === 'status@broadcast' || jid.endsWith('@g.us') || jid.endsWith('@newsletter')) continue;

        const incoming = extractIncoming(waMessage);
        if (!incoming) continue;

        if (incoming.type === 'media' && !incoming.tooLarge) {
          try {
            incoming.buffer = await downloadMediaMessage(waMessage, 'buffer', {}, {
              logger,
              reuploadRequest: sock.updateMediaMessage,
            });
          } catch (dlErr) {
            logger.error({ err: dlErr }, 'Failed to download media message');
            await sock.sendMessage(jid, {
              text: 'Could not download the attachment (it may have expired). Please try resending it.',
            });
            continue;
          }
        }

        if (config.enableDisappearingMessages && !disappearingSetFor.has(jid)) {
          disappearingSetFor.add(jid);
          sock
            .sendMessage(jid, { disappearingMessagesInChat: config.disappearingSeconds })
            .catch((err) => logger.debug({ err }, 'Could not set disappearing messages (non-fatal, best-effort)'));
        }

        const lookupKey = keyFor(jid);
        await routeMessage(jid, lookupKey, sock, incoming);
      } catch (err) {
        logger.error(err, 'Failed to handle an incoming message');
      }
    }
  });

  return sock;
}
