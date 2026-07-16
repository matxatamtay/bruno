const FORMAT_PATTERNS = [
  ['uuid', /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i],
  ['date-time', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/],
  ['email', /^[^\s@]+@[^\s@]+\.[^\s@]+$/],
  ['uri', /^[a-z][a-z0-9+.-]*:\/\//i]
];

const stableStringify = (value) => {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
};

const normalizeSchema = (schema) => {
  if (!schema || typeof schema !== 'object') return { type: 'unknown' };
  if (schema.type === 'object') {
    const properties = Object.fromEntries(Object.entries(schema.properties || {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, normalizeSchema(value)]));
    return { type: 'object', properties, required: [...new Set(schema.required || [])].sort() };
  }
  if (schema.type === 'array') return { type: 'array', items: normalizeSchema(schema.items) };
  if (schema.type === 'union') {
    const anyOf = (schema.anyOf || []).map(normalizeSchema);
    const unique = [...new Map(anyOf.map((candidate) => [stableStringify(candidate), candidate])).values()]
      .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)));
    return { type: 'union', anyOf: unique };
  }
  return schema.format ? { type: schema.type, format: schema.format } : { type: schema.type || 'unknown' };
};

const mergeSchemas = (left, right) => {
  const a = normalizeSchema(left);
  const b = normalizeSchema(right);
  if (stableStringify(a) === stableStringify(b)) return a;

  if (a.type === 'object' && b.type === 'object') {
    const keys = [...new Set([...Object.keys(a.properties || {}), ...Object.keys(b.properties || {})])].sort();
    const properties = {};
    for (const key of keys) {
      if (a.properties?.[key] && b.properties?.[key]) properties[key] = mergeSchemas(a.properties[key], b.properties[key]);
      else properties[key] = a.properties?.[key] || b.properties?.[key];
    }
    const required = (a.required || []).filter((key) => (b.required || []).includes(key));
    return normalizeSchema({ type: 'object', properties, required });
  }

  if (a.type === 'array' && b.type === 'array') {
    return normalizeSchema({ type: 'array', items: mergeSchemas(a.items, b.items) });
  }

  const candidates = [
    ...(a.type === 'union' ? a.anyOf : [a]),
    ...(b.type === 'union' ? b.anyOf : [b])
  ];
  return normalizeSchema({ type: 'union', anyOf: candidates });
};

const inferStringFormat = (value) => FORMAT_PATTERNS.find(([, pattern]) => pattern.test(value))?.[0] || null;

const inferSchema = (value) => {
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    const items = value.length
      ? value.map(inferSchema).reduce(mergeSchemas)
      : { type: 'unknown' };
    return normalizeSchema({ type: 'array', items });
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return { type: 'binary' };
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return normalizeSchema({
      type: 'object',
      properties: Object.fromEntries(keys.map((key) => [key, inferSchema(value[key])])),
      required: keys
    });
  }
  if (typeof value === 'number') return { type: Number.isInteger(value) ? 'integer' : 'number' };
  if (typeof value === 'string') {
    const format = inferStringFormat(value);
    return format ? { type: 'string', format } : { type: 'string' };
  }
  if (typeof value === 'boolean') return { type: 'boolean' };
  return { type: 'unknown' };
};

module.exports = { inferSchema, mergeSchemas, normalizeSchema, stableStringify };
