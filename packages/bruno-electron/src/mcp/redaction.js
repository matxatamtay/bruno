const REDACTED = '[REDACTED]';
const SENSITIVE_KEY = /(^|[-_.])(authorization|proxy[-_.]?authorization|cookie|set[-_.]?cookie|password|passwd|secret|token|access[-_.]?token|refresh[-_.]?token|api[-_.]?key|client[-_.]?secret|private[-_.]?key|credential|session)([-_.]|$)/i;
const RAW_KEY = /^(raw|rawBody|rawResponse|resolvedSecret|resolvedSecrets|environmentValues)$/i;

const replaceKnownSecrets = (value, secrets) => {
  let output = String(value);
  for (const secret of secrets) {
    if (!secret || secret.length < 3) continue;
    output = output.split(secret).join(REDACTED);
  }
  return output;
};

const looksLikeSensitiveNamedEntry = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const name = value.name ?? value.key ?? value.header ?? value.variable;
  return typeof name === 'string' && SENSITIVE_KEY.test(name);
};

const redactMcpValue = (value, options = {}, key = '', depth = 0, seen = new WeakSet()) => {
  const secrets = Array.isArray(options.secrets) ? options.secrets.filter((entry) => typeof entry === 'string') : [];
  if (SENSITIVE_KEY.test(key) || RAW_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') return replaceKnownSecrets(value, secrets);
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (depth >= (options.maxDepth || 12)) return '[TRUNCATED]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    const maxItems = options.maxArrayItems || 500;
    const projected = value.slice(0, maxItems).map((entry) => redactMcpValue(entry, options, key, depth + 1, seen));
    if (value.length > maxItems) projected.push(`[TRUNCATED ${value.length - maxItems} ITEMS]`);
    return projected;
  }

  const sensitiveEntry = looksLikeSensitiveNamedEntry(value);
  const projected = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    if (sensitiveEntry && ['value', 'content', 'defaultValue'].includes(childKey)) {
      projected[childKey] = REDACTED;
      continue;
    }
    projected[childKey] = redactMcpValue(childValue, options, childKey, depth + 1, seen);
  }
  return projected;
};

const safeMcpError = (error, options = {}) => ({
  code: error?.code || 'BRUNO_MCP_ERROR',
  message: redactMcpValue(error?.message || String(error), options),
  ...(error?.nodeId ? { nodeId: error.nodeId } : {})
});

const summarizeMcpArgs = (value, key = '', depth = 0, seen = new WeakSet()) => {
  if (SENSITIVE_KEY.test(key) || RAW_KEY.test(key)) return REDACTED;
  if (value === null) return null;
  if (value === undefined) return '[UNDEFINED]';
  if (typeof value === 'string') {
    if (/(^|_)(uid|id|revision|path|pathname|mode|profile|op)$/i.test(key)) return value.slice(0, 512);
    return `[STRING:${value.length}]`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value !== 'object') return `[${typeof value}]`;
  if (depth >= 6) return '[TRUNCATED]';
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      sample: value.slice(0, 5).map((entry) => summarizeMcpArgs(entry, key, depth + 1, seen))
    };
  }
  return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
    childKey,
    summarizeMcpArgs(childValue, childKey, depth + 1, seen)
  ]));
};

module.exports = {
  REDACTED,
  SENSITIVE_KEY,
  redactMcpValue,
  safeMcpError,
  summarizeMcpArgs
};
