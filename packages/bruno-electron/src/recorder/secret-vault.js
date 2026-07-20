const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const FORMAT = 'bruno-run-secrets';
const VERSION = 1;
const PBKDF2_ITERATIONS = 210000;
const MAX_SECRET_BUNDLE_BYTES = 2 * 1024 * 1024;
const MAX_SECRET_JSON_BYTES = 4 * 1024 * 1024;
const MAX_SECRET_RECORDS = 10000;
const MAX_LOCAL_VAULT_BYTES = 2 * 1024 * 1024;
const MAX_SECRET_VALUE_CHARS = 64 * 1024;

const ensureDir = (directory) => fs.mkdirSync(directory, { recursive: true });

const encryptSecretBundle = (records, passphrase) => {
  if (typeof passphrase !== 'string' || passphrase.length < 8) {
    throw new Error('Secret export passphrase must be at least 8 characters');
  }

  if (!Array.isArray(records) || records.length > MAX_SECRET_RECORDS) {
    throw new Error('Secret bundle has too many records');
  }
  const json = Buffer.from(JSON.stringify({
    format: FORMAT,
    version: VERSION,
    records
  }), 'utf8');
  if (json.length > MAX_SECRET_JSON_BYTES) {
    throw new Error('Secret bundle exceeds 4 MB limit');
  }
  const plaintext = zlib.gzipSync(json);
  if (plaintext.length > MAX_SECRET_BUNDLE_BYTES) {
    throw new Error('Encrypted secret bundle exceeds 2 MB limit');
  }

  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 32, 'sha256');
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return Buffer.from(JSON.stringify({
    format: FORMAT,
    version: VERSION,
    kdf: {
      name: 'pbkdf2-sha256',
      iterations: PBKDF2_ITERATIONS,
      salt: salt.toString('base64')
    },
    cipher: {
      name: 'aes-256-gcm',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64')
    },
    data: ciphertext.toString('base64')
  }), 'utf8');
};

const decryptSecretBundle = (buffer, passphrase) => {
  if (typeof passphrase !== 'string' || !passphrase) throw new Error('Secret import passphrase is required');
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_SECRET_JSON_BYTES) {
    throw new Error('Encrypted secret bundle exceeds size limit');
  }
  let envelope;
  try {
    envelope = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error('Encrypted secret bundle is malformed');
  }
  if (envelope.format !== FORMAT || envelope.version !== VERSION) {
    throw new Error('Unsupported encrypted secret bundle');
  }
  if (
    envelope.kdf?.name !== 'pbkdf2-sha256'
    || Number(envelope.kdf?.iterations) !== PBKDF2_ITERATIONS
    || envelope.cipher?.name !== 'aes-256-gcm'
  ) {
    throw new Error('Unsupported encrypted secret parameters');
  }

  try {
    const salt = Buffer.from(envelope.kdf.salt || '', 'base64');
    const iv = Buffer.from(envelope.cipher.iv || '', 'base64');
    const tag = Buffer.from(envelope.cipher.tag || '', 'base64');
    const encryptedData = Buffer.from(envelope.data || '', 'base64');
    if (salt.length !== 16 || iv.length !== 12 || tag.length !== 16 || encryptedData.length > MAX_SECRET_BUNDLE_BYTES) {
      throw new Error('Invalid encrypted secret envelope');
    }
    const key = crypto.pbkdf2Sync(passphrase, salt, PBKDF2_ITERATIONS, 32, 'sha256');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const compressed = Buffer.concat([decipher.update(encryptedData), decipher.final()]);
    if (compressed.length > MAX_SECRET_BUNDLE_BYTES) throw new Error('Encrypted secret payload exceeds size limit');
    const payload = JSON.parse(zlib.gunzipSync(compressed, { maxOutputLength: MAX_SECRET_JSON_BYTES }).toString('utf8'));
    if (
      payload.format !== FORMAT
      || payload.version !== VERSION
      || !Array.isArray(payload.records)
      || payload.records.length > MAX_SECRET_RECORDS
    ) {
      throw new Error('Invalid secret payload');
    }
    return payload.records;
  } catch {
    throw new Error('Unable to decrypt run secrets. Check the passphrase.');
  }
};

class LocalSecretVault {
  constructor(baseDirectory, safeStorage) {
    this.baseDirectory = baseDirectory;
    this.safeStorage = safeStorage;
    ensureDir(baseDirectory);
  }

  isAvailable() {
    return Boolean(this.safeStorage?.isEncryptionAvailable?.());
  }

  filePath(sessionId) {
    return path.join(this.baseDirectory, `${sessionId}.jsonl`);
  }

  clear(sessionId) {
    fs.rmSync(this.filePath(sessionId), { force: true });
  }

  append(sessionId, eventId, entries, requestId = null) {
    if (!this.isAvailable() || !eventId || !Array.isArray(entries) || !entries.length) return false;
    const filePath = this.filePath(sessionId);
    if (fs.existsSync(filePath) && fs.statSync(filePath).size >= MAX_LOCAL_VAULT_BYTES) return false;
    const boundedEntries = entries.slice(0, 100).map((entry) => ({
      path: String(entry.path || '').slice(0, 1024),
      value: String(entry.value ?? '').slice(0, MAX_SECRET_VALUE_CHARS)
    }));
    const encrypted = this.safeStorage.encryptString(JSON.stringify({ eventId, requestId, entries: boundedEntries })).toString('base64');
    const line = `${encrypted}\n`;
    if ((fs.existsSync(filePath) ? fs.statSync(filePath).size : 0) + Buffer.byteLength(line) > MAX_LOCAL_VAULT_BYTES) return false;
    fs.appendFileSync(filePath, line, { mode: 0o600 });
    return true;
  }

  read(sessionId) {
    if (!this.isAvailable() || !fs.existsSync(this.filePath(sessionId))) return [];
    return fs.readFileSync(this.filePath(sessionId), 'utf8').split('\n').filter(Boolean).map((line) => (
      JSON.parse(this.safeStorage.decryptString(Buffer.from(line, 'base64')))
    ));
  }

  importRecords(sessionId, records) {
    if (!this.isAvailable()) throw new Error('OS secret storage is unavailable on this system');
    this.clear(sessionId);
    for (const record of records || []) this.append(sessionId, record.eventId, record.entries, record.requestId || null);
    return this.read(sessionId).length;
  }

  entriesForSource(sessionId, { eventId = null, eventIds = [], requestId = null } = {}) {
    const acceptedEventIds = new Set([eventId, ...(eventIds || [])].filter(Boolean));
    return this.read(sessionId)
      .filter((record) => acceptedEventIds.has(record.eventId) || (requestId && record.requestId === requestId))
      .flatMap((record) => record.entries || [])
      .filter((entry, index, all) => all.findIndex((candidate) => candidate.path === entry.path && candidate.value === entry.value) === index);
  }
}

module.exports = {
  FORMAT,
  VERSION,
  PBKDF2_ITERATIONS,
  encryptSecretBundle,
  decryptSecretBundle,
  LocalSecretVault
};
