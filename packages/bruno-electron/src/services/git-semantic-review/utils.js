const get = require('lodash/get');

const enabledEntries = (entries = []) => (Array.isArray(entries) ? entries : [])
  .filter((entry) => entry && entry.enabled !== false)
  .map((entry) => ({ name: String(entry.name || '').trim(), value: entry.value, type: entry.type, enabled: true }))
  .filter((entry) => entry.name);

const entriesByName = (entries = []) => new Map(enabledEntries(entries).map((entry) => [entry.name.toLowerCase(), entry]));

const parseJsonBody = (item) => {
  const raw = get(item, 'request.body.json');
  if (raw && typeof raw === 'object') return raw;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try { return JSON.parse(raw); } catch (error) { return null; }
};

const flattenObject = (value, prefix = '', result = new Map()) => {
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenObject(item, `${prefix}[${index}]`, result));
  } else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, child]) => {
      const next = prefix ? `${prefix}.${key}` : key;
      result.set(next, child);
      flattenObject(child, next, result);
    });
  }
  return result;
};

const valueType = (value) => Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
const requestName = (item, fallback = '') => get(item, 'name') || get(item, 'meta.name') || fallback;

module.exports = { enabledEntries, entriesByName, parseJsonBody, flattenObject, valueType, requestName };
