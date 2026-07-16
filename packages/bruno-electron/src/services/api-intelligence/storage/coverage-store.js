const fs = require('fs');
const path = require('path');
const { buildCollectionIdentity } = require('../identity');
const { atomicWriteJson } = require('./contract-store');

const ensureDir = (directory) => fs.mkdirSync(directory, { recursive: true });
const readJson = (filePath, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
};

class CoverageStore {
  constructor(baseDirectory, options = {}) {
    this.baseDirectory = baseDirectory;
    this.maxSnapshots = options.maxSnapshots || 20;
  }

  directory(collection) {
    const identity = buildCollectionIdentity(collection);
    const directory = path.join(this.baseDirectory, 'collections', identity.key, 'coverage');
    ensureDir(directory);
    return { identity, directory };
  }

  save(collection, snapshot) {
    const { identity, directory } = this.directory(collection);
    const next = { ...snapshot, collectionIdentity: identity };
    atomicWriteJson(path.join(directory, 'latest.json'), next);
    atomicWriteJson(path.join(directory, `${next.generatedAt.replace(/[:.]/g, '-')}.${next.snapshotId}.json`), next);
    this.prune(directory);
    return next;
  }

  latest(collection) {
    const { directory } = this.directory(collection);
    return readJson(path.join(directory, 'latest.json'));
  }

  list(collection) {
    const { directory } = this.directory(collection);
    return fs.readdirSync(directory)
      .filter((name) => name.endsWith('.json') && name !== 'latest.json')
      .sort((left, right) => right.localeCompare(left))
      .map((name) => readJson(path.join(directory, name)))
      .filter(Boolean);
  }

  prune(directory) {
    const files = fs.readdirSync(directory)
      .filter((name) => name.endsWith('.json') && name !== 'latest.json')
      .sort((left, right) => right.localeCompare(left));
    for (const stale of files.slice(this.maxSnapshots)) fs.unlinkSync(path.join(directory, stale));
  }
}

module.exports = { CoverageStore };
