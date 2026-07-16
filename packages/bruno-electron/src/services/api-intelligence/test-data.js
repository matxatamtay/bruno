const crypto = require('crypto');

const hashSeed = (seed) => {
  const digest = crypto.createHash('sha256').update(String(seed || 'bruno')).digest();
  return digest.readUInt32LE(0);
};

const seededRandom = (seed) => {
  let state = hashSeed(seed) || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const randomString = (random, length = 12) => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join('');
};

const uuidFromRandom = (random) => {
  const bytes = Array.from({ length: 16 }, () => Math.floor(random() * 256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const resolveTemplate = (template, variables) => String(template || '').replace(/{{\s*([^}]+)\s*}}/g, (match, key) => variables[key.trim()] ?? match);

const generateValue = (generator, context) => {
  const { random, variables, sequence } = context;
  const options = generator.options || {};
  switch (generator.type) {
    case 'uuid': return uuidFromRandom(random);
    case 'timestamp': return context.now.getTime();
    case 'isoTimestamp': return context.now.toISOString();
    case 'randomInt': {
      const min = Number(options.min ?? 0);
      const max = Number(options.max ?? 1000000);
      return Math.floor(random() * (max - min + 1)) + min;
    }
    case 'randomEmail': return `${options.prefix || 'replay'}+${randomString(random, 10).toLowerCase()}@${options.domain || 'example.com'}`;
    case 'randomName': {
      const first = ['Ada', 'Grace', 'Linus', 'Margaret', 'Alan', 'Katherine', 'Donald', 'Barbara'];
      const last = ['Lovelace', 'Hopper', 'Torvalds', 'Hamilton', 'Turing', 'Johnson', 'Knuth', 'Liskov'];
      return `${first[Math.floor(random() * first.length)]} ${last[Math.floor(random() * last.length)]}`;
    }
    case 'randomPhone': return `+1${Math.floor(2000000000 + random() * 7999999999)}`;
    case 'randomString': return randomString(random, Number(options.length || 12));
    case 'dateOffset': {
      const date = new Date(context.now);
      date.setUTCDate(date.getUTCDate() + Number(options.days || 0));
      return options.format === 'date' ? date.toISOString().slice(0, 10) : date.toISOString();
    }
    case 'sequence': return Number(options.start || 1) + sequence;
    case 'pick': {
      const values = Array.isArray(options.values) ? options.values : [];
      return values.length ? values[Math.floor(random() * values.length)] : null;
    }
    case 'regex': {
      const pattern = String(options.pattern || '[A-Z]{3}-[0-9]{4}');
      return pattern.replace(/\[A-Z\]\{(\d+)\}/g, (match, count) => randomString(random, Number(count)).replace(/[^A-Za-z]/g, 'A').slice(0, Number(count)).toUpperCase())
        .replace(/\[0-9\]\{(\d+)\}/g, (match, count) => Array.from({ length: Number(count) }, () => Math.floor(random() * 10)).join(''));
    }
    case 'template': return resolveTemplate(options.template || generator.template, variables);
    default: return options.value ?? null;
  }
};

const materializeProfile = ({ profile, datasetIndex = null, seed = null, now = new Date() }) => {
  const effectiveSeed = seed || profile.seed || `run-${now.toISOString()}`;
  const random = seededRandom(effectiveSeed);
  const datasets = profile.datasets || [];
  const dataset = datasets.find((candidate) => candidate.id === profile.activeDatasetId) || datasets[0] || null;
  const rows = dataset?.rows || [];
  const selectedIndex = datasetIndex == null
    ? (profile.datasetMode === 'random' && rows.length ? Math.floor(random() * rows.length) : 0)
    : Math.max(0, Math.min(rows.length - 1, Number(datasetIndex)));
  const variables = { ...(rows[selectedIndex] || {}) };
  const generators = Object.entries(profile.generators || {});
  generators.forEach(([name, generator], sequence) => {
    variables[name] = generateValue(generator, { random, variables, sequence, now });
  });
  generators.filter(([, generator]) => generator.type === 'template').forEach(([name, generator]) => {
    variables[name] = generateValue(generator, { random, variables, sequence: 0, now });
  });
  return {
    format: 'bruno-test-data-materialization',
    schemaVersion: 1,
    profileId: profile.profileId,
    profileName: profile.name,
    seed: effectiveSeed,
    datasetId: dataset?.id || null,
    datasetIndex: rows.length ? selectedIndex : null,
    variables,
    setupSteps: profile.setupSteps || [],
    cleanupSteps: profile.cleanupSteps || [],
    files: profile.files || []
  };
};

const parseCsv = (text = '') => {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text).replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += character;
  }
  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);
  if (!rows.length) return [];
  const headers = rows[0].map((header, index) => header.trim() || `column${index + 1}`);
  return rows.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ''])));
};

const serializeCsv = (rows = []) => {
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row || {})))];
  const escape = (value) => {
    const text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.map(escape).join(','), ...rows.map((row) => headers.map((header) => escape(row?.[header])).join(','))].join('\n');
};

module.exports = { seededRandom, generateValue, materializeProfile, resolveTemplate, parseCsv, serializeCsv };
