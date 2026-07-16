const fs = require('fs');
const path = require('path');
const { buildCollectionIdentity } = require('../identity');
const { atomicWriteJson } = require('./contract-store');

const ensureDir = (directory) => fs.mkdirSync(directory, { recursive: true });
const readJson = (filePath, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
};

class TraceStore {
  constructor(baseDirectory, options = {}) {
    this.baseDirectory = baseDirectory;
    this.maxPerScenario = options.maxPerScenario || 25;
    this.maxAgeDays = options.maxAgeDays || 30;
  }

  directory(collection, scenarioId = 'unscoped') {
    const identity = buildCollectionIdentity(collection);
    const directory = path.join(this.baseDirectory, 'collections', identity.key, 'traces', String(scenarioId || 'unscoped'));
    ensureDir(directory);
    return { identity, directory };
  }

  save(collection, trace) {
    const { identity, directory } = this.directory(collection, trace.scenarioId);
    const next = { ...trace, collection: identity, pinned: Boolean(trace.pinned) };
    atomicWriteJson(path.join(directory, `${next.traceId}.json`), next);
    this.prune(directory);
    return next;
  }

  get(collection, scenarioId, traceId) {
    const { directory } = this.directory(collection, scenarioId);
    return readJson(path.join(directory, `${traceId}.json`));
  }

  list(collection, scenarioId = null) {
    const identity = buildCollectionIdentity(collection);
    const root = path.join(this.baseDirectory, 'collections', identity.key, 'traces');
    ensureDir(root);
    const directories = scenarioId ? [String(scenarioId)] : fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    return directories.flatMap((directoryName) => {
      const directory = path.join(root, directoryName);
      if (!fs.existsSync(directory)) return [];
      return fs.readdirSync(directory)
        .filter((name) => name.endsWith('.json'))
        .map((name) => readJson(path.join(directory, name)))
        .filter(Boolean);
    }).sort((left, right) => new Date(right.startedAt || 0) - new Date(left.startedAt || 0));
  }

  delete(collection, scenarioId, traceId) {
    const { directory } = this.directory(collection, scenarioId);
    const filePath = path.join(directory, `${traceId}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { deleted: true };
  }

  setPinned(collection, scenarioId, traceId, pinned) {
    const trace = this.get(collection, scenarioId, traceId);
    if (!trace) throw new Error('Trace not found');
    return this.save(collection, { ...trace, pinned: Boolean(pinned) });
  }

  prune(directory) {
    const now = Date.now();
    const files = fs.readdirSync(directory).filter((name) => name.endsWith('.json')).map((name) => ({ name, trace: readJson(path.join(directory, name)) })).filter((entry) => entry.trace);
    const ordered = files.sort((left, right) => new Date(right.trace.startedAt || 0) - new Date(left.trace.startedAt || 0));
    ordered.forEach((entry, index) => {
      if (entry.trace.pinned) return;
      const old = now - new Date(entry.trace.startedAt || 0).getTime() > this.maxAgeDays * 86400000;
      if (old || index >= this.maxPerScenario) fs.unlinkSync(path.join(directory, entry.name));
    });
  }
}

module.exports = { TraceStore };
