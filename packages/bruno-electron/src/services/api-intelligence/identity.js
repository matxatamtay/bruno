const crypto = require('crypto');
const path = require('path');

const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

const normalizePath = (value = '') => path.resolve(String(value || '')).replace(/\\/g, '/').toLowerCase();
const stableObject = (value) => {
  if (Array.isArray(value)) return value.map(stableObject);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableObject(value[key])]));
  return value;
};
const configFingerprint = (collection = {}) => hash(JSON.stringify(stableObject(collection.brunoConfig || collection.config || {}))).slice(0, 24);

const normalizeUrl = (value = '') => String(value || '')
  .trim()
  .replace(/{{[^}]+}}/g, '{{var}}')
  .replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ':id')
  .replace(/\/\d+(?=\/|$|\?)/g, '/:id');

const bodyShape = (body = {}) => {
  if (body.mode !== 'json') return [];
  try {
    const parsed = typeof body.json === 'string' ? JSON.parse(body.json || '{}') : body.json;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') return [];
    return Object.keys(parsed).sort();
  } catch {
    return [];
  }
};

const buildCollectionIdentity = (collection = {}) => {
  const pathname = normalizePath(collection.pathname);
  const stableHint = collection.gitRemote
    ? `remote:${collection.gitRemote}:${collection.relativeGitPath || collection.name || ''}`
    : collection.uid
      ? `uid:${collection.uid}:${collection.name || ''}`
      : `path:${pathname}`;

  return {
    key: hash(stableHint).slice(0, 32),
    uid: collection.uid || null,
    name: collection.name || path.basename(pathname) || 'Collection',
    pathname,
    gitRemote: collection.gitRemote || null,
    relativeGitPath: collection.relativeGitPath || null,
    brunoConfigFingerprint: configFingerprint(collection)
  };
};

const requestFingerprint = (request = {}) => {
  const source = request.draft || request;
  const req = source.request || source;

  return hash(JSON.stringify({
    method: String(req.method || 'GET').toUpperCase(),
    url: normalizeUrl(req.url),
    headerNames: (req.headers || [])
      .filter((item) => item.enabled !== false)
      .map((item) => String(item.name || '').toLowerCase())
      .filter(Boolean)
      .sort(),
    bodyMode: req.body?.mode || 'none',
    bodyShape: bodyShape(req.body)
  })).slice(0, 24);
};

const resolvedResult = (matches, strategy) => {
  if (matches.length === 1) return { status: 'resolved', strategy, match: matches[0], candidates: [] };
  if (matches.length > 1) return { status: 'ambiguous', strategy, match: null, candidates: matches };
  return null;
};

const resolveCollectionReference = (reference = {}, collections = []) => {
  const identities = collections.map((collection) => ({ collection, identity: buildCollectionIdentity(collection) }));
  const strategies = [
    ['uid', ({ identity }) => reference.uid && identity.uid === reference.uid],
    ['git-path', ({ identity }) => reference.gitRemote && identity.gitRemote === reference.gitRemote && (reference.relativeGitPath || '') === (identity.relativeGitPath || '')],
    ['absolute-path', ({ identity }) => reference.pathname && identity.pathname === normalizePath(reference.pathname)],
    ['name-config', ({ identity }) => reference.name && identity.name === reference.name && reference.brunoConfigFingerprint && identity.brunoConfigFingerprint === reference.brunoConfigFingerprint]
  ];
  for (const [strategy, predicate] of strategies) {
    const result = resolvedResult(identities.filter(predicate).map((entry) => entry.collection), strategy);
    if (result) return result;
  }
  return { status: 'broken', strategy: null, match: null, candidates: [] };
};

const buildRequestIdentity = (request = {}) => {
  const source = request.draft || request;
  const req = source.request || source;
  const fingerprint = requestFingerprint(request);

  return {
    key: hash(request.uid || request.itemUid || request.pathname || fingerprint).slice(0, 32),
    uid: request.uid || request.itemUid || null,
    name: request.name || null,
    pathname: request.pathname || null,
    method: String(req.method || 'GET').toUpperCase(),
    normalizedUrl: normalizeUrl(req.url),
    fingerprint
  };
};

const resolveRequestReference = (reference = {}, requests = []) => {
  const identities = requests.map((request) => ({ request, identity: buildRequestIdentity(request) }));
  const normalizedReferencePath = reference.pathname ? normalizePath(reference.pathname) : null;
  const strategies = [
    ['uid', ({ identity }) => reference.uid && identity.uid === reference.uid],
    ['relative-path', ({ identity }) => normalizedReferencePath && identity.pathname && normalizePath(identity.pathname) === normalizedReferencePath],
    ['method-url', ({ identity }) => reference.method && reference.normalizedUrl && identity.method === String(reference.method).toUpperCase() && identity.normalizedUrl === reference.normalizedUrl],
    ['semantic-fingerprint', ({ identity }) => reference.fingerprint && identity.fingerprint === reference.fingerprint]
  ];
  for (const [strategy, predicate] of strategies) {
    const result = resolvedResult(identities.filter(predicate).map((entry) => entry.request), strategy);
    if (result) return result;
  }
  return { status: 'broken', strategy: null, match: null, candidates: [] };
};

module.exports = {
  hash,
  normalizePath,
  normalizeUrl,
  configFingerprint,
  buildCollectionIdentity,
  buildRequestIdentity,
  resolveCollectionReference,
  resolveRequestReference,
  requestFingerprint
};
