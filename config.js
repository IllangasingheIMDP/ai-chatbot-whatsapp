import 'dotenv/config';
import fs from 'node:fs';

function fail(message) {
  console.error(message);
  process.exit(1);
}

const masterKeyHex = process.env.MASTER_KEY;
if (!masterKeyHex) {
  fail(
    'Missing MASTER_KEY environment variable.\n' +
      'Copy .env.example to .env and set MASTER_KEY.\n' +
      'Generate one with: npm run genkey  (or: openssl rand -hex 32)'
  );
}
if (!/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
  fail('MASTER_KEY must be a 64-character hex string (32 random bytes).');
}

const dataDir = process.env.DATA_DIR || './data';
fs.mkdirSync(dataDir, { recursive: true });

export const config = {
  masterKey: Buffer.from(masterKeyHex, 'hex'),

  dbPath: process.env.DB_PATH || `${dataDir}/bot.db`,
  authDir: process.env.AUTH_DIR || `${dataDir}/auth`,

  // Reply-chain context (replaces time-based session history)
  // How many prior turns to walk back through the WhatsApp reply chain
  replyChainMaxDepth: Number(process.env.REPLY_CHAIN_MAX_DEPTH || 20),
  // How long to keep cached message turns in memory (must be >= disappearingSeconds).
  // Defaults to the disappearing-messages window so chains expire when messages do.
  messageCacheTtlMs:
    Number(process.env.MESSAGE_CACHE_TTL_MS ||
      Number(process.env.DISAPPEARING_SECONDS || 86400) * 1000),

  // File handling
  maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB || 15),
  maxFilesPerBurst: Number(process.env.MAX_FILES_PER_BURST || 5),
  mediaDebounceMs: Number(process.env.MEDIA_DEBOUNCE_MS || 2000),
  mediaCaptionWaitMs: Number(process.env.MEDIA_CAPTION_WAIT_MS || 120000),

  // Abuse protection
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 10),
  rateLimitPerDay: Number(process.env.RATE_LIMIT_PER_DAY || 200),
  maxConcurrentGeminiCalls: Number(process.env.MAX_CONCURRENT_GEMINI_CALLS || 3),

  // Experimental WhatsApp-native disappearing messages (cosmetic only, see README)
  enableDisappearingMessages: (process.env.ENABLE_DISAPPEARING_MESSAGES || 'false').toLowerCase() === 'true',
  disappearingSeconds: Number(process.env.DISAPPEARING_SECONDS || 86400),

  logLevel: process.env.LOG_LEVEL || 'info',
};
