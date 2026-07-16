import get from 'lodash/get';
import set from 'lodash/set';

const SECRET_KEY = /token|secret|password|authorization|cookie|session|api[-_]?key/i;

export const replayResponseData = (response) => {
  const value = response?.data ?? response?.body ?? response?.response?.data ?? null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
};

export const replaySchema = (value) => {
  if (Array.isArray(value)) {
    const itemSchemas = value.slice(0, 100).map(replaySchema);
    return { type: 'array', items: itemSchemas[0] || { type: 'unknown' } };
  }
  if (value && typeof value === 'object') {
    return {
      type: 'object',
      properties: Object.fromEntries(Object.entries(value).slice(0, 200).map(([key, child]) => [key, replaySchema(child)])),
      required: Object.keys(value).slice(0, 200).sort()
    };
  }
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  return { type: value === null ? 'null' : typeof value };
};

export const replayFingerprint = (value) => {
  const text = JSON.stringify(value ?? null);
  let hashValue = 5381;
  for (let index = 0; index < text.length; index += 1) hashValue = ((hashValue << 5) + hashValue) ^ text.charCodeAt(index);
  return (hashValue >>> 0).toString(16);
};

export const redactReplayValue = (value, key = '', depth = 0) => {
  if (SECRET_KEY.test(key)) return '<redacted>';
  if (depth > 8) return '<depth-limit>';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactReplayValue(item, key, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 200).map(([childKey, child]) => [childKey, redactReplayValue(child, childKey, depth + 1)]));
  }
  if (typeof value === 'string' && value.length > 4096) return `${value.slice(0, 4096)}…<truncated>`;
  return value;
};

const requestTarget = (item) => (item.draft || item).request || {};

export const requestSnapshot = (item) => {
  const request = requestTarget(item);
  const bodyMode = request.body?.mode || 'none';
  let body = bodyMode === 'json' ? request.body?.json : request.body?.[bodyMode];
  if (bodyMode === 'json' && typeof body === 'string') {
    try { body = JSON.parse(body); } catch {}
  }
  return redactReplayValue({
    method: request.method || 'GET',
    url: request.url || '',
    headers: (request.headers || []).filter((header) => header.enabled !== false).map((header) => ({ name: header.name, value: redactReplayValue(header.value, header.name) })),
    bodyMode,
    body
  });
};

export const applyReplayTarget = (item, targetBaseUrl) => {
  if (!targetBaseUrl) return item;
  const request = requestTarget(item);
  const base = String(targetBaseUrl).replace(/\/+$/, '');
  const raw = String(request.url || '');
  if (/{{\s*baseUrl\s*}}/i.test(raw)) {
    request.url = raw.replace(/{{\s*baseUrl\s*}}/gi, base);
    return item;
  }
  try {
    const current = new URL(raw);
    request.url = `${base}${current.pathname}${current.search}`;
  } catch {
    request.url = `${base}/${raw.replace(/^\/+/, '')}`;
  }
  return item;
};

export const applyReplayBindings = (item, bindings = [], variables = {}) => {
  const target = item.draft || item;
  const request = target.request || {};
  bindings.forEach((binding) => {
    const value = variables[binding.variable];
    if (value === undefined) return;
    if (binding.targetPath === 'url') {
      request.url = binding.originalValue && binding.originalValue !== '<redacted>'
        ? String(request.url || '').replace(String(binding.originalValue), String(value))
        : String(request.url || '').replace(`{{${binding.variable}}}`, String(value));
      return;
    }
    if (binding.targetPath?.startsWith('headers.')) {
      const headerName = binding.targetPath.slice('headers.'.length);
      const header = (request.headers || []).find((candidate) => String(candidate.name || '').toLowerCase() === headerName.toLowerCase());
      if (!header) return;
      if (binding.originalValue === '<redacted>' && /authorization/i.test(headerName)) header.value = `Bearer ${value}`;
      else header.value = binding.originalValue ? String(header.value || '').replace(String(binding.originalValue), String(value)) : String(value);
      return;
    }
    if (binding.targetPath?.startsWith('body.') && request.body?.mode === 'json') {
      try {
        const parsed = JSON.parse(request.body.json || '{}');
        set(parsed, binding.targetPath.slice('body.'.length), value);
        request.body.json = JSON.stringify(parsed, null, 2);
      } catch {}
    }
  });
  return item;
};

export const evaluateReplayAssertions = (assertions = [], response) => {
  const data = replayResponseData(response);
  return assertions.filter((assertion) => assertion.enabled !== false).map((assertion) => {
    let passed = true;
    if (assertion.type === 'status') passed = Number(response?.status) === Number(assertion.expected);
    if (assertion.type === 'response-time') passed = Number(response?.duration || 0) < Number(assertion.expected);
    if (assertion.type === 'json-path-exists') passed = get(data, assertion.path) !== undefined;
    if (assertion.type === 'json-path-equals') passed = get(data, assertion.path) === assertion.expected;
    return { ...assertion, passed };
  });
};

export const replayDelay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(milliseconds) || 0)));

export const evaluateReplayCondition = (condition, response) => {
  if (!condition) return true;
  if (condition.status !== undefined) return Number(response?.status) === Number(condition.status);
  const actual = get(replayResponseData(response), String(condition.path || '').replace(/^body\./, ''));
  switch (condition.operator || 'eq') {
    case 'neq': return actual !== condition.expected;
    case 'exists': return actual !== undefined && actual !== null;
    case 'contains': return String(actual ?? '').includes(String(condition.expected ?? ''));
    case 'in': return Array.isArray(condition.expected) && condition.expected.includes(actual);
    case 'eq':
    default: return actual === condition.expected;
  }
};

export const shouldRetryReplayResponse = (response, retry = {}, attempt = 1) => {
  const maxAttempts = Math.max(1, Number(retry.maxAttempts) || 1);
  if (attempt >= maxAttempts) return false;
  if (!response || response.isError || response.status === 'Error') return retry.onNetworkError !== false;
  const statuses = Array.isArray(retry.onStatuses) ? retry.onStatuses : [429, 500, 502, 503, 504];
  return statuses.includes(Number(response.status));
};

export const replayBackoffDelay = (retry = {}, attempt = 1) => {
  const base = Math.max(0, Number(retry.backoffMs) || 500);
  const mode = retry.backoff || 'exponential';
  const delay = mode === 'fixed' ? base : base * (2 ** Math.max(0, attempt - 1));
  return Math.min(Math.max(0, Number(retry.maxBackoffMs) || 10000), delay);
};
