const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { uuid } = require('../utils/common');

const FORMAT = 'bruno-web-recording';
const SCHEMA_VERSION = 1;
const MAX_IMPORT_BYTES = 250 * 1024 * 1024;
const MAX_IMPORT_FILES = 10000;

const ensureDir = (directory) => fs.mkdirSync(directory, { recursive: true });
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const writeJson = (filePath, value) => fs.writeFileSync(filePath, JSON.stringify(value, null, 2));

const walkFiles = (directory, base = directory) => {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath, base));
    else if (entry.isFile()) files.push({ fullPath, relativePath: path.relative(base, fullPath).replace(/\\/g, '/') });
  }
  return files;
};

const sha256File = (filePath) => crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');

const isSafeArchivePath = (entryName) => {
  if (typeof entryName !== 'string' || !entryName) return false;
  const slashNormalized = entryName.replace(/\\/g, '/');
  const normalized = path.posix.normalize(slashNormalized);
  return !slashNormalized.startsWith('/')
    && !/^[A-Za-z]:\//.test(slashNormalized)
    && normalized !== '..'
    && !normalized.startsWith('../')
    && !normalized.includes('/../');
};

class RecorderSessionStore {
  constructor(baseDirectory) {
    this.baseDirectory = baseDirectory;
    ensureDir(this.baseDirectory);
    this.recoverInterruptedSessions();
  }

  recoverInterruptedSessions() {
    const interruptedAt = new Date().toISOString();
    for (const entry of fs.readdirSync(this.baseDirectory, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifestPath = path.join(this.baseDirectory, entry.name, 'manifest.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = readJson(manifestPath);
        if (manifest.status !== 'recording') continue;
        writeJson(manifestPath, {
          ...manifest,
          status: 'interrupted',
          endedAt: manifest.endedAt || interruptedAt
        });
      } catch {
        // Leave malformed sessions untouched so the user can inspect or remove them manually.
      }
    }
  }

  getSessionDirectory(sessionId) {
    return path.join(this.baseDirectory, sessionId);
  }

  createSession(metadata = {}) {
    const id = uuid();
    const directory = this.getSessionDirectory(id);
    ensureDir(path.join(directory, 'screenshots'));
    ensureDir(path.join(directory, 'network'));
    const manifest = {
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      id,
      name: metadata.name || `Recording ${new Date().toLocaleString()}`,
      status: 'recording',
      startedAt: new Date().toISOString(),
      endedAt: null,
      eventCount: 0,
      collection: metadata.collection || null,
      browser: metadata.browser || null,
      importedFrom: null
    };
    writeJson(path.join(directory, 'manifest.json'), manifest);
    fs.writeFileSync(path.join(directory, 'events.jsonl'), '');
    return manifest;
  }

  readManifest(sessionId) {
    const filePath = path.join(this.getSessionDirectory(sessionId), 'manifest.json');
    if (!fs.existsSync(filePath)) return null;
    return readJson(filePath);
  }

  writeManifest(sessionId, manifest) {
    writeJson(path.join(this.getSessionDirectory(sessionId), 'manifest.json'), manifest);
  }

  appendEvent(sessionId, event) {
    fs.appendFileSync(path.join(this.getSessionDirectory(sessionId), 'events.jsonl'), `${JSON.stringify(event)}\n`);
  }

  writeScreenshot(sessionId, eventId, base64, mimeType = 'image/jpeg') {
    const extension = mimeType === 'image/png' ? 'png' : 'jpg';
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > 8 * 1024 * 1024) throw new Error('Screenshot exceeds 8 MB limit');
    const relativePath = `screenshots/${eventId}.${extension}`;
    fs.writeFileSync(path.join(this.getSessionDirectory(sessionId), relativePath), buffer);
    return relativePath;
  }

  updateSession(sessionId, patch) {
    const manifest = this.readManifest(sessionId);
    if (!manifest) throw new Error('Recording session not found');
    const next = { ...manifest, ...patch };
    this.writeManifest(sessionId, next);
    return next;
  }

  loadSession(sessionId, limit = 10000) {
    const manifest = this.readManifest(sessionId);
    if (!manifest) throw new Error('Recording session not found');
    const eventPath = path.join(this.getSessionDirectory(sessionId), 'events.jsonl');
    const lines = fs.existsSync(eventPath) ? fs.readFileSync(eventPath, 'utf8').split('\n').filter(Boolean) : [];
    const events = lines.slice(-Math.max(1, Math.min(Number(limit) || 10000, 50000))).map((line) => JSON.parse(line));
    return { manifest, events };
  }

  listSessions() {
    return fs.readdirSync(this.baseDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.readManifest(entry.name))
      .filter(Boolean)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  }

  exportSession(sessionId, destinationPath) {
    const directory = this.getSessionDirectory(sessionId);
    if (!fs.existsSync(directory)) throw new Error('Recording session not found');
    const checksums = {};
    for (const file of walkFiles(directory)) {
      if (file.relativePath !== 'checksums.json') checksums[file.relativePath] = sha256File(file.fullPath);
    }
    writeJson(path.join(directory, 'checksums.json'), checksums);
    const zip = new AdmZip();
    zip.addLocalFolder(directory);
    zip.writeZip(destinationPath);
    return destinationPath;
  }

  importSession(sourcePath) {
    const zip = new AdmZip(sourcePath);
    const entries = zip.getEntries();
    if (entries.length > MAX_IMPORT_FILES) throw new Error('Recording archive has too many files');
    let totalBytes = 0;
    for (const entry of entries) {
      if (!isSafeArchivePath(entry.entryName)) throw new Error('Recording archive contains an unsafe path');
      totalBytes += entry.header.size;
      if (totalBytes > MAX_IMPORT_BYTES) throw new Error('Recording archive exceeds 250 MB limit');
    }

    const manifestEntry = entries.find((entry) => entry.entryName === 'manifest.json');
    if (!manifestEntry) throw new Error('Recording manifest is missing');
    const sourceManifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    if (sourceManifest.format !== FORMAT || sourceManifest.schemaVersion !== SCHEMA_VERSION) {
      throw new Error('Unsupported Bruno recording format');
    }

    const importedId = uuid();
    const directory = this.getSessionDirectory(importedId);
    ensureDir(directory);
    for (const entry of entries) {
      if (entry.isDirectory) continue;
      const normalized = path.posix.normalize(entry.entryName.replace(/\\/g, '/'));
      const outputPath = path.resolve(directory, normalized);
      if (!outputPath.startsWith(`${path.resolve(directory)}${path.sep}`) && outputPath !== path.resolve(directory)) {
        throw new Error('Recording archive contains an unsafe path');
      }
      ensureDir(path.dirname(outputPath));
      fs.writeFileSync(outputPath, entry.getData());
    }

    const checksumsPath = path.join(directory, 'checksums.json');
    if (fs.existsSync(checksumsPath)) {
      const checksums = readJson(checksumsPath);
      for (const [relativePath, expected] of Object.entries(checksums)) {
        const filePath = path.resolve(directory, relativePath);
        if (!filePath.startsWith(`${path.resolve(directory)}${path.sep}`) || !fs.existsSync(filePath)) {
          throw new Error('Recording checksum references an invalid file');
        }
        if (sha256File(filePath) !== expected) throw new Error(`Recording checksum failed for ${relativePath}`);
      }
    }

    const importedManifest = {
      ...sourceManifest,
      id: importedId,
      status: 'imported',
      importedFrom: sourceManifest.id || path.basename(sourcePath),
      endedAt: sourceManifest.endedAt || new Date().toISOString()
    };
    writeJson(path.join(directory, 'manifest.json'), importedManifest);
    return this.loadSession(importedId);
  }
}

module.exports = {
  FORMAT,
  SCHEMA_VERSION,
  isSafeArchivePath,
  RecorderSessionStore
};
