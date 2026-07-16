const crypto = require('crypto');
const { inferSchema, mergeSchemas, compareSchema, schemaFingerprint } = require('./schema');

const normalizeHeaders = (headers) => {
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers
      .filter((header) => header && header.name)
      .map((header) => [String(header.name).toLowerCase(), String(header.value ?? '')]));
  }
  if (headers && typeof headers === 'object') {
    return Object.fromEntries(Object.entries(headers)
      .map(([name, value]) => [String(name).toLowerCase(), Array.isArray(value) ? value.join(', ') : String(value ?? '')]));
  }
  return {};
};

const contentTypeFromResponse = (response = {}) => normalizeHeaders(response.headers)['content-type']?.split(';')[0]?.trim().toLowerCase() || null;

const looksLikeJson = (value) => {
  const trimmed = String(value || '').trim();
  return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
};

const responseBodyForSchema = (response = {}) => {
  const data = response.data;
  if (data === undefined) return null;
  if (typeof data !== 'string') return data;
  const contentType = contentTypeFromResponse(response);
  if (contentType?.includes('json') || looksLikeJson(data)) {
    try { return JSON.parse(data); } catch { return data; }
  }
  return data;
};

const isSuccessStatus = (status) => Number(status) >= 200 && Number(status) < 400;

const createContractFromResponse = ({ requestRef, response, source = 'single-run', environmentScope = 'all', environmentKey = null }) => {
  const status = Number(response?.status);
  if (!Number.isInteger(status)) throw new Error('A completed HTTP response is required to accept a contract');
  const schema = inferSchema(responseBodyForSchema(response));
  const contentType = contentTypeFromResponse(response);
  const acceptedAt = new Date().toISOString();

  return {
    id: crypto.randomUUID(),
    format: 'bruno-api-contract',
    schemaVersion: 1,
    requestRef,
    environmentScope,
    environmentKey: environmentScope === 'environment-specific' ? environmentKey : null,
    source,
    acceptedAt,
    updatedAt: acceptedAt,
    sampleCount: 1,
    responseContracts: {
      [String(status)]: {
        contentTypes: contentType ? [contentType] : [],
        schema,
        schemaFingerprint: schemaFingerprint(schema),
        durationBudget: Number.isFinite(Number(response?.duration)) && Number(response.duration) > 0
          ? { max: Math.max(Number(response.duration) * 2, Number(response.duration) + 500) }
          : null
      }
    }
  };
};

const percentile = (values, ratio) => {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
};

const createContractFromObservations = ({ requestRef, observations = [], environmentScope = 'all', environmentKey = null }) => {
  const scopedObservations = environmentScope === 'environment-specific'
    ? observations.filter((observation) => observation.environmentKey === environmentKey)
    : observations;
  const completed = scopedObservations.filter((observation) => Number.isInteger(Number(observation?.response?.status)) && observation?.response?.schema);
  if (!completed.length) throw new Error('At least one completed observation is required');

  const grouped = completed.reduce((accumulator, observation) => {
    const status = String(Number(observation.response.status));
    accumulator[status] = [...(accumulator[status] || []), observation];
    return accumulator;
  }, {});

  const responseContracts = Object.fromEntries(Object.entries(grouped).map(([status, samples]) => {
    const schema = samples.map((sample) => sample.response.schema).reduce(mergeSchemas);
    const durations = samples.map((sample) => Number(sample.response.duration)).filter(Number.isFinite);
    return [status, {
      contentTypes: [...new Set(samples.map((sample) => sample.response.contentType).filter(Boolean))].sort(),
      schema,
      schemaFingerprint: schemaFingerprint(schema),
      durationBudget: durations.length ? {
        p50: percentile(durations, 0.5),
        p95: percentile(durations, 0.95),
        max: Math.max(percentile(durations, 0.95) * 1.5, Math.max(...durations) + 100)
      } : null,
      sampleCount: samples.length
    }];
  }));

  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    format: 'bruno-api-contract',
    schemaVersion: 1,
    requestRef,
    environmentScope,
    environmentKey: environmentScope === 'environment-specific' ? environmentKey : null,
    source: 'historical-observations',
    acceptedAt: now,
    updatedAt: now,
    sampleCount: completed.length,
    responseContracts
  };
};

const requiredPaths = (schema, prefix = '$') => {
  if (!schema || schema.type !== 'object') return [];
  return (schema.required || []).flatMap((key) => {
    const fieldPath = `${prefix}.${key}`;
    return [fieldPath, ...requiredPaths(schema.properties?.[key], fieldPath)];
  });
};

const generateAssertionsFromContract = (contract) => {
  if (!contract) return [];
  const statuses = Object.keys(contract.responseContracts || {}).map(Number).filter(Number.isInteger);
  const assertions = [];
  if (statuses.length === 1) assertions.push({ type: 'status', operator: 'eq', expected: statuses[0], enabled: true });

  for (const [status, responseContract] of Object.entries(contract.responseContracts || {})) {
    requiredPaths(responseContract.schema).forEach((fieldPath) => assertions.push({
      type: 'json-path-exists',
      path: fieldPath.replace(/^\$\./, ''),
      enabled: true,
      status: Number(status)
    }));
    if (responseContract.durationBudget?.max) {
      assertions.push({
        type: 'response-time',
        operator: 'lt',
        expected: Math.ceil(responseContract.durationBudget.max),
        enabled: true,
        status: Number(status)
      });
    }
  }
  return assertions;
};

const summarize = (findings) => ({
  breaking: findings.filter((item) => item.severity === 'breaking').length,
  warnings: findings.filter((item) => item.severity === 'warning').length,
  nonBreaking: findings.filter((item) => item.severity === 'non-breaking').length
});

const compareContractWithActual = (contract, actual = {}) => {
  if (!contract) return null;
  const status = Number(actual.status);
  if (!Number.isInteger(status)) return { status: 'unavailable', findings: [], summary: summarize([]), suppressed: 0 };

  const findings = [];
  const responseContracts = contract.responseContracts || {};
  const expected = responseContracts[String(status)];

  if (!expected) {
    const acceptedStatuses = Object.keys(responseContracts).map(Number).filter(Number.isInteger);
    const hadSuccessfulStatus = acceptedStatuses.some(isSuccessStatus);
    const severity = hadSuccessfulStatus && !isSuccessStatus(status) ? 'breaking' : 'warning';
    findings.push({
      severity,
      ruleId: 'unknown-response-status',
      path: 'response.status',
      message: `Observed undocumented response status ${status}`,
      expected: acceptedStatuses.join(', ') || 'none',
      actual: status
    });
  } else {
    const actualContentType = actual.contentType || null;
    if (expected.contentTypes?.length && actualContentType && !expected.contentTypes.includes(actualContentType)) {
      findings.push({
        severity: 'breaking',
        ruleId: 'content-type-changed',
        path: 'response.headers.content-type',
        message: `Content-Type changed from ${expected.contentTypes.join(', ')} to ${actualContentType}`,
        expected: expected.contentTypes.join(', '),
        actual: actualContentType
      });
    }
    findings.push(...compareSchema(expected.schema, actual.schema || { type: 'unknown' }));
    const actualDuration = Number(actual.duration);
    if (expected.durationBudget?.max && Number.isFinite(actualDuration) && actualDuration > expected.durationBudget.max) {
      findings.push({
        severity: 'warning',
        ruleId: 'duration-budget-exceeded',
        path: 'response.duration',
        message: `Response duration ${actualDuration}ms exceeded the local budget of ${expected.durationBudget.max}ms`,
        expected: expected.durationBudget.max,
        actual: actualDuration
      });
    }
  }

  const ignoredPaths = contract.ignoredPaths || [];
  const visibleFindings = findings.filter((item) => !ignoredPaths.some((ignored) => (
    item.path === ignored || item.path.startsWith(`${ignored}.`) || item.path.startsWith(`${ignored}[`)
  )));
  const summary = summarize(visibleFindings);
  const comparisonStatus = summary.breaking
    ? 'breaking'
    : summary.warnings
      ? 'warning'
      : summary.nonBreaking
        ? 'changed'
        : 'pass';

  return {
    status: comparisonStatus,
    actualStatus: status,
    findings: visibleFindings,
    summary,
    suppressed: findings.length - visibleFindings.length
  };
};

const compareContractWithResponse = (contract, response) => compareContractWithActual(contract, {
  status: response?.status,
  contentType: contentTypeFromResponse(response),
  schema: inferSchema(responseBodyForSchema(response)),
  duration: response?.duration
});

const compareContractWithObservation = (contract, observation) => compareContractWithActual(contract, observation?.response || observation);

module.exports = {
  normalizeHeaders,
  contentTypeFromResponse,
  responseBodyForSchema,
  createContractFromResponse,
  createContractFromObservations,
  generateAssertionsFromContract,
  compareContractWithResponse,
  compareContractWithObservation
};
