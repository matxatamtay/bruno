const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { uuid } = require('../utils/common');

const FORMAT = 'bruno-run';
const LEGACY_FORMATS = new Set(['bruno-web-recording']);
const SCHEMA_VERSION = 1;
const MAX_IMPORT_BYTES = 100 * 1024 * 1024;
const MAX_IMPORT_FILES = 5000;
const INLINE_PAYLOAD_BYTES = 32 * 1024;
const MAX_EVENT_PAYLOAD_BYTES = 512 * 1024;
const MAX_SESSION_PAYLOAD_BYTES = 10 * 1024 * 1024;
const MAX_SESSION_SCREENSHOT_BYTES = 12 * 1024 * 1024;
const MAX_SESSION_SCREENSHOTS = 60;
const PAYLOAD_PREVIEW_CHARS = 2048;

const ensureDir = (directory) => fs.mkdirSync(directory, { recursive: true });
const readJson = (filePath) => JSON.parse(fs.readFileSync(filePath, 'utf8'));
const writeJson = (filePath, value) => fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
const emptyStorage = () => ({
  eventsBytes: 0,
  payloadBytes: 0,
  payloadOriginalBytes: 0,
  payloadOmittedBytes: 0,
  payloadDeduplicatedBytes: 0,
  payloadFiles: 0,
  screenshotBytes: 0,
  screenshotOriginalBytes: 0,
  screenshotOmittedBytes: 0,
  screenshotDeduplicatedBytes: 0,
  screenshotFiles: 0,
  totalBytes: 0
});

const withStorageTotal = (storage) => ({
  ...emptyStorage(),
  ...storage,
  totalBytes: Number(storage?.eventsBytes || 0)
    + Number(storage?.payloadBytes || 0)
    + Number(storage?.screenshotBytes || 0)
});

const walkFiles = (directory, base = directory) => {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(fullPath, base));
    else if (entry.isFile()) files.push({ fullPath, relativePath: path.relative(base, fullPath).replace(/\\/g, '/') });
  }
  return files;
};

const sha256Buffer = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

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

  getStoragePath(sessionId) {
    return path.join(this.getSessionDirectory(sessionId), 'storage.json');
  }

  readStorage(sessionId) {
    const storagePath = this.getStoragePath(sessionId);
    if (!fs.existsSync(storagePath)) return emptyStorage();
    try {
      return withStorageTotal(readJson(storagePath));
    } catch {
      return emptyStorage();
    }
  }

  writeStorage(sessionId, storage) {
    const next = withStorageTotal(storage);
    writeJson(this.getStoragePath(sessionId), next);
    return next;
  }

  createSession(metadata = {}) {
    const id = uuid();
    const directory = this.getSessionDirectory(id);
    ensureDir(path.join(directory, 'screenshots'));
    ensureDir(path.join(directory, 'network'));
    ensureDir(path.join(directory, 'payloads'));
    const storage = emptyStorage();
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
      importedFrom: null,
      storage
    };
    writeJson(path.join(directory, 'manifest.json'), manifest);
    fs.writeFileSync(path.join(directory, 'events.jsonl'), '');
    this.writeStorage(id, storage);
    return manifest;
  }

  readManifest(sessionId) {
    const filePath = path.join(this.getSessionDirectory(sessionId), 'manifest.json');
    if (!fs.existsSync(filePath)) return null;
    return {
      ...readJson(filePath),
      storage: this.readStorage(sessionId)
    };
  }

  writeManifest(sessionId, manifest) {
    writeJson(path.join(this.getSessionDirectory(sessionId), 'manifest.json'), manifest);
  }

  compactEvent(sessionId, event, storage) {
    const payloadKey = event?.data?.body != null ? 'body' : event?.data?.payload != null ? 'payload' : null;
    if (!payloadKey) return event;
    const payload = event.data[payloadKey];
    const valueType = typeof payload === 'string' ? 'string' : 'json';
    const serialized = valueType === 'string' ? payload : JSON.stringify(payload);
    const originalBuffer = Buffer.from(serialized, 'utf8');
    if (originalBuffer.length <= INLINE_PAYLOAD_BYTES) return event;

    storage.payloadOriginalBytes += originalBuffer.length;
    let capturedBuffer = originalBuffer.subarray(0, Math.min(originalBuffer.length, MAX_EVENT_PAYLOAD_BYTES));
    let fingerprint = crypto.createHash('sha256').update(capturedBuffer).digest('hex');
    let relativePath = `payloads/${fingerprint}.bin`;
    let payloadPath = path.join(this.getSessionDirectory(sessionId), relativePath);
    let duplicate = fs.existsSync(payloadPath);

    if (!duplicate) {
      const availableBytes = Math.max(0, MAX_SESSION_PAYLOAD_BYTES - storage.payloadBytes);
      capturedBuffer = capturedBuffer.subarray(0, Math.min(capturedBuffer.length, availableBytes));
      if (capturedBuffer.length) {
        fingerprint = crypto.createHash('sha256').update(capturedBuffer).digest('hex');
        relativePath = `payloads/${fingerprint}.bin`;
        payloadPath = path.join(this.getSessionDirectory(sessionId), relativePath);
        duplicate = fs.existsSync(payloadPath);
      } else {
        relativePath = null;
      }
    }

    if (relativePath && duplicate) {
      storage.payloadDeduplicatedBytes += capturedBuffer.length;
    } else if (relativePath) {
      fs.writeFileSync(payloadPath, capturedBuffer);
      storage.payloadBytes += capturedBuffer.length;
      storage.payloadFiles += 1;
    }
    storage.payloadOmittedBytes += Math.max(0, originalBuffer.length - capturedBuffer.length);

    return {
      ...event,
      data: {
        ...event.data,
        [payloadKey]: undefined,
        [`${payloadKey}Ref`]: {
          path: relativePath,
          sha256: relativePath ? fingerprint : null,
          valueType,
          originalBytes: originalBuffer.length,
          capturedBytes: capturedBuffer.length,
          truncated: capturedBuffer.length < originalBuffer.length,
          preview: serialized.slice(0, PAYLOAD_PREVIEW_CHARS)
        }
      }
    };
  }

  hydrateEvent(sessionId, event) {
    const payloadKey = event?.data?.bodyRef ? 'body' : event?.data?.payloadRef ? 'payload' : null;
    if (!payloadKey || event.data[payloadKey] != null) return event;
    const payloadRef = event.data[`${payloadKey}Ref`];
    let payload = payloadRef.preview || '';
    if (payloadRef.path && isSafeArchivePath(payloadRef.path)) {
      const payloadPath = path.resolve(this.getSessionDirectory(sessionId), payloadRef.path);
      const sessionDirectory = path.resolve(this.getSessionDirectory(sessionId));
      if (payloadPath.startsWith(`${sessionDirectory}${path.sep}`) && fs.existsSync(payloadPath)) {
        payload = fs.readFileSync(payloadPath, 'utf8');
      }
    }
    if (payloadRef.truncated) {
      payload = `${payload}\n<... truncated ${Math.max(0, payloadRef.originalBytes - payloadRef.capturedBytes)} bytes ...>`;
    } else if (payloadRef.valueType === 'json') {
      try { payload = JSON.parse(payload); } catch {}
    }
    return { ...event, data: { ...event.data, [payloadKey]: payload } };
  }

  appendEvent(sessionId, event) {
    const storage = this.readStorage(sessionId);
    const compacted = this.compactEvent(sessionId, event, storage);
    const line = `${JSON.stringify(compacted)}\n`;
    fs.appendFileSync(path.join(this.getSessionDirectory(sessionId), 'events.jsonl'), line);
    storage.eventsBytes += Buffer.byteLength(line);
    this.writeStorage(sessionId, storage);
    return compacted;
  }

  writeScreenshot(sessionId, eventId, base64, mimeType = 'image/jpeg') {
    const extension = mimeType === 'image/png' ? 'png' : 'jpg';
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > 8 * 1024 * 1024) throw new Error('Screenshot exceeds 8 MB limit');
    const storage = this.readStorage(sessionId);
    storage.screenshotOriginalBytes += buffer.length;
    const fingerprint = crypto.createHash('sha256').update(buffer).digest('hex');
    const relativePath = `screenshots/${fingerprint}.${extension}`;
    const screenshotPath = path.join(this.getSessionDirectory(sessionId), relativePath);
    if (fs.existsSync(screenshotPath)) {
      storage.screenshotDeduplicatedBytes += buffer.length;
      this.writeStorage(sessionId, storage);
      return relativePath;
    }
    if (storage.screenshotFiles >= MAX_SESSION_SCREENSHOTS
      || storage.screenshotBytes + buffer.length > MAX_SESSION_SCREENSHOT_BYTES) {
      storage.screenshotOmittedBytes += buffer.length;
      this.writeStorage(sessionId, storage);
      return null;
    }
    fs.writeFileSync(screenshotPath, buffer);
    storage.screenshotBytes += buffer.length;
    storage.screenshotFiles += 1;
    this.writeStorage(sessionId, storage);
    return relativePath;
  }

  updateSession(sessionId, patch) {
    const manifest = this.readManifest(sessionId);
    if (!manifest) throw new Error('Recording session not found');
    const next = {
      ...manifest,
      ...patch,
      storage: this.readStorage(sessionId)
    };
    this.writeManifest(sessionId, next);
    return next;
  }

  loadSession(sessionId, limit = 10000) {
    const manifest = this.readManifest(sessionId);
    if (!manifest) throw new Error('Recording session not found');
    const eventPath = path.join(this.getSessionDirectory(sessionId), 'events.jsonl');
    const lines = fs.existsSync(eventPath) ? fs.readFileSync(eventPath, 'utf8').split('\n').filter(Boolean) : [];
    const events = lines
      .slice(-Math.max(1, Math.min(Number(limit) || 10000, 50000)))
      .map((line) => this.hydrateEvent(sessionId, JSON.parse(line)));
    return { manifest, events };
  }

  listSessions() {
    return fs.readdirSync(this.baseDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => this.readManifest(entry.name))
      .filter(Boolean)
      .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  }

  exportSession(sessionId, destinationPath, options = {}) {
    const directory = this.getSessionDirectory(sessionId);
    if (!fs.existsSync(directory)) throw new Error('Recording session not found');
    const manifest = this.readManifest(sessionId);
    const archiveManifest = {
      ...manifest,
      format: FORMAT,
      schemaVersion: SCHEMA_VERSION,
      secrets: options.secretBundle ? {
        encrypted: true,
        recordCount: Number(options.secretRecordCount) || 0,
        bytes: options.secretBundle.length,
        algorithm: 'aes-256-gcm'
      } : { encrypted: false }
    };
    const checksums = {};
    const zip = new AdmZip();
    for (const file of walkFiles(directory)) {
      if (['checksums.json', 'manifest.json', 'secrets.enc'].includes(file.relativePath)) continue;
      const buffer = fs.readFileSync(file.fullPath);
      checksums[file.relativePath] = sha256Buffer(buffer);
      zip.addFile(file.relativePath, buffer);
    }
    const manifestBuffer = Buffer.from(JSON.stringify(archiveManifest, null, 2));
    checksums['manifest.json'] = sha256Buffer(manifestBuffer);
    zip.addFile('manifest.json', manifestBuffer);
    if (options.secretBundle) {
      checksums['secrets.enc'] = sha256Buffer(options.secretBundle);
      zip.addFile('secrets.enc', options.secretBundle);
    }
    zip.addFile('checksums.json', Buffer.from(JSON.stringify(checksums, null, 2)));
    zip.writeZip(destinationPath);
    return {
      filePath: destinationPath,
      bytes: fs.statSync(destinationPath).size,
      storage: this.readStorage(sessionId),
      secrets: archiveManifest.secrets
    };
  }

  importSession(sourcePath) {
    const zip = new AdmZip(sourcePath);
    const entries = zip.getEntries();
    if (entries.length > MAX_IMPORT_FILES) throw new Error('Recording archive has too many files');
    let declaredBytes = 0;
    for (const entry of entries) {
      if (!isSafeArchivePath(entry.entryName)) throw new Error('Recording archive contains an unsafe path');
      declaredBytes += entry.header.size;
      if (declaredBytes > MAX_IMPORT_BYTES) throw new Error('Recording archive exceeds 100 MB limit');
    }

    const manifestEntry = entries.find((entry) => entry.entryName === 'manifest.json');
    if (!manifestEntry) throw new Error('Recording manifest is missing');
    const sourceManifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    const supportedFormat = sourceManifest.format === FORMAT || LEGACY_FORMATS.has(sourceManifest.format);
    if (!supportedFormat || sourceManifest.schemaVersion !== SCHEMA_VERSION) {
      throw new Error('Unsupported Bruno recording format');
    }

    const checksumsEntry = entries.find((entry) => entry.entryName === 'checksums.json');
    let expectedChecksums = null;
    if (checksumsEntry) {
      expectedChecksums = JSON.parse(checksumsEntry.getData().toString('utf8'));
      if (!expectedChecksums || typeof expectedChecksums !== 'object' || Array.isArray(expectedChecksums)) {
        throw new Error('Recording checksums are malformed');
      }
      const archiveFiles = entries
        .filter((entry) => !entry.isDirectory && entry.entryName !== 'checksums.json')
        .map((entry) => path.posix.normalize(entry.entryName.replace(/\\/g, '/')));
      for (const file of archiveFiles) {
        if (!Object.prototype.hasOwnProperty.call(expectedChecksums, file)) {
          throw new Error(`Recording file is missing a checksum: ${file}`);
        }
      }
      for (const relativePath of Object.keys(expectedChecksums)) {
        const normalized = path.posix.normalize(relativePath.replace(/\\/g, '/'));
        if (!isSafeArchivePath(relativePath) || !archiveFiles.includes(normalized)) {
          throw new Error('Recording checksum references an invalid file');
        }
      }
    }

    const importedId = uuid();
    const directory = this.getSessionDirectory(importedId);
    ensureDir(directory);
    try {
      let actualBytes = 0;
      for (const entry of entries) {
        if (entry.isDirectory) continue;
        const normalized = path.posix.normalize(entry.entryName.replace(/\\/g, '/'));
        const outputPath = path.resolve(directory, normalized);
        if (!outputPath.startsWith(`${path.resolve(directory)}${path.sep}`) && outputPath !== path.resolve(directory)) {
          throw new Error('Recording archive contains an unsafe path');
        }
        const data = entry.getData();
        actualBytes += data.length;
        if (actualBytes > MAX_IMPORT_BYTES) throw new Error('Recording archive exceeds 100 MB limit');
        if (expectedChecksums && normalized !== 'checksums.json') {
          if (sha256Buffer(data) !== expectedChecksums[normalized]) {
            throw new Error(`Recording checksum failed for ${normalized}`);
          }
        }
        ensureDir(path.dirname(outputPath));
        fs.writeFileSync(outputPath, data);
      }

      const importedManifest = {
        ...sourceManifest,
        format: FORMAT,
        id: importedId,
        status: 'imported',
        importedFrom: sourceManifest.id || path.basename(sourcePath),
        sourceFormat: sourceManifest.format,
        endedAt: sourceManifest.endedAt || new Date().toISOString()
      };
      if (!fs.existsSync(this.getStoragePath(importedId))) {
        const storage = emptyStorage();
        const eventsPath = path.join(directory, 'events.jsonl');
        if (fs.existsSync(eventsPath)) storage.eventsBytes = fs.statSync(eventsPath).size;
        const screenshotsDirectory = path.join(directory, 'screenshots');
        if (fs.existsSync(screenshotsDirectory)) {
          for (const file of walkFiles(screenshotsDirectory)) {
            storage.screenshotBytes += fs.statSync(file.fullPath).size;
            storage.screenshotFiles += 1;
          }
        }
        this.writeStorage(importedId, storage);
      }
      importedManifest.storage = this.readStorage(importedId);
      importedManifest.secrets = {
        ...(sourceManifest.secrets || { encrypted: false }),
        encrypted: Boolean(
          sourceManifest.secrets?.encrypted
          && fs.existsSync(path.join(directory, 'secrets.enc'))
        ),
        unlocked: false
      };
      writeJson(path.join(directory, 'manifest.json'), importedManifest);
      return this.loadSession(importedId);
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }
}

module.exports = {
  FORMAT,
  SCHEMA_VERSION,
  INLINE_PAYLOAD_BYTES,
  MAX_EVENT_PAYLOAD_BYTES,
  MAX_SESSION_PAYLOAD_BYTES,
  isSafeArchivePath,
  RecorderSessionStore
};
