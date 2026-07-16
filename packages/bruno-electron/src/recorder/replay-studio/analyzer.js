const crypto = require('crypto');
const { uuid } = require('../../utils/common');
const { requestFingerprint } = require('./store');
const { matchCollectionRequest } = require('../matcher');
const { inferSchema, schemaFingerprint } = require('../../services/api-intelligence/schema');
const { contentTypeFromResponse } = require('../../services/api-intelligence/contracts');

const STATIC_EXTENSION = /\.(?:png|jpe?g|gif|svg|ico|css|woff2?|ttf|map)(?:\?|$)/i;
const NOISE_HOST = /(?:google-analytics|googletagmanager|segment\.io|sentry|doubleclick|hotjar|amplitude)/i;
const SECRET_KEY = /token|secret|password|authorization|cookie|session/i;
const ID_KEY = /(^|_)(id|uuid)$|Id$|ID$/;
const parseJson = (value) => {
  if (value && typeof value === 'object') return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try { return JSON.parse(value); } catch { return null; }
};
const normalizeUrl = (rawUrl = '') => {
  try {
    const url = new URL(rawUrl);
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, ':id').replace(/\/\d+(?=\/|$)/g, '/:id');
    return `${url.origin}${url.pathname}?${[...url.searchParams.keys()].join('&')}`.replace(/\?$/, '');
  } catch { return rawUrl; }
};
const flattenPrimitives = (value, prefix = '', output = []) => {
  if (Array.isArray(value)) value.forEach((item, index) => flattenPrimitives(item, `${prefix}[${index}]`, output));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, child]) => flattenPrimitives(child, prefix ? `${prefix}.${key}` : key, output));
  else if (['string', 'number', 'boolean'].includes(typeof value)) output.push({ path: prefix, value });
  return output;
};
const collectRequestStrings = (exchange) => {
  const data = exchange.request || {};
  const values = [{ path: 'url', value: data.url || '' }];
  Object.entries(data.headers || {}).forEach(([key, value]) => values.push({ path: `headers.${key}`, value: String(value) }));
  flattenPrimitives(parseJson(data.body), 'body', values);
  return values;
};
const usableDependencyValue = (value) => {
  const text = String(value ?? '');
  return text && text !== '<redacted>' && text.length >= 5 && text.length <= 512 && !/^(true|false|null|undefined|pending|success|ok)$/i.test(text);
};
const variableNameFor = (sourcePath, index) => {
  const key = sourcePath.split(/[.\[\]]/).filter(Boolean).pop() || `value${index + 1}`;
  if (/access.?token/i.test(key)) return 'accessToken';
  if (/refresh.?token/i.test(key)) return 'refreshToken';
  if (ID_KEY.test(key)) return key === 'id' ? `step${index + 1}Id` : key;
  return key.replace(/[^A-Za-z0-9_]/g, '') || `step${index + 1}Value`;
};
const pairExchanges = (events = []) => {
  const requests = new Map();
  const responses = new Map();
  const failures = new Map();
  events.forEach((event) => {
    const requestId = event.data?.requestId;
    if (!requestId) return;
    if (event.type === 'network-request') requests.set(requestId, event);
    if (event.type === 'network-response') responses.set(requestId, event);
    if (event.type === 'network-failed') failures.set(requestId, event);
  });
  return [...requests.entries()].map(([requestId, requestEvent]) => {
    const responseEvent = responses.get(requestId);
    const failureEvent = failures.get(requestId);
    return {
      id: requestId,
      timestamp: requestEvent.timestamp,
      actionId: requestEvent.actionId || null,
      request: requestEvent.data || {},
      response: responseEvent?.data || null,
      failure: failureEvent?.data || null,
      duration: responseEvent?.data?.duration ?? null,
      match: requestEvent.data?.match || responseEvent?.data?.match || null
    };
  }).sort((a, b) => a.timestamp - b.timestamp);
};
const isNoise = (exchange) => {
  const { request } = exchange;
  if (!request?.url || request.method === 'OPTIONS') return true;
  if (STATIC_EXTENSION.test(request.url) || NOISE_HOST.test(request.url)) return true;
  if (['Image', 'Stylesheet', 'Font', 'Media'].includes(request.resourceType)) return true;
  return false;
};
const classifyExchange = (exchange, repeatedCount = 1) => {
  const url = String(exchange.request.url || '').toLowerCase();
  const method = String(exchange.request.method || 'GET').toUpperCase();
  const body = String(exchange.request.body || '').toLowerCase();
  const headers = Object.fromEntries(Object.entries(exchange.request.headers || {}).map(([key, value]) => [key.toLowerCase(), String(value).toLowerCase()]));
  if (/\/refresh|refresh_token|grant_type=refresh_token/.test(`${url} ${body}`)) return { role: 'refresh-token', confidence: 'high' };
  if (/\/login|\/signin|\/auth|\/token|\/session/.test(url) || /password|username|email/.test(body)) return { role: 'authentication', confidence: 'medium' };
  if (/multipart\/form-data/.test(headers['content-type'] || '') || /upload|attachment|receipt|file/.test(url)) return { role: 'upload', confidence: 'high' };
  if (repeatedCount >= 3 && method === 'GET') return { role: 'polling', confidence: 'high' };
  if (exchange.failure || Number(exchange.response?.status) >= 500 || Number(exchange.response?.status) === 429) return { role: 'retry-candidate', confidence: 'medium' };
  return { role: 'api', confidence: 'medium' };
};
const inferPollingCondition = (group = []) => {
  if (group.length < 2) return null;
  const first = parseJson(group[0].response?.body);
  const last = parseJson(group[group.length - 1].response?.body);
  if (!first || !last) return null;
  const firstValues = new Map(flattenPrimitives(first).map((entry) => [entry.path, entry.value]));
  const changed = flattenPrimitives(last).find((entry) => firstValues.has(entry.path)
    && firstValues.get(entry.path) !== entry.value
    && ['string', 'number', 'boolean'].includes(typeof entry.value));
  return changed ? { path: `body.${changed.path}`, operator: 'eq', expected: changed.value } : null;
};

const observationFromExchange = (exchange) => {
  const status = Number(exchange.response?.status);
  if (!Number.isInteger(status)) return null;
  const parsed = parseJson(exchange.response?.body);
  const schema = inferSchema(parsed ?? exchange.response?.body ?? null);
  return {
    status,
    duration: Number.isFinite(Number(exchange.duration)) ? Number(exchange.duration) : null,
    contentType: contentTypeFromResponse({ headers: exchange.response?.headers || {}, data: exchange.response?.body }),
    schema,
    fingerprint: schemaFingerprint(schema),
    timestamp: exchange.timestamp || null
  };
};

const inferAssertions = (exchange) => {
  const assertions = [];
  if (exchange.response?.status && Number(exchange.response.status) < 400) assertions.push({ type: 'status', operator: 'eq', expected: Number(exchange.response.status), enabled: true });
  if (exchange.duration != null) assertions.push({ type: 'response-time', operator: 'lt', expected: Math.min(30000, Math.max(1000, Math.round(exchange.duration * 2 + 500))), enabled: true });
  const json = parseJson(exchange.response?.body);
  if (json && typeof json === 'object' && !Array.isArray(json)) {
    Object.keys(json).slice(0, 12).forEach((key) => assertions.push({ type: 'json-path-exists', path: key, enabled: true }));
  }
  return assertions;
};
const buildLink = (exchange, requests = []) => {
  const recordedMatch = exchange.match;
  if (recordedMatch?.itemUid) return { requestUid: recordedMatch.itemUid, pathHint: recordedMatch.pathname, confidence: recordedMatch.confidence || 'high', source: 'recorder-match' };
  const match = matchCollectionRequest(exchange.request, requests);
  if (match?.itemUid) return { requestUid: match.itemUid, pathHint: match.pathname, confidence: match.confidence, source: 'current-collection-match' };
  const candidate = requests.find((request) => String(request.method).toUpperCase() === String(exchange.request.method).toUpperCase() && normalizeUrl(request.url) === normalizeUrl(exchange.request.url));
  return candidate ? { requestUid: candidate.itemUid, pathHint: candidate.pathname, confidence: 'probable', source: 'fingerprint' } : null;
};
const analyzeRecording = ({ session, requests = [], name }) => {
  const allExchanges = pairExchanges(session.events || []);
  const exchanges = allExchanges.filter((exchange) => !isNoise(exchange));
  const counts = new Map();
  exchanges.forEach((exchange) => {
    const key = `${exchange.request.method}:${normalizeUrl(exchange.request.url)}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const steps = exchanges.map((exchange, index) => {
    const key = `${exchange.request.method}:${normalizeUrl(exchange.request.url)}`;
    const classification = classifyExchange(exchange, counts.get(key));
    return {
      id: uuid(),
      name: exchange.match?.name || `${String(exchange.request.method || 'GET').toUpperCase()} ${(() => { try { return new URL(exchange.request.url).pathname; } catch { return exchange.request.url; } })()}`,
      order: index + 1,
      enabled: true,
      role: classification.role,
      confidence: classification.confidence,
      source: { sessionId: session.manifest.id, requestId: exchange.id, actionId: exchange.actionId },
      link: buildLink(exchange, requests),
      requestHint: {
        method: String(exchange.request.method || 'GET').toUpperCase(),
        url: exchange.request.url,
        fingerprint: requestFingerprint({ request: { method: exchange.request.method, url: exchange.request.url, headers: Object.entries(exchange.request.headers || {}).map(([name, value]) => ({ name, value, enabled: true })), body: { mode: parseJson(exchange.request.body) ? 'json' : exchange.request.body ? 'text' : 'none', json: parseJson(exchange.request.body) ? JSON.stringify(parseJson(exchange.request.body)) : '' } } })
      },
      overrides: {},
      extracts: [],
      assertions: inferAssertions(exchange),
      observation: observationFromExchange(exchange),
      replay: classification.role === 'polling'
        ? { polling: { intervalMs: 2000, maxAttempts: Math.max(3, counts.get(key)), untilStatus: exchange.response?.status || 200 } }
        : classification.role === 'retry-candidate'
          ? { retry: { maxAttempts: 3, backoff: 'exponential', backoffMs: 500, maxBackoffMs: 10000, onStatuses: [429, 500, 502, 503, 504], onNetworkError: true } }
          : {}
    };
  });
  const variableNames = new Set();
  const addDependency = ({ producerIndex, consumerIndex, sourcePath, targetPath, value, sensitive = false }) => {
    let variable = variableNameFor(sourcePath.replace(/^body\./, ''), producerIndex);
    let suffix = 2;
    const base = variable;
    while (variableNames.has(variable)) variable = `${base}${suffix++}`;
    variableNames.add(variable);
    if (!steps[producerIndex].extracts.some((entry) => entry.variable === variable || entry.sourcePath === sourcePath)) {
      steps[producerIndex].extracts.push({ variable, sourcePath, sensitivity: sensitive ? 'secret' : 'normal', confidence: 'high' });
    }
    steps[consumerIndex].overrides.bindings = [...(steps[consumerIndex].overrides.bindings || []), { variable, targetPath, originalValue: sensitive ? '<redacted>' : value }];
  };
  for (let producerIndex = 0; producerIndex < exchanges.length; producerIndex += 1) {
    const responseJson = parseJson(exchanges[producerIndex].response?.body);
    if (!responseJson) continue;
    const outputs = flattenPrimitives(responseJson).filter((entry) => usableDependencyValue(entry.value));
    for (let consumerIndex = producerIndex + 1; consumerIndex < exchanges.length; consumerIndex += 1) {
      const targets = collectRequestStrings(exchanges[consumerIndex]);
      outputs.forEach((output, outputIndex) => {
        const target = targets.find((candidate) => String(candidate.value).includes(String(output.value)));
        if (!target) return;
        addDependency({ producerIndex, consumerIndex, sourcePath: `body.${output.path}`, targetPath: target.path, value: output.value, sensitive: SECRET_KEY.test(output.path) });
      });
    }
  }
  for (let producerIndex = 0; producerIndex < exchanges.length; producerIndex += 1) {
    const producerFingerprints = exchanges[producerIndex].response?.sensitiveFingerprints || [];
    for (let consumerIndex = producerIndex + 1; consumerIndex < exchanges.length; consumerIndex += 1) {
      const consumerFingerprints = exchanges[consumerIndex].request?.sensitiveFingerprints || [];
      producerFingerprints.forEach((producer) => {
        const consumer = consumerFingerprints.find((candidate) => candidate.fingerprint === producer.fingerprint);
        if (!consumer) return;
        addDependency({ producerIndex, consumerIndex, sourcePath: producer.path, targetPath: consumer.path, value: '<redacted>', sensitive: true });
      });
    }
  }

  const pollingCollapsed = [];
  const seenPolling = new Set();
  steps.forEach((step, index) => {
    if (step.role !== 'polling') return pollingCollapsed.push(step);
    const key = `${step.requestHint.method}:${normalizeUrl(step.requestHint.url)}`;
    if (seenPolling.has(key)) return;
    seenPolling.add(key);
    const group = steps.filter((candidate) => candidate.role === 'polling' && `${candidate.requestHint.method}:${normalizeUrl(candidate.requestHint.url)}` === key);
    const exchangeGroup = exchanges.filter((exchange) => `${exchange.request.method}:${normalizeUrl(exchange.request.url)}` === key);
    const until = inferPollingCondition(exchangeGroup);
    pollingCollapsed.push({
      ...step,
      name: `${step.name} (poll until complete)`,
      source: { ...step.source, requestIds: group.map((item) => item.source.requestId) },
      observation: group[group.length - 1]?.observation || step.observation,
      sourceObservations: group.map((item) => item.observation).filter(Boolean),
      replay: {
        ...step.replay,
        polling: {
          ...step.replay.polling,
          ...(until ? { until, untilStatus: undefined } : {})
        }
      }
    });
  });
  return {
    id: uuid(),
    format: 'bruno-replay-studio',
    schemaVersion: 1,
    name: name || session.manifest.name || 'Recorded scenario',
    description: `Generated from Web Recorder session ${session.manifest.name || session.manifest.id}`,
    sourceSessionId: session.manifest.id,
    status: 'draft',
    variables: [...variableNames].map((variable) => ({ name: variable, scope: 'scenario' })),
    steps: pollingCollapsed.map((step, index) => ({ ...step, order: index + 1 })),
    analysis: { totalExchanges: allExchanges.length, includedExchanges: exchanges.length, ignoredExchanges: allExchanges.length - exchanges.length, generatedAt: new Date().toISOString() }
  };
};

module.exports = { pairExchanges, isNoise, classifyExchange, analyzeRecording, normalizeUrl, flattenPrimitives };
