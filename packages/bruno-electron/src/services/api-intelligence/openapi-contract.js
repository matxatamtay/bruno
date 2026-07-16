const crypto = require('crypto');
const { normalizeUrl, buildRequestIdentity } = require('./identity');
const { normalizeSchema, schemaFingerprint } = require('./schema');

const requestPath = (request = {}) => {
  const source = request.draft || request;
  const raw = source.request?.url || source.url || '';
  const withoutTemplatedBase = String(raw).replace(/^{{[^}]+}}(?=\/)/, '');
  try {
    return new URL(withoutTemplatedBase.replace(/{{[^}]+}}/g, 'placeholder'), 'http://bruno.local').pathname
      .replace(/placeholder/g, '{param}');
  } catch {
    return withoutTemplatedBase.split('?')[0].replace(/{{[^}]+}}/g, '{param}');
  }
};

const normalizeSpecPath = (value = '') => String(value || '').replace(/\{[^}]+\}/g, '{param}').replace(/\/+$/, '') || '/';

const resolveRef = (spec, ref) => {
  if (!ref?.startsWith('#/')) return null;
  return ref.slice(2).split('/').reduce((current, part) => current?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], spec);
};

const openApiSchemaToInternal = (schema, spec, seen = new Set()) => {
  if (!schema) return { type: 'unknown' };
  if (schema.$ref) {
    if (seen.has(schema.$ref)) return { type: 'unknown' };
    const resolved = resolveRef(spec, schema.$ref);
    return resolved ? openApiSchemaToInternal(resolved, spec, new Set([...seen, schema.$ref])) : { type: 'unknown' };
  }
  if (Array.isArray(schema.allOf)) {
    const candidates = schema.allOf.map((candidate) => openApiSchemaToInternal(candidate, spec, seen));
    const properties = Object.assign({}, ...candidates.filter((candidate) => candidate.type === 'object').map((candidate) => candidate.properties));
    const required = [...new Set(candidates.flatMap((candidate) => candidate.required || []))];
    return normalizeSchema({ type: 'object', properties, required });
  }
  if (Array.isArray(schema.oneOf) || Array.isArray(schema.anyOf)) {
    const candidates = (schema.oneOf || schema.anyOf).map((candidate) => openApiSchemaToInternal(candidate, spec, seen));
    if (schema.nullable) candidates.push({ type: 'null' });
    return normalizeSchema({ type: 'union', anyOf: candidates });
  }
  let result;
  if (schema.type === 'object' || schema.properties) {
    result = normalizeSchema({
      type: 'object',
      properties: Object.fromEntries(Object.entries(schema.properties || {}).map(([key, child]) => [key, openApiSchemaToInternal(child, spec, seen)])),
      required: schema.required || []
    });
  } else if (schema.type === 'array') {
    result = normalizeSchema({ type: 'array', items: openApiSchemaToInternal(schema.items, spec, seen) });
  } else if (schema.type === 'number' || schema.type === 'integer' || schema.type === 'boolean' || schema.type === 'null') {
    result = { type: schema.type };
  } else {
    result = schema.format ? { type: schema.type || 'string', format: schema.format } : { type: schema.type || 'string' };
  }
  if (schema.nullable && result.type !== 'null') return normalizeSchema({ type: 'union', anyOf: [result, { type: 'null' }] });
  return result;
};

const findOperation = (spec, request) => {
  const source = request.draft || request;
  const method = String(source.request?.method || source.method || 'GET').toLowerCase();
  const targetPath = normalizeSpecPath(requestPath(request));
  const entry = Object.entries(spec?.paths || {}).find(([path]) => normalizeSpecPath(path) === targetPath);
  if (!entry?.[1]?.[method]) return null;
  return { path: entry[0], method, operation: entry[1][method] };
};

const createContractFromOpenApi = ({ spec, request, environmentScope = 'all', environmentKey = null }) => {
  const match = findOperation(spec, request);
  if (!match) throw new Error(`No OpenAPI operation matches ${String((request.draft || request).request?.method || 'GET').toUpperCase()} ${requestPath(request)}`);
  const responseContracts = {};
  for (const [status, response] of Object.entries(match.operation.responses || {})) {
    if (!/^\d{3}$/.test(status)) continue;
    const contentEntries = Object.entries(response.content || {});
    const preferred = contentEntries.find(([contentType]) => contentType.includes('json')) || contentEntries[0];
    const schema = preferred ? openApiSchemaToInternal(preferred[1]?.schema, spec) : { type: 'unknown' };
    responseContracts[status] = {
      contentTypes: contentEntries.map(([contentType]) => contentType.toLowerCase()),
      schema,
      schemaFingerprint: schemaFingerprint(schema)
    };
  }
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    format: 'bruno-api-contract',
    schemaVersion: 1,
    requestRef: buildRequestIdentity(request),
    environmentScope,
    environmentKey: environmentScope === 'environment-specific' ? environmentKey : null,
    source: 'openapi',
    sourceLocation: { path: match.path, method: match.method },
    acceptedAt: now,
    updatedAt: now,
    sampleCount: 0,
    responseContracts
  };
};

module.exports = { requestPath, normalizeSpecPath, openApiSchemaToInternal, findOperation, createContractFromOpenApi, normalizeUrl };
