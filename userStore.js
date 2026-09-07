import { db } from './db.js';
import { deriveLookupKey, encryptSecret, decryptSecret } from './crypto.js';
import { config } from './config.js';

const getStmt = db.prepare('SELECT * FROM users WHERE lookup_key = ?');
const insertStmt = db.prepare(`
  INSERT INTO users (lookup_key, stage, created_at, updated_at)
  VALUES (?, ?, ?, ?)
`);
const setApiKeyStmt = db.prepare(`
  UPDATE users SET enc_api_key = ?, stage = ?, updated_at = ? WHERE lookup_key = ?
`);
const setModelStmt = db.prepare(`
  UPDATE users SET model = ?, stage = ?, pending_model_list = NULL, updated_at = ? WHERE lookup_key = ?
`);
const setPendingModelsStmt = db.prepare(`
  UPDATE users SET pending_model_list = ?, updated_at = ? WHERE lookup_key = ?
`);
const setStageStmt = db.prepare('UPDATE users SET stage = ?, updated_at = ? WHERE lookup_key = ?');
const deleteStmt = db.prepare('DELETE FROM users WHERE lookup_key = ?');

export function keyFor(jid) {
  return deriveLookupKey(jid, config.masterKey);
}

export function getUser(jid) {
  return getStmt.get(keyFor(jid));
}

/** Creates a bare record (stage=awaiting_key) if one doesn't exist yet. */
export function ensureUserRecord(jid) {
  const lk = keyFor(jid);
  let user = getStmt.get(lk);
  if (!user) {
    const now = Date.now();
    insertStmt.run(lk, 'awaiting_key', now, now);
    user = getStmt.get(lk);
  }
  return user;
}

export function saveApiKey(jid, apiKey) {
  const lk = keyFor(jid);
  const enc = encryptSecret(apiKey, config.masterKey);
  setApiKeyStmt.run(enc, 'awaiting_model', Date.now(), lk);
}

export function getDecryptedApiKey(jid) {
  const user = getUser(jid);
  if (!user || !user.enc_api_key) return null;
  return decryptSecret(user.enc_api_key, config.masterKey);
}

export function savePendingModelList(jid, models) {
  setPendingModelsStmt.run(JSON.stringify(models), Date.now(), keyFor(jid));
}

export function getPendingModelList(jid) {
  const user = getUser(jid);
  if (!user?.pending_model_list) return [];
  try {
    return JSON.parse(user.pending_model_list);
  } catch {
    return [];
  }
}

export function saveModel(jid, model) {
  setModelStmt.run(model, 'complete', Date.now(), keyFor(jid));
}

export function setStage(jid, stage) {
  ensureUserRecord(jid);
  setStageStmt.run(stage, Date.now(), keyFor(jid));
}

export function deleteUser(jid) {
  deleteStmt.run(keyFor(jid));
}

export function isSetupComplete(jid) {
  const user = getUser(jid);
  return !!user && user.stage === 'complete' && !!user.enc_api_key && !!user.model;
}
