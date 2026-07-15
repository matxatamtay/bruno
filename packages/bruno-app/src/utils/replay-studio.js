import get from 'lodash/get';
import set from 'lodash/set';

export const replayResponseData = (response) => {
  const value = response?.data ?? response?.body ?? response?.response?.data ?? null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
};

export const replaySchema = (value) => {
  if (Array.isArray(value)) return { type: 'array', items: value.length ? replaySchema(value[0]) : null };
  if (value && typeof value === 'object') {
    return {
      type: 'object',
      properties: Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replaySchema(child)]))
    };
  }
  return { type: value === null ? 'null' : typeof value };
};

export const replayFingerprint = (value) => {
  const text = JSON.stringify(value ?? null);
  let hashValue = 5381;
  for (let index = 0; index < text.length; index += 1) hashValue = ((hashValue << 5) + hashValue) ^ text.charCodeAt(index);
  return (hashValue >>> 0).toString(16);
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
