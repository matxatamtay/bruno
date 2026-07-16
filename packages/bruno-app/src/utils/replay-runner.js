import cloneDeep from 'lodash/cloneDeep';
import get from 'lodash/get';
import { uuid } from 'utils/common';
import { findCollectionByUid, findItemInCollection, flattenItems } from 'utils/collections';
import {
  applyReplayBindings,
  applyReplayTarget,
  evaluateReplayAssertions,
  evaluateReplayCondition,
  redactReplayValue,
  replayBackoffDelay,
  replayDelay,
  replayFingerprint,
  replayResponseData,
  replaySchema,
  requestSnapshot,
  shouldRetryReplayResponse
} from './replay-studio';

const resolveLinkedItem = (collection, step) => {
  let item = step.link?.requestUid ? findItemInCollection(collection, step.link.requestUid) : null;
  if (!item && step.requestUid) item = findItemInCollection(collection, step.requestUid);
  if (!item && step.link?.pathHint) {
    item = flattenItems(collection?.items || []).find((candidate) => candidate.pathname === step.link.pathHint || candidate.pathname?.endsWith(step.link.pathHint));
  }
  return item;
};

const readLatestResponse = (getState, collectionUid, itemUid) => {
  const collection = findCollectionByUid(getState().collections.collections, collectionUid);
  return findItemInCollection(collection, itemUid)?.response || null;
};

const variableMutations = (before, after) => {
  const keys = [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])].sort();
  return keys.filter((key) => !Object.is(before?.[key], after?.[key])).map((key) => ({
    key,
    before: redactReplayValue(before?.[key], key),
    after: redactReplayValue(after?.[key], key),
    type: before?.[key] === undefined ? 'added' : after?.[key] === undefined ? 'removed' : 'changed'
  }));
};

const executeAttempt = async ({ item, step, variables, collectionUid, dispatch, getState, sendRequestAction, attempt, polling, targetBaseUrl }) => {
  const itemCopy = applyReplayTarget(
    applyReplayBindings(cloneDeep(item), step.overrides?.bindings, variables),
    targetBaseUrl
  );
  itemCopy.__replayStudioLocalOnly = true;
  const effectiveRequest = requestSnapshot(itemCopy);
  const startedAt = Date.now();
  await dispatch(sendRequestAction(itemCopy, collectionUid));
  const response = readLatestResponse(getState, collectionUid, item.uid);
  const responseData = replayResponseData(response);
  const responseShape = replaySchema(responseData);
  const requestFailed = !response || response.isError || response.status === 'Error' || Number(response.status) >= 400;
  const pollingSatisfied = !polling || evaluateReplayCondition(
    polling.until || (polling.untilStatus !== undefined ? { status: polling.untilStatus } : null),
    response
  );
  const duration = response?.duration ?? Date.now() - startedAt;
  return {
    response,
    responseData,
    responseShape,
    requestFailed,
    pollingSatisfied,
    record: {
      attempt,
      status: requestFailed ? 'failed' : pollingSatisfied ? 'passed' : 'waiting',
      httpStatus: response?.status ?? null,
      duration,
      pollingSatisfied,
      error: response?.error || null,
      effectiveRequest,
      responseSummary: {
        status: response?.status ?? null,
        statusText: response?.statusText || null,
        duration,
        size: response?.size ?? null,
        schema: responseShape,
        fingerprint: replayFingerprint(responseData)
      }
    }
  };
};

const executeStep = async ({ step, item, variables, collectionUid, dispatch, getState, sendRequestAction, targetBaseUrl, phase = 'scenario' }) => {
  const polling = step.replay?.polling || null;
  const retry = step.replay?.retry || null;
  const pollingMaxAttempts = polling ? Math.max(1, Number(polling.maxAttempts) || 10) : 1;
  const retryMaxAttempts = retry ? Math.max(1, Number(retry.maxAttempts) || 3) : 1;
  const maxAttempts = Math.max(pollingMaxAttempts, retryMaxAttempts);
  const attempts = [];
  const startedAt = Date.now();
  const variablesBefore = cloneDeep(variables);
  const requestTemplate = requestSnapshot(item);
  let latest = { response: null, responseData: null, responseShape: null, pollingSatisfied: !polling };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    latest = await executeAttempt({ item, step, variables, collectionUid, dispatch, getState, sendRequestAction, attempt, polling, targetBaseUrl });
    attempts.push(latest.record);
    if (polling && !latest.requestFailed && latest.pollingSatisfied) break;
    if (polling && !latest.requestFailed && !latest.pollingSatisfied && attempt < pollingMaxAttempts) {
      await replayDelay(polling.intervalMs || 2000);
      continue;
    }
    if (retry && shouldRetryReplayResponse(latest.response, retry, attempt)) {
      await replayDelay(replayBackoffDelay(retry, attempt));
      continue;
    }
    break;
  }

  const extractedVariables = [];
  (step.extracts || []).forEach((extract) => {
    const sourcePath = String(extract.sourcePath || '').replace(/^body\./, '');
    const value = get(latest.responseData, sourcePath);
    if (value !== undefined) {
      variables[extract.variable] = value;
      extractedVariables.push({
        variable: extract.variable,
        sourcePath: extract.sourcePath,
        sensitivity: extract.sensitivity || 'normal',
        value: redactReplayValue(value, extract.variable)
      });
    }
  });
  const assertionResults = evaluateReplayAssertions(step.assertions, latest.response);
  const failed = !latest.response
    || latest.response.isError
    || latest.response.status === 'Error'
    || Number(latest.response.status) >= 400
    || assertionResults.some((result) => !result.passed)
    || !latest.pollingSatisfied;
  const status = failed ? polling && !latest.pollingSatisfied ? 'polling-timeout' : 'failed' : 'passed';
  const duration = latest.response?.duration ?? Date.now() - startedAt;
  const summary = {
    stepId: step.id,
    requestUid: item.uid,
    name: step.name || item.name,
    phase,
    status,
    httpStatus: latest.response?.status ?? null,
    duration,
    assertionResults,
    attempts: attempts.map(({ effectiveRequest, responseSummary, ...attempt }) => attempt),
    responseSchema: latest.responseShape || replaySchema(latest.responseData),
    responseFingerprint: replayFingerprint(latest.responseData),
    requestRevision: {
      expectedFingerprint: step.requestHint?.fingerprint || null,
      methodChanged: Boolean(step.requestHint?.method && String((item.draft || item).request?.method || '').toUpperCase() !== String(step.requestHint.method).toUpperCase()),
      urlChanged: Boolean(step.requestHint?.url && (item.draft || item).request?.url !== step.requestHint.url)
    }
  };
  const trace = {
    ...summary,
    before: {
      variablesByScope: { scenario: redactReplayValue(variablesBefore) },
      requestTemplate
    },
    attempts,
    after: {
      variablesByScope: { scenario: redactReplayValue(variables) },
      extractedVariables,
      variableMutations: variableMutations(variablesBefore, variables)
    }
  };
  return { summary, trace };
};

const lifecycleStep = (entry, phase, index, item) => ({
  id: entry.id || `${phase}-${index}-${entry.requestUid || item?.uid || 'step'}`,
  name: entry.name || item?.name || `${phase} step ${index + 1}`,
  link: entry.link || { requestUid: entry.requestUid, pathHint: entry.pathHint },
  requestHint: entry.requestHint || {
    method: (item?.draft || item)?.request?.method,
    url: (item?.draft || item)?.request?.url
  },
  overrides: entry.overrides || {},
  extracts: entry.extracts || [],
  assertions: entry.assertions || [],
  replay: entry.replay || {}
});

const executeLifecycle = async ({ entries = [], phase, variables, collectionUid, dispatch, getState, sendRequestAction, targetBaseUrl }) => {
  const results = [];
  for (let index = 0; index < entries.length; index += 1) {
    const collection = findCollectionByUid(getState().collections.collections, collectionUid);
    const raw = entries[index];
    const item = resolveLinkedItem(collection, raw);
    if (!item) {
      results.push({ summary: { stepId: raw.id || `${phase}-${index}`, name: raw.name || `${phase} step`, phase, status: 'missing-link', error: 'Linked request not found', attempts: [] }, trace: null });
      if (raw.continueOnFailure !== true) break;
      continue;
    }
    const result = await executeStep({ step: lifecycleStep(raw, phase, index, item), item, variables, collectionUid, dispatch, getState, sendRequestAction, targetBaseUrl, phase });
    results.push(result);
    if (result.summary.status !== 'passed' && raw.continueOnFailure !== true) break;
  }
  return results;
};

const breakpointMatches = (breakpoints, stepId, when) => (breakpoints || []).some((breakpoint) => (typeof breakpoint === 'string' ? breakpoint === stepId && when === 'before' : breakpoint.stepId === stepId && (breakpoint.when || 'before') === when));

export const executeReplayScenario = async ({ scenario, collectionUid, options = {}, dispatch, getState, sendRequestAction }) => {
  const testData = options.testData || null;
  const variables = {
    ...(options.variables || {}),
    ...(options.historicalVariables || {}),
    ...(testData?.variables || {})
  };
  const run = {
    id: uuid(),
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    environmentUid: options.environmentUid || null,
    target: options.targetBaseUrl ? { type: 'mock-lab', baseUrl: options.targetBaseUrl } : { type: 'environment' },
    testData: testData ? { profileId: testData.profileId, profileName: testData.profileName, seed: testData.seed, datasetId: testData.datasetId, datasetIndex: testData.datasetIndex } : null,
    startedAt: new Date().toISOString(),
    status: 'running',
    steps: [],
    setup: [],
    cleanup: [],
    initialVariables: redactReplayValue(variables),
    trace: { steps: [] },
    stateCompleteness: {
      status: options.startStepId ? 'partial' : 'ready',
      reasons: options.startStepId ? ['Replay started from the middle; cookies and producer side effects may be unavailable'] : []
    }
  };
  let primaryFailure = null;

  try {
    if (!options.startStepId) {
      const setupResults = await executeLifecycle({
        entries: testData?.setupSteps || scenario.setup || [],
        phase: 'setup',
        variables,
        collectionUid,
        dispatch,
        getState,
        sendRequestAction,
        targetBaseUrl: options.targetBaseUrl
      });
      run.setup = setupResults.map((result) => result.summary);
      run.trace.steps.push(...setupResults.map((result) => result.trace).filter(Boolean));
      const setupFailure = setupResults.find((result) => result.summary.status !== 'passed');
      if (setupFailure) {
        primaryFailure = setupFailure.summary;
        run.status = 'failed';
        run.scenarioSkipped = true;
      }
    }

    if (!primaryFailure) {
      const orderedSteps = (scenario.steps || []).filter((step) => step.enabled !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
      const startIndex = options.startStepId ? Math.max(0, orderedSteps.findIndex((step) => step.id === options.startStepId)) : 0;
      const steps = options.onlyStep ? orderedSteps.slice(startIndex, startIndex + 1) : orderedSteps.slice(startIndex);
      for (const step of steps) {
        if (breakpointMatches(options.breakpoints, step.id, 'before') && typeof options.onBreakpoint === 'function') {
          await options.onBreakpoint({ when: 'before', step, variables: redactReplayValue(variables) });
        }
        const collection = findCollectionByUid(getState().collections.collections, collectionUid);
        const item = resolveLinkedItem(collection, step);
        if (!item) {
          const missing = { stepId: step.id, name: step.name, phase: 'scenario', status: 'missing-link', error: 'Linked request not found', attempts: [] };
          run.steps.push(missing);
          primaryFailure = missing;
          run.status = 'failed';
          break;
        }
        const result = await executeStep({ step, item, variables, collectionUid, dispatch, getState, sendRequestAction, targetBaseUrl: options.targetBaseUrl });
        run.steps.push(result.summary);
        run.trace.steps.push(result.trace);
        if (breakpointMatches(options.breakpoints, step.id, 'after') && typeof options.onBreakpoint === 'function') {
          await options.onBreakpoint({ when: 'after', step, result: result.summary, variables: redactReplayValue(variables) });
        }
        if (result.summary.status !== 'passed' && options.stopOnFailure !== false) {
          primaryFailure = result.summary;
          run.status = 'failed';
          break;
        }
      }
    }
  } finally {
    const cleanupResults = await executeLifecycle({
      entries: testData?.cleanupSteps || scenario.cleanup || [],
      phase: 'cleanup',
      variables,
      collectionUid,
      dispatch,
      getState,
      sendRequestAction,
      targetBaseUrl: options.targetBaseUrl
    });
    run.cleanup = cleanupResults.map((result) => result.summary);
    run.trace.steps.push(...cleanupResults.map((result) => result.trace).filter(Boolean));
    run.cleanupStatus = cleanupResults.some((result) => result.summary.status !== 'passed') ? 'failed' : 'passed';
  }

  if (run.status === 'running') run.status = run.steps.every((step) => step.status === 'passed') ? 'passed' : 'failed';
  run.primaryFailure = primaryFailure ? { stepId: primaryFailure.stepId, name: primaryFailure.name, status: primaryFailure.status, error: primaryFailure.error || null } : null;
  run.endedAt = new Date().toISOString();
  run.variables = redactReplayValue(variables);
  run.trace.initialVariables = run.initialVariables;
  run.trace.finalVariables = run.variables;
  return run;
};
