const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildCollectionIdentity } = require('../identity');
const { atomicWriteJson } = require('./contract-store');

const FORMAT = 'bruno-test-data-profile';
const SCHEMA_VERSION = 1;
const MAX_FIXTURE_BYTES = 5 * 1024 * 1024;
const SAFE_FIXTURE_TYPES = new Set(['text', 'json', 'csv', 'binary-placeholder']);
const SECRET_KEY = /token|secret|password|authorization|cookie|session|api[-_]?key/i;
const isSecretReference = (value) => typeof value === 'string' && /^{{\s*secret:[^}]+}}$/.test(value.trim());
const sanitizeExportValue = (value, key = '', depth = 0) => {
  if (SECRET_KEY.test(key)) {
    if (isSecretReference(value)) return value;
    if (Array.isArray(value)) return value.map((item) => isSecretReference(item) ? item : '<redacted>');
    return '<redacted>';
  }
  if (depth > 10) return '<depth-limit>';
  if (Array.isArray(value)) return value.map((item) => sanitizeExportValue(item, key, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitizeExportValue(child, childKey, depth + 1)]));
  return value;
};
const ensureDir = (directory) => fs.mkdirSync(directory, { recursive: true });
const readJson = (filePath, fallback = null) => {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return fallback; }
};

class TestDataStore {
  constructor(baseDirectory) {
    this.baseDirectory = baseDirectory;
  }

  directory(collection) {
    const identity = buildCollectionIdentity(collection);
    const directory = path.join(this.baseDirectory, 'collections', identity.key, 'test-data');
    ensureDir(path.join(directory, 'profiles'));
    ensureDir(path.join(directory, 'files'));
    return { identity, directory };
  }

  list(collection) {
    const { directory } = this.directory(collection);
    return fs.readdirSync(path.join(directory, 'profiles'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => readJson(path.join(directory, 'profiles', name)))
      .filter(Boolean)
      .sort((left, right) => new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0));
  }

  get(collection, profileId) {
    const { directory } = this.directory(collection);
    return readJson(path.join(directory, 'profiles', `${profileId}.json`));
  }

  save(collection, profile) {
    const { identity, directory } = this.directory(collection);
    const now = new Date().toISOString();
    const sanitizedProfile = sanitizeExportValue(profile);
    const next = {
      ...sanitizedProfile,
      profileId: profile.profileId || crypto.randomUUID(),
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      collectionIdentity: identity,
      createdAt: profile.createdAt || now,
      updatedAt: now
    };
    atomicWriteJson(path.join(directory, 'profiles', `${next.profileId}.json`), next);
    return next;
  }

  delete(collection, profileId) {
    const { directory } = this.directory(collection);
    const filePath = path.join(directory, 'profiles', `${profileId}.json`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { deleted: true };
  }

  exportProfile(collection, profileId, destinationPath) {
    const profile = this.get(collection, profileId);
    if (!profile) throw new Error('Test data profile not found');
    const payload = { format: FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), profile: sanitizeExportValue(profile) };
    payload.checksum = crypto.createHash('sha256').update(JSON.stringify(payload.profile)).digest('hex');
    fs.writeFileSync(destinationPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
    return destinationPath;
  }

  importProfile(collection, sourcePath) {
    const payload = readJson(sourcePath);
    if (!payload || payload.format !== FORMAT || payload.schemaVersion !== SCHEMA_VERSION || !payload.profile) throw new Error('Unsupported test data profile');
    const checksum = crypto.createHash('sha256').update(JSON.stringify(payload.profile)).digest('hex');
    if (checksum !== payload.checksum) throw new Error('Test data profile checksum failed');
    const profile = { ...payload.profile, profileId: crypto.randomUUID(), createdAt: undefined, updatedAt: undefined, importedFrom: payload.profile.profileId };
    return this.save(collection, profile);
  }

  listFixtures(collection) {
    const { directory } = this.directory(collection);
    const metadataPath = path.join(directory, 'fixtures.json');
    return readJson(metadataPath, []);
  }

  saveFixture(collection, fixture) {
    const { directory } = this.directory(collection);
    const type = SAFE_FIXTURE_TYPES.has(fixture.type) ? fixture.type : 'text';
    const content = Buffer.isBuffer(fixture.content)
      ? fixture.content
      : Buffer.from(type === 'json' && typeof fixture.content !== 'string' ? JSON.stringify(fixture.content, null, 2) : String(fixture.content ?? ''));
    if (content.length > MAX_FIXTURE_BYTES) throw new Error('Fixture exceeds 5 MB limit');
    const id = fixture.id || crypto.randomUUID();
    const extension = type === 'json' ? '.json' : type === 'csv' ? '.csv' : type === 'binary-placeholder' ? '.fixture' : '.txt';
    const filename = `${id}${extension}`;
    fs.writeFileSync(path.join(directory, 'files', filename), content, { mode: 0o600 });
    const record = {
      id,
      name: String(fixture.name || 'Fixture').slice(0, 200),
      type,
      filename,
      size: content.length,
      checksum: crypto.createHash('sha256').update(content).digest('hex'),
      updatedAt: new Date().toISOString()
    };
    const fixtures = this.listFixtures(collection).filter((candidate) => candidate.id !== id);
    atomicWriteJson(path.join(directory, 'fixtures.json'), [...fixtures, record]);
    return record;
  }

  readFixture(collection, fixtureId) {
    const { directory } = this.directory(collection);
    const fixture = this.listFixtures(collection).find((candidate) => candidate.id === fixtureId);
    if (!fixture) return null;
    const filePath = path.resolve(directory, 'files', fixture.filename);
    const filesDirectory = path.resolve(directory, 'files');
    if (!filePath.startsWith(`${filesDirectory}${path.sep}`)) throw new Error('Unsafe fixture path');
    const buffer = fs.readFileSync(filePath);
    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    if (checksum !== fixture.checksum) throw new Error('Fixture checksum mismatch');
    return { ...fixture, content: buffer.toString('utf8') };
  }

  deleteFixture(collection, fixtureId) {
    const { directory } = this.directory(collection);
    const fixtures = this.listFixtures(collection);
    const fixture = fixtures.find((candidate) => candidate.id === fixtureId);
    if (fixture) {
      const filePath = path.join(directory, 'files', fixture.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    atomicWriteJson(path.join(directory, 'fixtures.json'), fixtures.filter((candidate) => candidate.id !== fixtureId));
    return { deleted: true };
  }
}

module.exports = { TestDataStore, FORMAT, SCHEMA_VERSION };
