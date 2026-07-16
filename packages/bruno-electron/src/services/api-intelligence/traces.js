const crypto = require('crypto');

const SECRET_KEY = /token|secret|password|authorization|cookie|session|api[-_]?key/i;

const sanitizeValue = (value, key = '', depth = 0) => {
  if (SECRET_KEY.test(key)) {
    return { display: '<redacted>', fingerprint: crypto.createHash('sha256').update(String(value ?? '')).digest('hex').slice(0, 16), changed: true };
  }
  if (depth > 8) return '<depth-limit>';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => sanitizeValue(item, key, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 200).map(([childKey, child]) => [childKey, sanitizeValue(child, childKey, depth + 1)]));
  }
  if (typeof value === 'string' && value.length > 4096) return `${value.slice(0, 4096)}…<truncated>`;
  return value;
};

const buildTraceFromRun = ({ scenario, run }) => ({
  format: 'bruno-time-travel-trace',
  schemaVersion: 1,
  traceId: run.traceId || crypto.randomUUID(),
  scenarioId: scenario?.id || run.scenarioId,
  scenarioName: scenario?.name || run.scenarioName,
  runId: run.id,
  environmentKey: run.environmentUid || run.environmentKey || null,
  startedAt: run.startedAt || run.createdAt,
  endedAt: run.endedAt || null,
  status: run.status,
  stateCompleteness: run.stateCompleteness || { status: 'partial', reasons: ['Cookies and external session state are not captured'] },
  initialVariables: sanitizeValue(run.initialVariables || {}),
  finalVariables: sanitizeValue(run.variables || {}),
  steps: (run.trace?.steps || run.steps || []).map((step) => sanitizeValue(step))
});

const firstDifference = (left, right, path = '$') => {
  if (Object.is(left, right)) return null;
  if (typeof left !== typeof right || left == null || right == null) return { path, left, right };
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return { path, left, right };
    const size = Math.max(left.length, right.length);
    for (let index = 0; index < size; index += 1) {
      const difference = firstDifference(left[index], right[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (typeof left === 'object') {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
    for (const key of keys) {
      const difference = firstDifference(left[key], right[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return { path, left, right };
};

const compareTraces = (left, right) => {
  if (!left || !right) return null;
  const stepIds = [...new Set([...(left.steps || []).map((step) => step.stepId), ...(right.steps || []).map((step) => step.stepId)])];
  const steps = stepIds.map((stepId) => {
    const before = (left.steps || []).find((step) => step.stepId === stepId) || null;
    const after = (right.steps || []).find((step) => step.stepId === stepId) || null;
    return {
      stepId,
      name: after?.name || before?.name || stepId,
      status: { left: before?.status || 'missing', right: after?.status || 'missing' },
      duration: { left: before?.duration ?? null, right: after?.duration ?? null },
      firstDifference: firstDifference(before, after)
    };
  });
  return {
    leftTraceId: left.traceId,
    rightTraceId: right.traceId,
    firstDivergence: steps.find((step) => step.firstDifference || step.status.left !== step.status.right) || null,
    steps
  };
};

module.exports = { sanitizeValue, buildTraceFromRun, compareTraces, firstDifference };
