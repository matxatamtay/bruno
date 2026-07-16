const fs = require('fs');
const path = require('path');
const { buildCollectionIdentity, buildRequestIdentity, hash } = require('../identity');

const ensureDir = (directory) => fs.mkdirSync(directory, { recursive: true });
const readJson = (filePath, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
};
const atomicWriteJson = (filePath, value) => {
  ensureDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
};

class ContractStore {
  constructor(baseDirectory) {
    this.baseDirectory = baseDirectory;
    ensureDir(path.join(baseDirectory, 'collections'));
  }

  collectionDirectory(identity) {
    return path.join(this.baseDirectory, 'collections', identity.key);
  }

  ensureCollection(collection) {
    const identity = buildCollectionIdentity(collection);
    const directory = this.collectionDirectory(identity);
    ensureDir(path.join(directory, 'contracts'));
    atomicWriteJson(path.join(directory, 'collection.json'), { ...identity, lastSeenAt: new Date().toISOString() });
    return identity;
  }

  paths(collection, request, environmentKey = null) {
    const collectionIdentity = this.ensureCollection(collection);
    const requestIdentity = buildRequestIdentity(request);
    const directory = path.join(this.collectionDirectory(collectionIdentity), 'contracts');
    const environmentToken = environmentKey ? `env-${hash(environmentKey).slice(0, 16)}` : null;
    return {
      collectionIdentity,
      requestIdentity,
      directory,
      allPath: path.join(directory, `${requestIdentity.key}.all.json`),
      environmentPath: environmentToken ? path.join(directory, `${requestIdentity.key}.${environmentToken}.json`) : null,
      legacyPath: path.join(directory, `${requestIdentity.key}.json`)
    };
  }

  contractPath(collection, request, contract = {}) {
    const paths = this.paths(collection, request, contract.environmentKey);
    const environmentSpecific = contract.environmentScope === 'environment-specific';
    if (environmentSpecific && !contract.environmentKey) throw new Error('Environment-specific contracts require an environment key');
    return {
      collectionIdentity: paths.collectionIdentity,
      requestIdentity: paths.requestIdentity,
      filePath: environmentSpecific ? paths.environmentPath : paths.allPath,
      legacyPath: paths.legacyPath
    };
  }

  getContract(collection, request, environmentKey = null) {
    const paths = this.paths(collection, request, environmentKey);
    if (paths.environmentPath) {
      const environmentContract = readJson(paths.environmentPath);
      if (environmentContract) return environmentContract;
    }
    return readJson(paths.allPath) || readJson(paths.legacyPath);
  }

  getContractsForRequest(collection, request) {
    const paths = this.paths(collection, request);
    return fs.readdirSync(paths.directory)
      .filter((name) => name.startsWith(`${paths.requestIdentity.key}.`) || name === `${paths.requestIdentity.key}.json`)
      .map((name) => readJson(path.join(paths.directory, name)))
      .filter(Boolean)
      .sort((left, right) => {
        if (left.environmentScope === right.environmentScope) return String(left.environmentKey || '').localeCompare(String(right.environmentKey || ''));
        return left.environmentScope === 'all' ? -1 : 1;
      });
  }

  saveContract(collection, request, contract) {
    const { collectionIdentity, requestIdentity, filePath, legacyPath } = this.contractPath(collection, request, contract);
    const next = {
      ...contract,
      collection: collectionIdentity,
      requestRef: requestIdentity,
      environmentScope: contract.environmentScope || 'all',
      environmentKey: contract.environmentScope === 'environment-specific' ? contract.environmentKey : null,
      updatedAt: new Date().toISOString()
    };
    atomicWriteJson(filePath, next);
    if (next.environmentScope === 'all' && fs.existsSync(legacyPath)) fs.unlinkSync(legacyPath);
    return next;
  }

  deleteContract(collection, request, environmentKey = null) {
    const paths = this.paths(collection, request, environmentKey);
    const targets = environmentKey
      ? [paths.environmentPath]
      : [paths.allPath, paths.legacyPath];
    targets.filter(Boolean).forEach((filePath) => {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
    return { deleted: true, environmentKey };
  }

  listContracts(collection) {
    const identity = this.ensureCollection(collection);
    const directory = path.join(this.collectionDirectory(identity), 'contracts');
    const contracts = fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => readJson(path.join(directory, entry.name)))
      .filter(Boolean);
    return [...new Map(contracts.map((contract) => [
      `${contract.requestRef?.key}:${contract.environmentScope || 'all'}:${contract.environmentKey || ''}`,
      contract
    ])).values()];
  }
}

module.exports = { ContractStore, atomicWriteJson };
