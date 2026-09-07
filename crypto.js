import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';

/**
 * Derives a non-reversible lookup key from a WhatsApp JID, so raw phone
 * numbers are never written to disk. The same JID always maps to the same
 * key, which is all the database needs for lookups.
 */
export function deriveLookupKey(jid, masterKey) {
  return crypto.createHmac('sha256', masterKey).update(jid).digest('hex');
}

/**
 * Encrypts a secret (e.g. a Gemini API key) with AES-256-GCM using a random
 * IV per call. Returns a single string "iv:authTag:ciphertext" (all hex).
 */
export function encryptSecret(plaintext, masterKey) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, masterKey, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('hex'), authTag.toString('hex'), encrypted.toString('hex')].join(':');
}

export function decryptSecret(payload, masterKey) {
  const [ivHex, authTagHex, dataHex] = payload.split(':');
  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error('Malformed encrypted payload');
  }
  const decipher = crypto.createDecipheriv(ALGO, masterKey, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}
