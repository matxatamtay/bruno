const VARIABLE_EVENT_SCOPES = {
  'main:runtime-variables-update': 'runtime',
  'main:script-environment-update': 'environment',
  'main:global-environment-variables-update': 'global-environment',
  'main:collection-variables-update': 'collection'
};

const TEST_EVENT_PHASES = {
  'test-results-pre-request': 'pre-request',
  'test-results-post-response': 'post-response',
  'test-results': 'tests'
};

const cloneArray = (value) => Array.isArray(value) ? [...value] : [];

const createExecutionEventContext = ({
  forwardLegacyEvent = () => {},
  emitEvent = () => {},
  metadata = {}
} = {}) => {
  const projection = {
    requestSent: null,
    assertions: [],
    tests: [],
    variableChanges: [],
    warnings: [],
    control: {}
  };

  const emitLegacy = (channel, payload = {}) => {
    const scope = VARIABLE_EVENT_SCOPES[channel];
    if (scope) {
      const values = payload.runtimeVariables
        || payload.envVariables
        || payload.globalEnvironmentVariables
        || payload.collectionVariables;
      projection.variableChanges.push({ scope, values: values || {} });
    }

    if (channel === 'main:run-request-event') {
      if (payload.type === 'request-sent') {
        projection.requestSent = payload.requestSent || null;
      }

      const phase = TEST_EVENT_PHASES[payload.type];
      if (phase) {
        projection.tests.push(...cloneArray(payload.results).map((result) => ({ ...result, phase })));
      }

      if (payload.type === 'assertion-results') {
        projection.assertions.push(...cloneArray(payload.results));
      }
    }

    if (channel === 'main:display-error' && payload) {
      projection.warnings.push({ code: 'SCRIPT_VARIABLE_ERROR', message: String(payload) });
    }

    forwardLegacyEvent(channel, payload);
  };

  const onConsoleLog = (type, args) => {
    const consoleMethod = typeof console[type] === 'function' ? console[type] : console.log;
    consoleMethod(...args);
    emitLegacy('main:console-log', { type, args });
  };

  const recordControl = (control = {}) => {
    for (const [key, value] of Object.entries(control)) {
      if (value === undefined) continue;
      if (key === 'stopExecution' || key === 'skipRequest') {
        projection.control[key] = Boolean(projection.control[key] || value);
      } else {
        projection.control[key] = value;
      }
    }
  };

  const emit = (type, payload = {}) => {
    emitEvent({
      schemaVersion: 1,
      ...metadata,
      type,
      timestamp: new Date().toISOString(),
      payload
    });
  };

  const getProjection = () => ({
    requestSent: projection.requestSent,
    assertions: [...projection.assertions],
    tests: [...projection.tests],
    variableChanges: [...projection.variableChanges],
    warnings: [...projection.warnings],
    control: { ...projection.control }
  });

  return {
    emit,
    emitLegacy,
    onConsoleLog,
    recordControl,
    getProjection
  };
};

module.exports = {
  createExecutionEventContext
};
