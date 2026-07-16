const { buildRequestIdentity, resolveRequestReference, requestFingerprint } = require('./identity');

const REQUEST_TYPES = new Set(['http-request', 'graphql-request', 'grpc-request', 'ws-request']);
const FAILURE_VARIANTS = {
  400: 'validationFailure',
  401: 'authFailure',
  403: 'authFailure',
  404: 'notFound',
  409: 'conflict',
  429: 'rateLimit',
  500: 'serverFailure',
  502: 'serverFailure',
  503: 'serverFailure',
  504: 'serverFailure'
};

const percentage = (covered, total) => total ? Math.round((covered / total) * 100) : 0;

const contractForRequest = (contracts, request) => contracts.find((contract) => (
  resolveRequestReference(contract?.requestRef || {}, [request]).status === 'resolved'
)) || null;

const assertionDimensions = (steps = []) => {
  const dimensions = { status: false, schema: false, business: false, performance: false };
  for (const step of steps) {
    for (const assertion of step.assertions || []) {
      if (assertion.enabled === false) continue;
      if (assertion.type === 'status') dimensions.status = true;
      else if (assertion.type === 'response-time') dimensions.performance = true;
      else if (assertion.type === 'schema' || assertion.type === 'json-path-exists') dimensions.schema = true;
      else dimensions.business = true;
    }
  }
  return dimensions;
};

const failureVariants = (steps = [], runs = []) => {
  const variants = {
    success: false,
    authFailure: false,
    validationFailure: false,
    notFound: false,
    conflict: false,
    rateLimit: false,
    serverFailure: false
  };
  for (const step of steps) {
    const statusAssertions = (step.assertions || []).filter((assertion) => assertion.type === 'status' && assertion.enabled !== false);
    for (const assertion of statusAssertions) {
      const status = Number(assertion.expected);
      if (status >= 200 && status < 400) variants.success = true;
      if (FAILURE_VARIANTS[status]) variants[FAILURE_VARIANTS[status]] = true;
    }
    const presetStatus = Number(step.failurePreset?.status || step.mock?.status);
    if (FAILURE_VARIANTS[presetStatus]) variants[FAILURE_VARIANTS[presetStatus]] = true;
  }
  for (const run of runs) {
    for (const step of run.steps || []) {
      const status = Number(step.httpStatus);
      if (status >= 200 && status < 400) variants.success = true;
      if (FAILURE_VARIANTS[status]) variants[FAILURE_VARIANTS[status]] = true;
    }
  }
  return variants;
};

const computeCoverage = ({ collection, requests = [], scenarios = [], runsByScenario = {}, contracts = [], generatedAt = new Date().toISOString() }) => {
  const requestItems = requests.filter((request) => REQUEST_TYPES.has(request.type || 'http-request'));
  const scenarioRecords = scenarios.map((scenario) => {
    const runs = runsByScenario[scenario.id] || [];
    const latestRun = runs[0] || null;
    const enabledSteps = (scenario.steps || []).filter((step) => step.enabled !== false);
    const unresolved = enabledSteps.filter((step) => !step.link?.requestUid && !step.link?.pathHint);
    const passingRuns = runs.filter((run) => run.status === 'passed');
    const environments = [...new Set(runs.map((run) => run.environmentUid || run.environmentKey).filter(Boolean))];
    return {
      scenarioId: scenario.id,
      name: scenario.name,
      enabledSteps: enabledSteps.length,
      linkedSteps: enabledSteps.length - unresolved.length,
      brokenLinks: unresolved.length,
      hasPassingBaseline: Boolean(scenario.baseline || passingRuns.length),
      runCount: runs.length,
      lastRunAt: latestRun?.createdAt || latestRun?.startedAt || null,
      lastPassedAt: passingRuns[0]?.createdAt || passingRuns[0]?.startedAt || null,
      environmentsCovered: environments,
      hasCleanup: Boolean(scenario.testData?.cleanup?.length || scenario.cleanup?.length),
      sideEffectSteps: enabledSteps.filter((step) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(step.requestHint?.method || '').toUpperCase())).length
    };
  });

  const requestRecords = requestItems.map((request) => {
    const identity = buildRequestIdentity(request);
    const linked = scenarios.flatMap((scenario) => (scenario.steps || [])
      .filter((step) => step.enabled !== false && (step.link?.requestUid === identity.uid || step.link?.pathHint === identity.pathname))
      .map((step) => ({ scenario, step })));
    const scenarioIds = [...new Set(linked.map(({ scenario }) => scenario.id))];
    const relevantRuns = scenarioIds.flatMap((scenarioId) => runsByScenario[scenarioId] || []);
    const runSteps = relevantRuns.flatMap((run) => (run.steps || []).filter((runStep) => runStep.requestUid === identity.uid || linked.some(({ step: linkedStep }) => linkedStep.id === runStep.stepId)));
    const passing = relevantRuns.filter((run) => run.status === 'passed');
    const currentFingerprint = requestFingerprint(request);
    const staleLinks = linked.filter(({ step }) => {
      if (step.requestHint?.fingerprint) return step.requestHint.fingerprint !== currentFingerprint;
      const source = request.draft || request;
      return String(step.requestHint?.method || '').toUpperCase() !== String(source.request?.method || '').toUpperCase()
        || (step.requestHint?.url && step.requestHint.url !== source.request?.url);
    }).map(({ scenario, step }) => ({ scenarioId: scenario.id, stepId: step.id }));
    const assertions = assertionDimensions(linked.map(({ step }) => step));
    const variants = failureVariants(linked.map(({ step }) => step), relevantRuns);
    const environmentsCovered = [...new Set(relevantRuns.map((run) => run.environmentUid || run.environmentKey).filter(Boolean))];
    const contract = contractForRequest(contracts, request);
    const latestRunAt = relevantRuns.map((run) => run.createdAt || run.startedAt).filter(Boolean).sort().reverse()[0] || null;
    const latestPassedAt = passing.map((run) => run.createdAt || run.startedAt).filter(Boolean).sort().reverse()[0] || null;

    return {
      requestUid: identity.uid,
      requestRef: identity,
      name: request.name,
      scenarioIds,
      roles: [...new Set(linked.map(({ step }) => step.role || 'api'))],
      runCount: runSteps.length,
      lastRunAt: latestRunAt,
      lastPassedAt: latestPassedAt,
      assertions,
      variants,
      contractStatus: contract ? (contract.requestRef?.fingerprint === currentFingerprint ? 'current' : 'stale') : 'missing',
      staleLinks,
      environmentsCovered,
      revisionFingerprint: currentFingerprint,
      covered: scenarioIds.length > 0,
      replayed: runSteps.length > 0,
      passing: passing.length > 0
    };
  });

  const total = requestRecords.length;
  const dimensions = {
    execution: percentage(requestRecords.filter((request) => request.replayed).length, total),
    scenarios: percentage(requestRecords.filter((request) => request.covered).length, total),
    assertions: percentage(requestRecords.filter((request) => Object.values(request.assertions).some(Boolean)).length, total),
    contracts: percentage(requestRecords.filter((request) => request.contractStatus !== 'missing').length, total),
    failurePaths: percentage(requestRecords.filter((request) => Object.entries(request.variants).some(([key, value]) => key !== 'success' && value)).length, total),
    environments: percentage(requestRecords.filter((request) => request.environmentsCovered.length > 0).length, total),
    freshness: percentage(requestRecords.filter((request) => request.staleLinks.length === 0).length, total)
  };
  const summary = {
    requests: total,
    coveredByScenarios: requestRecords.filter((request) => request.covered).length,
    successfullyReplayed: requestRecords.filter((request) => request.passing).length,
    haveContracts: requestRecords.filter((request) => request.contractStatus !== 'missing').length,
    haveFailureCases: requestRecords.filter((request) => Object.entries(request.variants).some(([key, value]) => key !== 'success' && value)).length,
    neverRun: requestRecords.filter((request) => !request.replayed).length,
    staleLinks: requestRecords.reduce((count, request) => count + request.staleLinks.length, 0),
    brokenLinks: scenarioRecords.reduce((count, scenario) => count + scenario.brokenLinks, 0)
  };

  return {
    format: 'bruno-scenario-coverage',
    schemaVersion: 1,
    snapshotId: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    collectionIdentity: collection,
    generatedAt,
    summary,
    dimensions,
    requests: requestRecords,
    scenarios: scenarioRecords
  };
};

module.exports = { computeCoverage, assertionDimensions, failureVariants };
