const fs = require('fs');
const path = require('path');
const { buildCollectionIdentity, buildRequestIdentity } = require('../identity');
const { atomicWriteJson } = require('./contract-store');

const ensureDir = (directory) => fs.mkdirSync(directory, { recursive: true });
const readJson = (filePath, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
};

class ObservationStore {
  constructor(baseDirectory, options = {}) {
    this.baseDirectory = baseDirectory;
    this.maxPerRequest = options.maxPerRequest || 50;
    ensureDir(path.join(baseDirectory, 'collections'));
  }

  requestDirectory(collection, request) {
    const collectionIdentity = buildCollectionIdentity(collection);
    const requestIdentity = buildRequestIdentity(request);
    const directory = path.join(this.baseDirectory, 'collections', collectionIdentity.key, 'observations', requestIdentity.key);
    ensureDir(directory);
    atomicWriteJson(path.join(this.baseDirectory, 'collections', collectionIdentity.key, 'collection.json'), {
      ...collectionIdentity,
      lastSeenAt: new Date().toISOString()
    });
    return { directory, collectionIdentity, requestIdentity };
  }

  record(collection, request, observation) {
    const { directory, collectionIdentity, requestIdentity } = this.requestDirectory(collection, request);
    const next = { ...observation, requestRef: requestIdentity, collection: collectionIdentity };
    const safeTimestamp = String(Date.now()).padStart(13, '0');
    atomicWriteJson(path.join(directory, `${safeTimestamp}.${next.observationId}.json`), next);
    this.prune(directory);
    return next;
  }

  list(collection, request) {
    const { directory } = this.requestDirectory(collection, request);
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .sort((left, right) => right.name.localeCompare(left.name))
      .map((entry) => readJson(path.join(directory, entry.name)))
      .filter(Boolean);
  }

  prune(directory) {
    const files = fs.readdirSync(directory)
      .filter((name) => name.endsWith('.json'))
      .sort((left, right) => right.localeCompare(left));
    for (const stale of files.slice(this.maxPerRequest)) fs.unlinkSync(path.join(directory, stale));
  }
}

module.exports = { ObservationStore };
