const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { uuid } = require('../../utils/common');
const { isSafeArchivePath } = require('../session-store');
const { buildCollectionIdentity, requestFingerprint } = require('../../services/api-intelligence/identity');

const FORMAT = 'bruno-replay-studio';
const SCHEMA_VERSION = 1;
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
const MAX_IMPORT_FILES = 2000;

const ensureDir = (directory) => fs.mkdirSync(directory, { recursive: true });
const readJson = (filePath, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
};
const atomicWriteJson = (filePath, value) => {
  ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(value, null, 2));
  fs.renameSync(tempPath, filePath);
};
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

class ReplayStudioStore {
  constructor(baseDirectory) {
    this.baseDirectory = baseDirectory;
    ensureDir(this.baseDirectory);
    ensureDir(path.join(this.baseDirectory, 'collections'));
    ensureDir(path.join(this.baseDirectory, 'imports'));
  }

  collectionDirectory(identity) {
    return path.join(this.baseDirectory, 'collections', identity.key);
  }

  ensureCollection(collection) {
    const identity = buildCollectionIdentity(collection);
    const directory = this.collectionDirectory(identity);
    ensureDir(path.join(directory, 'scenarios'));
    ensureDir(path.join(directory, 'runs'));
    ensureDir(path.join(directory, 'baselines'));
    atomicWriteJson(path.join(directory, 'collection.json'), { ...identity, lastSeenAt: new Date().toISOString() });
    return identity;
  }

  listScenarios(collection) {
    const identity = this.ensureCollection(collection);
    const directory = path.join(this.collectionDirectory(identity), 'scenarios');
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => readJson(path.join(directory, entry.name)))
      .filter(Boolean)
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  }

  getScenario(collection, scenarioId) {
    const identity = this.ensureCollection(collection);
    return readJson(path.join(this.collectionDirectory(identity), 'scenarios', `${scenarioId}.json`));
  }

  saveScenario(collection, scenario) {
    const identity = this.ensureCollection(collection);
    const now = new Date().toISOString();
    const next = {
      ...scenario,
      id: scenario.id || uuid(),
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      collection: identity,
      createdAt: scenario.createdAt || now,
      updatedAt: now
    };
    atomicWriteJson(path.join(this.collectionDirectory(identity), 'scenarios', `${next.id}.json`), next);
    return next;
  }

  deleteScenario(collection, scenarioId) {
    const identity = this.ensureCollection(collection);
    const filePath = path.join(this.collectionDirectory(identity), 'scenarios', `${scenarioId}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { deleted: true, scenarioId };
  }

  getRequestUsage(collection, requestUid) {
    return this.listScenarios(collection).flatMap((scenario) => (scenario.steps || [])
      .filter((step) => step.link?.requestUid === requestUid)
      .map((step) => ({ scenarioId: scenario.id, scenarioName: scenario.name, stepId: step.id, stepName: step.name })));
  }

  saveRun(collection, scenarioId, run) {
    const identity = this.ensureCollection(collection);
    const next = { ...run, id: run.id || uuid(), scenarioId, createdAt: run.createdAt || new Date().toISOString() };
    atomicWriteJson(path.join(this.collectionDirectory(identity), 'runs', `${next.id}.json`), next);
    return next;
  }

  listRuns(collection, scenarioId) {
    const identity = this.ensureCollection(collection);
    const directory = path.join(this.collectionDirectory(identity), 'runs');
    return fs.readdirSync(directory).filter((name) => name.endsWith('.json')).map((name) => readJson(path.join(directory, name)))
      .filter((run) => run?.scenarioId === scenarioId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  saveBaseline(collection, scenarioId, environmentKey, run) {
    const identity = this.ensureCollection(collection);
    const safeEnvironment = hash(environmentKey || 'no-environment').slice(0, 16);
    const baseline = {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      scenarioId,
      environmentKey: environmentKey || null,
      savedAt: new Date().toISOString(),
      sourceRunId: run.id || null,
      steps: (run.steps || []).map((step) => ({
        stepId: step.stepId,
        status: step.status,
        duration: step.duration,
        responseSchema: step.responseSchema || null,
        responseFingerprint: step.responseFingerprint || null
      }))
    };
    atomicWriteJson(path.join(this.collectionDirectory(identity), 'baselines', `${scenarioId}.${safeEnvironment}.json`), baseline);
    return baseline;
  }

  getBaseline(collection, scenarioId, environmentKey) {
    const identity = this.ensureCollection(collection);
    const safeEnvironment = hash(environmentKey || 'no-environment').slice(0, 16);
    return readJson(path.join(this.collectionDirectory(identity), 'baselines', `${scenarioId}.${safeEnvironment}.json`));
  }

  exportScenario(collection, scenarioId, destinationPath, options = {}) {
    const scenario = this.getScenario(collection, scenarioId);
    if (!scenario) throw new Error('Replay scenario not found');
    const manifest = { format: FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), scenarioId, scenarioName: scenario.name };
    const zip = new AdmZip();
    const files = {
      'manifest.json': Buffer.from(JSON.stringify(manifest, null, 2)),
      'scenario.json': Buffer.from(JSON.stringify(scenario, null, 2))
    };
    if (options.includeRuns) files['runs.json'] = Buffer.from(JSON.stringify(this.listRuns(collection, scenarioId), null, 2));
    const checksums = Object.fromEntries(Object.entries(files).map(([name, buffer]) => [name, crypto.createHash('sha256').update(buffer).digest('hex')]));
    Object.entries(files).forEach(([name, buffer]) => zip.addFile(name, buffer));
    zip.addFile('checksums.json', Buffer.from(JSON.stringify(checksums, null, 2)));
    zip.writeZip(destinationPath);
    return destinationPath;
  }

  importScenario(sourcePath, collection) {
    const zip = new AdmZip(sourcePath);
    const entries = zip.getEntries();
    if (entries.length > MAX_IMPORT_FILES) throw new Error('Replay archive has too many files');
    let totalBytes = 0;
    entries.forEach((entry) => {
      if (!isSafeArchivePath(entry.entryName)) throw new Error('Replay archive contains an unsafe path');
      totalBytes += entry.header.size;
    });
    if (totalBytes > MAX_IMPORT_BYTES) throw new Error('Replay archive exceeds 100 MB limit');
    const manifestEntry = entries.find((entry) => entry.entryName === 'manifest.json');
    const scenarioEntry = entries.find((entry) => entry.entryName === 'scenario.json');
    const checksumsEntry = entries.find((entry) => entry.entryName === 'checksums.json');
    if (!manifestEntry || !scenarioEntry || !checksumsEntry) throw new Error('Replay archive is incomplete');
    const checksums = JSON.parse(checksumsEntry.getData().toString('utf8'));
    for (const [name, expected] of Object.entries(checksums)) {
      const entry = entries.find((candidate) => candidate.entryName === name);
      if (!entry) throw new Error(`Replay checksum references missing file ${name}`);
      const actual = crypto.createHash('sha256').update(entry.getData()).digest('hex');
      if (actual !== expected) throw new Error(`Replay checksum failed for ${name}`);
    }
    const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    if (manifest.format !== FORMAT || manifest.schemaVersion !== SCHEMA_VERSION) throw new Error('Unsupported Replay Studio archive');
    const scenario = JSON.parse(scenarioEntry.getData().toString('utf8'));
    return this.saveScenario(collection, { ...scenario, id: uuid(), importedFrom: scenario.id || manifest.scenarioId, createdAt: undefined, updatedAt: undefined });
  }
}

module.exports = { FORMAT, SCHEMA_VERSION, ReplayStudioStore, buildCollectionIdentity, requestFingerprint, atomicWriteJson };
