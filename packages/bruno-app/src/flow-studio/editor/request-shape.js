const ROOT_PATH = String.fromCharCode(36);
const requestFrom = (itemOrRequest) => itemOrRequest?.draft?.request || itemOrRequest?.request || itemOrRequest || {};

export const parseRequestBody = (body) => {
  if (body === undefined || body === null) return null;
  if (typeof body !== 'object') return body;
  if (body.mode === 'json') {
    if (typeof body.json === 'string') {
      const trimmed = body.json.trim();
      if (!trimmed) return null;
      try {
        return JSON.parse(trimmed);
      } catch (_) {
        return body.json;
      }
    }
    return body.json ?? null;
  }
  return body;
};

const enabledEntries = (entries = [], type = null) => (Array.isArray(entries) ? entries : [])
  .filter((entry) => entry && entry.enabled !== false && (entry.name || entry.key))
  .filter((entry) => !type || (type === 'query' ? entry.type !== 'path' : entry.type === type))
  .map((entry) => ({
    name: String(entry.name || entry.key),
    value: entry.value,
    type: entry.type || type || 'query'
  }));

export const flattenRequestValue = (value, prefix = '') => {
  if (value === null || value === undefined || typeof value !== 'object') {
    return [{ key: prefix || '$', value }];
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return [{ key: prefix || '$', value }];
  return entries.flatMap(([key, child]) => {
    const childPath = Array.isArray(value)
      ? `${prefix || '$'}[${key}]`
      : (prefix ? `${prefix}.${key}` : key);
    return flattenRequestValue(child, childPath);
  });
};

export const describeRequest = (itemOrRequest) => {
  const request = requestFrom(itemOrRequest);
  const body = parseRequestBody(request.body);
  return {
    method: request.method || request.methodType || null,
    url: request.url || request.endpoint || '',
    pathParams: enabledEntries(request.params, 'path'),
    query: enabledEntries(request.params, 'query'),
    headers: enabledEntries(request.headers).map((entry) => ({ ...entry, type: 'header' })),
    body,
    bodyFields: body === null || body === undefined
      ? []
      : [{ key: ROOT_PATH, value: body }, ...flattenRequestValue(body).filter((field) => field.key !== ROOT_PATH)],
    auth: request.auth || request.authMode || null,
    scripts: {
      preRequest: request.script?.req || request.script?.preRequest || request.preRequestScript || null,
      postResponse: request.script?.res || request.script?.postResponse || request.postResponseScript || null
    },
    tests: request.tests || request.assertions || null
  };
};

export const requestFieldCount = (shape) => (
  (shape?.pathParams?.length || 0)
  + (shape?.query?.length || 0)
  + (shape?.headers?.length || 0)
  + (shape?.bodyFields?.length || 0)
);

export const formatRequestValue = (value) => {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (_) {
    return String(value);
  }
};

export const parseEditedRequestValue = (text, originalValue) => {
  if (typeof originalValue === 'string') return text;
  const trimmed = String(text).trim();
  if (!trimmed) return typeof originalValue === 'number' ? 0 : '';
  try {
    return JSON.parse(trimmed);
  } catch (_) {
    return text;
  }
};
