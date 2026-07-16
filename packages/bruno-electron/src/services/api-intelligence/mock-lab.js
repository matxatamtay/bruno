const crypto = require('crypto');

const SECRET_KEY = /token|secret|password|authorization|cookie|session|api[-_]?key/i;

const sanitizeRecordedValue = (value, key = '', depth = 0) => {
  if (SECRET_KEY.test(key)) {
    if (typeof value === 'string' && /^{{\s*secret:[^}]+}}$/.test(value.trim())) return value;
    return '<redacted>';
  }
  if (depth > 8) return '<depth-limit>';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeRecordedValue(item, key, depth + 1));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 200).map(([childKey, child]) => [childKey, sanitizeRecordedValue(child, childKey, depth + 1)]));
  if (typeof value === 'string' && value.length > 10000) return `${value.slice(0, 10000)}…<truncated>`;
  return value;
};

const pathTemplateFromUrl = (url = '') => {
  try {
    return new URL(String(url).replace(/{{[^}]+}}/g, 'placeholder'), 'http://bruno.local').pathname
      .replace(/\/placeholder(?=\/|$)/g, '/:value')
      .replace(/\/\d+(?=\/|$)/g, '/:id');
  } catch {
    return String(url || '/').split('?')[0] || '/';
  }
};

const compilePathTemplate = (template = '/') => {
  const names = [];
  const escaped = String(template || '/')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\\\{([^}]+)\\\}/g, (match, name) => {
      names.push(name);
      return '([^/]+)';
    })
    .replace(/:([A-Za-z0-9_]+)/g, (match, name) => {
      names.push(name);
      return '([^/]+)';
    });
  return { regex: new RegExp(`^${escaped}/?$`), names };
};

const matchesObject = (expected = {}, actual = {}) => Object.entries(expected).every(([key, value]) => {
  const found = Object.entries(actual).find(([candidate]) => candidate.toLowerCase() === key.toLowerCase())?.[1];
  if (value == null || value === '') return found !== undefined;
  return String(found ?? '') === String(value);
});

const matchRoute = (route, request) => {
  if (route.enabled === false) return null;
  if (String(route.method || 'GET').toUpperCase() !== String(request.method || 'GET').toUpperCase()) return null;
  const compiled = compilePathTemplate(route.pathTemplate || '/');
  const matched = compiled.regex.exec(request.pathname || '/');
  if (!matched) return null;
  if (!matchesObject(route.match?.query, request.query)) return null;
  if (!matchesObject(route.match?.headers, request.headers)) return null;
  if (route.match?.body && JSON.stringify(route.match.body) !== JSON.stringify(request.body)) return null;
  return { params: Object.fromEntries(compiled.names.map((name, index) => [name, matched[index + 1]])) };
};

const exampleFromSchema = (schema, depth = 0) => {
  if (!schema || depth > 8) return null;
  if (schema.type === 'union') return exampleFromSchema(schema.anyOf?.[0], depth + 1);
  if (schema.type === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).map(([key, child]) => [key, exampleFromSchema(child, depth + 1)]));
  if (schema.type === 'array') return [exampleFromSchema(schema.items, depth + 1)];
  if (schema.type === 'integer' || schema.type === 'number') return 0;
  if (schema.type === 'boolean') return false;
  if (schema.type === 'null') return null;
  if (schema.format === 'uuid') return '00000000-0000-4000-8000-000000000000';
  if (schema.format === 'date-time') return '2026-01-01T00:00:00.000Z';
  if (schema.format === 'email') return 'mock@example.com';
  if (schema.format === 'uri') return 'https://example.com';
  return 'string';
};

const parseExample = (example) => {
  const response = example?.response || {};
  const body = response.body || {};
  let value = body.content ?? null;
  if (body.type === 'json' && typeof value === 'string') {
    try { value = JSON.parse(value); } catch {}
  }
  return {
    status: Number(response.status) || 200,
    headers: Object.fromEntries((response.headers || []).filter((header) => header.enabled !== false && header.name).map((header) => [header.name, header.value])),
    body: value
  };
};

const buildMockRoute = ({ request, contract = null }) => {
  const source = request.draft || request;
  const req = source.request || {};
  const example = (source.examples || request.examples || []).find((candidate) => Number.isInteger(Number(candidate?.response?.status)));
  const contractStatuses = Object.keys(contract?.responseContracts || {});
  const status = Number(example?.response?.status || contractStatuses.find((candidate) => Number(candidate) >= 200 && Number(candidate) < 400) || contractStatuses[0] || 200);
  const contractResponse = contract?.responseContracts?.[String(status)];
  const exampleResponse = example ? parseExample(example) : null;
  const body = sanitizeRecordedValue(exampleResponse?.body ?? exampleFromSchema(contractResponse?.schema) ?? { ok: true });
  return {
    id: crypto.randomUUID(),
    requestRef: {
      uid: request.uid || request.itemUid || null,
      pathname: request.pathname || null,
      fingerprint: request.fingerprint || null
    },
    name: request.name || `${req.method || 'GET'} ${pathTemplateFromUrl(req.url)}`,
    enabled: true,
    method: String(req.method || 'GET').toUpperCase(),
    pathTemplate: pathTemplateFromUrl(req.url),
    match: { query: {}, headers: {} },
    responses: [{
      id: crypto.randomUUID(),
      status,
      headers: { 'content-type': contractResponse?.contentTypes?.[0] || exampleResponse?.headers?.['content-type'] || 'application/json' },
      body,
      delayMs: 0,
      weight: 1
    }],
    stateMachine: null,
    passthrough: false,
    failurePreset: null
  };
};

const setAtPath = (value, path, replacement, remove = false) => {
  if (!value || typeof value !== 'object') return value;
  const parts = String(path || '').replace(/^body\./, '').split('.').filter(Boolean);
  if (!parts.length) return value;
  const copy = JSON.parse(JSON.stringify(value));
  let current = copy;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object') return copy;
    current = current[part];
  }
  if (remove) delete current[parts[parts.length - 1]];
  else current[parts[parts.length - 1]] = replacement;
  return copy;
};

const applyFailurePreset = (response, preset = {}) => {
  const next = { ...response, headers: { ...(response.headers || {}) } };
  switch (preset.type) {
    case 'status': next.status = Number(preset.status || 500); break;
    case 'auth-expired': next.status = 401; next.body = { error: 'token_expired' }; break;
    case 'rate-limit': next.status = 429; next.headers['retry-after'] = String(preset.retryAfter || 1); next.body = { error: 'rate_limited' }; break;
    case 'empty-list': next.body = []; break;
    case 'missing-field': next.body = setAtPath(next.body, preset.path, undefined, true); break;
    case 'wrong-type': next.body = setAtPath(next.body, preset.path, preset.value ?? 123); break;
    case 'invalid-json': next.rawBody = '{ invalid json'; next.headers['content-type'] = 'application/json'; break;
    case 'large-response': next.body = { items: Array.from({ length: Math.min(10000, Number(preset.count || 1000)) }, (_, index) => ({ id: index, value: 'x'.repeat(100) })) }; break;
    default: break;
  }
  next.delayMs = Number(preset.delayMs ?? next.delayMs ?? 0);
  return next;
};

module.exports = {
  sanitizeRecordedValue,
  pathTemplateFromUrl,
  compilePathTemplate,
  matchRoute,
  exampleFromSchema,
  buildMockRoute,
  applyFailurePreset
};
