const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes, createHash } = require('node:crypto');
const { encryptString, decryptStringSafe } = require('../utils/encryption');

const atomicPrivateWrite = async (pathname, content) => {
  await fs.mkdir(path.dirname(pathname), { recursive: true, mode: 0o700 });
  await fs.chmod(path.dirname(pathname), 0o700).catch(() => null);
  const temporary = `${pathname}.${process.pid}.${Date.now()}.tmp`;
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, pathname);
    await fs.chmod(pathname, 0o600).catch(() => null);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => null);
  }
};

class McpTokenStore {
  constructor({ directory, encrypt = encryptString, decryptSafe = decryptStringSafe, now = () => new Date(), random = randomBytes } = {}) {
    this.directory = path.resolve(directory || path.join(process.cwd(), '.bruno-mcp'));
    this.pathname = path.join(this.directory, 'auth-token.json');
    this.encrypt = encrypt;
    this.decryptSafe = decryptSafe;
    this.now = now;
    this.random = random;
    this.cached = null;
  }

  generateToken() {
    return this.random(32).toString('base64url');
  }

  fingerprint(token) {
    return createHash('sha256').update(String(token || '')).digest('hex').slice(0, 16);
  }

  async readRecord() {
    if (this.cached) return this.cached;
    try {
      const record = JSON.parse(await fs.readFile(this.pathname, 'utf8'));
      const decrypted = this.decryptSafe(record.encryptedToken);
      if (!decrypted.success || !decrypted.value) throw new Error('Stored MCP token cannot be decrypted');
      this.cached = { token: decrypted.value, createdAt: record.createdAt, rotatedAt: record.rotatedAt || null };
      return this.cached;
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async ensure() {
    const existing = await this.readRecord();
    if (existing) return existing;
    return this.rotate({ initial: true });
  }

  async rotate({ initial = false } = {}) {
    const token = this.generateToken();
    const timestamp = this.now().toISOString();
    const previous = await this.readRecord().catch(() => null);
    const record = {
      version: 1,
      createdAt: previous?.createdAt || timestamp,
      rotatedAt: initial ? null : timestamp,
      encryptedToken: this.encrypt(token)
    };
    if (!record.encryptedToken) throw new Error('Unable to encrypt Bruno MCP token');
    await atomicPrivateWrite(this.pathname, `${JSON.stringify(record, null, 2)}\n`);
    this.cached = { token, createdAt: record.createdAt, rotatedAt: record.rotatedAt };
    return this.cached;
  }

  async metadata() {
    const record = await this.ensure();
    return {
      createdAt: record.createdAt,
      rotatedAt: record.rotatedAt,
      fingerprint: this.fingerprint(record.token)
    };
  }

  clearCache() {
    this.cached = null;
  }
}

module.exports = { McpTokenStore, atomicPrivateWrite };
