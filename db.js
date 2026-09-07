import Database from 'better-sqlite3';
import { config } from './config.js';

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');

// Note: lookup_key is an HMAC of the WhatsApp JID, never the raw phone
// number (see crypto.js). enc_api_key is AES-256-GCM ciphertext, never
// plaintext.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    lookup_key TEXT PRIMARY KEY,
    enc_api_key TEXT,
    model TEXT,
    stage TEXT NOT NULL DEFAULT 'awaiting_key',
    pending_model_list TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);
