const SENSITIVE_KEY = /(authorization|proxy-authorization|cookie|set-cookie|password|passwd|secret|token|api[-_]?key|access[-_]?key|client[-_]?secret|credit[-_]?card|card[-_]?number|cvv|cvc|otp|one[-_]?time[-_]?code)/i;
const STRUCTURED_COOKIE_KEY = /^(cookie|cookies|associatedCookies)$/i;
const MAX_STRING_LENGTH = 2 * 1024 * 1024;
const MAX_DEPTH = 12;

const truncateString = (value, limit = MAX_STRING_LENGTH) => {
  if (typeof value !== 'string' || value.length <= limit) return value;
  return `${value.slice(0, limit)}\n<... truncated ${value.length - limit} characters ...>`;
};

const redactUrl = (value) => {
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_KEY.test(key)) url.searchParams.set(key, '<redacted>');
    }
    return url.toString();
  } catch {
    return value;
  }
};

const redactStringPayload = (value, key, depth, seen) => {
  let next = value;
  if (/url$/i.test(key) || ['url', 'documentURL', 'frameUrl'].includes(key)) next = redactUrl(next);

  if (/^(body|postData|payload|data)$/i.test(key)) {
    try {
      const parsed = JSON.parse(next);
      next = JSON.stringify(sanitizeValue(parsed, key, depth + 1, seen));
    } catch {
      if (/^[^\n]*=/.test(next)) {
        try {
          const params = new URLSearchParams(next);
          for (const paramKey of [...params.keys()]) {
            if (SENSITIVE_KEY.test(paramKey)) params.set(paramKey, '<redacted>');
          }
          next = params.toString();
        } catch {}
      }
    }
  }

  next = next
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+=*/gi, '$1<redacted>')
    .replace(/(["']?(?:password|secret|token|api[-_]?key|client[-_]?secret)["']?\s*[:=]\s*["']?)([^&\s,"'}]+)/gi, '$1<redacted>');
  return truncateString(next);
};

const sanitizeValue = (value, key = '', depth = 0, seen = new WeakSet()) => {
  const structuredCookieContainer = STRUCTURED_COOKIE_KEY.test(key) && value && typeof value === 'object';
  if (SENSITIVE_KEY.test(key) && !structuredCookieContainer) return '<redacted>';
  if (value == null || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') return redactStringPayload(value, key, depth, seen);
  if (depth >= MAX_DEPTH) return '<max-depth>';
  if (Buffer.isBuffer(value)) return `<buffer ${value.length} bytes>`;
  if (Array.isArray(value)) {
    return value.slice(0, 5000).map((entry) => sanitizeValue(entry, key, depth + 1, seen));
  }
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '<circular>';
  seen.add(value);

  const output = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 5000)) {
    output[childKey] = sanitizeValue(childValue, childKey, depth + 1, seen);
  }
  return output;
};

const redactRecorderEvent = (event) => {
  const sanitized = sanitizeValue(event);
  if (sanitized?.data?.body && typeof sanitized.data.body === 'string') {
    sanitized.data.body = truncateString(sanitized.data.body);
  }
  if (sanitized?.type === 'cookie-checkpoint' && Array.isArray(sanitized.data?.cookies)) {
    sanitized.data.cookies = sanitized.data.cookies.map((cookie) => ({ ...cookie, value: '<redacted>' }));
  }
  if (sanitized?.type === 'network-request-extra' && Array.isArray(sanitized.data?.associatedCookies)) {
    sanitized.data.associatedCookies = sanitized.data.associatedCookies.map((entry) => {
      if (entry?.cookie) return { ...entry, cookie: { ...entry.cookie, value: '<redacted>' } };
      return entry ? { ...entry, value: '<redacted>' } : entry;
    });
  }
  if (sanitized?.type === 'storage-change' && SENSITIVE_KEY.test(sanitized.data?.key || '')) {
    if (sanitized.data.oldValue != null) sanitized.data.oldValue = '<redacted>';
    if (sanitized.data.newValue != null) sanitized.data.newValue = '<redacted>';
  }
  return sanitized;
};

module.exports = {
  SENSITIVE_KEY,
  redactRecorderEvent,
  sanitizeValue,
  redactUrl,
  truncateString
};
