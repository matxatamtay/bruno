const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AdmZip = require('adm-zip');
const { buildCollectionIdentity } = require('../identity');
const { isSafeArchivePath } = require('../../../recorder/session-store');

const FORMAT = 'bruno-intelligence-bundle';
const SCHEMA_VERSION = 1;
const MAX_FILES = 5000;
const MAX_BYTES = 250 * 1024 * 1024;
const SECRET_KEY = /token|secret|password|authorization|cookie|session|api[-_]?key/i;
const sanitizeValue = (value, key = '', depth = 0) => {
  if (SECRET_KEY.test(key)) return '<redacted>';
  if (depth > 10) return '<depth-limit>';
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, key, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, sanitizeValue(child, childKey, depth + 1)]));
  return value;
};
const sanitizeText = (text) => String(text)
  .replace(/(bearer\s+)[A-Za-z0-9._~+\/-]+/gi, '$1<redacted>')
  .replace(/((?:token|secret|password|authorization|api[-_]?key)\s*[:=]\s*)[^,;\r\n]+/gi, '$1<redacted>');
const sanitizeFile = (file, buffer) => {
  if (path.extname(file.relative).toLowerCase() === '.json') {
    try { return Buffer.from(JSON.stringify(sanitizeValue(JSON.parse(buffer.toString('utf8'))), null, 2)); } catch {}
  }
  if (['.txt', '.csv', '.fixture'].includes(path.extname(file.relative).toLowerCase())) return Buffer.from(sanitizeText(buffer.toString('utf8')));
  return buffer;
};

const walk = (directory, prefix = '') => {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    const relative = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? walk(absolute, relative) : [{ absolute, relative }];
  });
};

class IntelligenceBundle {
  constructor(baseDirectory) {
    this.baseDirectory = baseDirectory;
  }

  collectionDirectory(collection) {
    return path.join(this.baseDirectory, 'collections', buildCollectionIdentity(collection).key);
  }

  exportCollection(collection, destinationPath) {
    const identity = buildCollectionIdentity(collection);
    const directory = this.collectionDirectory(collection);
    const files = walk(directory).filter((file) => !file.relative.endsWith('.tmp'));
    if (files.length > MAX_FILES) throw new Error('Intelligence collection has too many files to export');
    const zip = new AdmZip();
    const checksums = {};
    let total = 0;
    for (const file of files) {
      const buffer = sanitizeFile(file, fs.readFileSync(file.absolute));
      total += buffer.length;
      if (total > MAX_BYTES) throw new Error('Intelligence collection exceeds export size limit');
      const archivePath = path.posix.join('collection', file.relative);
      checksums[archivePath] = crypto.createHash('sha256').update(buffer).digest('hex');
      zip.addFile(archivePath, buffer);
    }
    const manifest = { format: FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), collection: identity, fileCount: files.length };
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
    zip.addFile('checksums.json', Buffer.from(JSON.stringify(checksums, null, 2)));
    zip.writeZip(destinationPath);
    return destinationPath;
  }

  importCollection(collection, sourcePath) {
    const zip = new AdmZip(sourcePath);
    const entries = zip.getEntries();
    if (entries.length > MAX_FILES + 2) throw new Error('Intelligence archive has too many files');
    let total = 0;
    entries.forEach((entry) => {
      if (!isSafeArchivePath(entry.entryName)) throw new Error('Intelligence archive contains an unsafe path');
      total += entry.header.size;
    });
    if (total > MAX_BYTES) throw new Error('Intelligence archive exceeds size limit');
    const manifestEntry = entries.find((entry) => entry.entryName === 'manifest.json');
    const checksumsEntry = entries.find((entry) => entry.entryName === 'checksums.json');
    if (!manifestEntry || !checksumsEntry) throw new Error('Intelligence archive is incomplete');
    const manifest = JSON.parse(manifestEntry.getData().toString('utf8'));
    if (manifest.format !== FORMAT || manifest.schemaVersion !== SCHEMA_VERSION) throw new Error('Unsupported intelligence archive');
    const checksums = JSON.parse(checksumsEntry.getData().toString('utf8'));
    for (const [name, expected] of Object.entries(checksums)) {
      const entry = entries.find((candidate) => candidate.entryName === name);
      if (!entry) throw new Error(`Intelligence archive is missing ${name}`);
      const actual = crypto.createHash('sha256').update(entry.getData()).digest('hex');
      if (actual !== expected) throw new Error(`Intelligence checksum failed for ${name}`);
    }
    const destination = this.collectionDirectory(collection);
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of entries.filter((candidate) => candidate.entryName.startsWith('collection/') && !candidate.isDirectory)) {
      const relative = entry.entryName.slice('collection/'.length);
      const target = path.resolve(destination, relative);
      if (!target.startsWith(`${path.resolve(destination)}${path.sep}`)) throw new Error('Unsafe intelligence import path');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temporary, entry.getData(), { mode: 0o600 });
      fs.renameSync(temporary, target);
    }
    return { imported: true, collection: buildCollectionIdentity(collection), fileCount: Object.keys(checksums).length };
  }
}

module.exports = { IntelligenceBundle, FORMAT, SCHEMA_VERSION };
