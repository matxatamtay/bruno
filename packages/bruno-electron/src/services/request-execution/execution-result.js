const SENSITIVE_KEY_PATTERN = /(^|[-_.])(authorization|cookie|set-cookie|password|passwd|secret|token|api[-_.]?key|client[-_.]?secret)([-_.]|$)/i;
const REDACTED = '[REDACTED]';
const MAX_REDACTION_DEPTH = 12;

const toPlainHeaders = (headers) => {
  if (!headers) return {};
  if (typeof headers.toJSON === 'function') return headers.toJSON();
  if (headers instanceof Map) return Object.fromEntries(headers);
  if (typeof headers === 'object') return { ...headers };
  return {};
};

const redactValue = (value, key = '', depth = 0, seen = new WeakSet()) => {
  if (SENSITIVE_KEY_PATTERN.test(key)) return REDACTED;
  if (value === null || value === undefined) return value;
  if (depth >= MAX_REDACTION_DEPTH) return '[TRUNCATED]';
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: redactValue(value.message, 'message', depth + 1, seen),
      code: value.code
    };
  }
  if (Buffer.isBuffer(value)) return `<Buffer ${value.length} bytes>`;
  if (value instanceof ArrayBuffer) return `<ArrayBuffer ${value.byteLength} bytes>`;
  if (ArrayBuffer.isView(value)) return `<${value.constructor.name} ${value.byteLength} bytes>`;
  if (typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';

  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => redactValue(entry, key, depth + 1, seen));
  }

  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    result[childKey] = redactValue(childValue, childKey, depth + 1, seen);
  }
  return result;
};

const redactHeaders = (headers) => {
  const result = {};
  for (const [key, value] of Object.entries(toPlainHeaders(headers))) {
    result[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redactValue(value, key);
  }
  return result;
};

const getItemRequest = (item) => item?.draft?.request || item?.request || {};

const createSafeResolvedRequest = ({ item, requestSent }) => {
  const fallback = getItemRequest(item);
  const source = requestSent || fallback;

  return {
    method: source.method || fallback.method || null,
    url: source.url || fallback.url || null,
    headers: redactHeaders(source.headers || fallback.headers),
    body: redactValue(source.data ?? fallback.data ?? fallback.body, 'body'),
    timestamp: source.timestamp || null
  };
};

const createSafeResponse = (legacyResult) => {
  if (!legacyResult || legacyResult.error === 'REQUEST_CANCELLED') return undefined;
  if (legacyResult.status === undefined && legacyResult.data === undefined) return undefined;

  return {
    status: legacyResult.status ?? null,
    statusText: legacyResult.statusText || null,
    headers: redactHeaders(legacyResult.headers),
    body: redactValue(legacyResult.data, 'body'),
    size: legacyResult.size ?? 0,
    durationMs: legacyResult.duration ?? 0,
    url: legacyResult.url || null,
    stream: legacyResult.stream ? { running: true } : undefined
  };
};

const createSafeError = (legacyResult, thrownError) => {
  const message = thrownError?.message || legacyResult?.error;
  if (!message) return undefined;

  return {
    name: thrownError?.name || 'RequestExecutionError',
    message: redactValue(String(message), 'message'),
    code: thrownError?.code || legacyResult?.statusText || undefined,
    status: thrownError?.status || legacyResult?.status || undefined
  };
};

const inferExecutionStatus = (legacyResult, thrownError, signal) => {
  if (legacyResult?.isCancel || legacyResult?.error === 'REQUEST_CANCELLED' || (!legacyResult && signal?.aborted)) return 'cancelled';
  if (legacyResult?.status === 'skipped') return 'skipped';
  if (thrownError || legacyResult?.error) return 'failed';
  return 'success';
};

const normalizeVariableChanges = (changes) => changes.map((change) => ({
  scope: change.scope,
  values: redactValue(change.values, change.scope)
}));

const normalizeExecutionResult = ({
  executionId,
  protocol,
  item,
  legacyResult,
  thrownError,
  signal,
  projection,
  durationMs
}) => {
  const status = inferExecutionStatus(legacyResult, thrownError, signal);
  const requestSent = projection?.requestSent || legacyResult?.requestSent;

  return {
    executionId,
    protocol,
    status,
    request: createSafeResolvedRequest({ item, requestSent }),
    response: createSafeResponse(legacyResult),
    assertions: cloneResults(projection?.assertions),
    tests: cloneResults(projection?.tests),
    timeline: cloneResults(legacyResult?.timeline),
    variableChanges: normalizeVariableChanges(projection?.variableChanges || []),
    warnings: cloneResults(projection?.warnings),
    durationMs,
    error: createSafeError(legacyResult, thrownError),
    control: { ...(projection?.control || {}) }
  };
};

function cloneResults(value) {
  return Array.isArray(value) ? value.map((entry) => redactValue(entry)) : [];
}

module.exports = {
  REDACTED,
  redactHeaders,
  redactValue,
  inferExecutionStatus,
  normalizeExecutionResult
};
