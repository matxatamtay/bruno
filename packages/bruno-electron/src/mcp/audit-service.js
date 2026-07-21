const fs = require('node:fs/promises');
const path = require('node:path');
const { redactMcpValue } = require('./redaction');

class McpAuditService {
  constructor({ directory, now = () => new Date(), enabled = true } = {}) {
    this.directory = path.resolve(directory || path.join(process.cwd(), '.bruno-mcp'));
    this.pathname = path.join(this.directory, 'audit.jsonl');
    this.now = now;
    this.enabled = enabled !== false;
    this.writeQueue = Promise.resolve();
  }

  async append(event = {}) {
    if (!this.enabled) return;
    const safeEvent = redactMcpValue({
      timestamp: this.now().toISOString(),
      ...event
    });
    this.writeQueue = this.writeQueue.then(async () => {
      await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
      await fs.chmod(this.directory, 0o700).catch(() => null);
      await fs.appendFile(this.pathname, `${JSON.stringify(safeEvent)}\n`, { encoding: 'utf8', mode: 0o600 });
      await fs.chmod(this.pathname, 0o600).catch(() => null);
    });
    return this.writeQueue;
  }

  async list({ limit = 100 } = {}) {
    const bounded = Math.max(1, Math.min(1000, Number(limit) || 100));
    let content;
    try {
      content = await fs.readFile(this.pathname, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
    return content.trim().split(/\r?\n/).filter(Boolean).slice(-bounded).map((line) => {
      try { return JSON.parse(line); } catch { return { timestamp: null, event: 'invalid-audit-entry' }; }
    });
  }
}

module.exports = { McpAuditService };
