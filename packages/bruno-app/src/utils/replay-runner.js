import cloneDeep from 'lodash/cloneDeep';
import get from 'lodash/get';
import { uuid } from 'utils/common';
import { findCollectionByUid, findItemInCollection, flattenItems } from 'utils/collections';
import {
  applyReplayBindings,
  evaluateReplayAssertions,
  evaluateReplayCondition,
  replayBackoffDelay,
  replayDelay,
  replayFingerprint,
  replayResponseData,
  replaySchema,
  shouldRetryReplayResponse
} from './replay-studio';

const resolveLinkedItem = (collection, step) => {
  let item = step.link?.requestUid ? findItemInCollection(collection, step.link.requestUid) : null;
  if (!item && step.link?.pathHint) {
    item = flattenItems(collection?.items || []).find((candidate) => candidate.pathname === step.link.pathHint || candidate.pathname?.endsWith(step.link.pathHint));
  }
  return item;
};

const readLatestResponse = (getState, collectionUid, itemUid) => {
  const collection = findCollectionByUid(getState().collections.collections, collectionUid);
  return findItemInCollection(collection, itemUid)?.response || null;
};

const executeAttempt = async ({ item, step, variables, collectionUid, dispatch, getState, sendRequestAction, attempt, polling }) => {
  const itemCopy = applyReplayBindings(cloneDeep(item), step.overrides?.bindings, variables);
  itemCopy.__replayStudioLocalOnly = true;
  const startedAt = Date.now();
  await dispatch(sendRequestAction(itemCopy, collectionUid));
  const response = readLatestResponse(getState, collectionUid, item.uid);
  const requestFailed = !response || response.isError || response.status === 'Error' || Number(response.status) >= 400;
  const pollingSatisfied = !polling || evaluateReplayCondition(
    polling.until || (polling.untilStatus !== undefined ? { status: polling.untilStatus } : null),
    response
  );
  return {
    response,
    responseData: replayResponseData(response),
    requestFailed,
    pollingSatisfied,
    record: {
      attempt,
      status: requestFailed ? 'failed' : pollingSatisfied ? 'passed' : 'waiting',
      httpStatus: response?.status ?? null,
      duration: response?.duration ?? Date.now() - startedAt,
      pollingSatisfied,
      error: response?.error || null
    }
  };
};

const executeStep = async ({ step, item, variables, collectionUid, dispatch, getState, sendRequestAction }) => {
  const polling = step.replay?.polling || null;
  const retry = step.replay?.retry || null;
  const pollingMaxAttempts = polling ? Math.max(1, Number(polling.maxAttempts) || 10) : 1;
  const retryMaxAttempts = retry ? Math.max(1, Number(retry.maxAttempts) || 3) : 1;
  const maxAttempts = Math.max(pollingMaxAttempts, retryMaxAttempts);
  const attempts = [];
  const startedAt = Date.now();
  let latest = { response: null, responseData: null, pollingSatisfied: !polling };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    latest = await executeAttempt({ item, step, variables, collectionUid, dispatch, getState, sendRequestAction, attempt, polling });
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

  (step.extracts || []).forEach((extract) => {
    const sourcePath = String(extract.sourcePath || '').replace(/^body\./, '');
    const value = get(latest.responseData, sourcePath);
    if (value !== undefined) variables[extract.variable] = value;
  });
  const assertionResults = evaluateReplayAssertions(step.assertions, latest.response);
  const failed = !latest.response
    || latest.response.isError
    || latest.response.status === 'Error'
    || Number(latest.response.status) >= 400
    || assertionResults.some((result) => !result.passed)
    || !latest.pollingSatisfied;

  return {
    stepId: step.id,
    requestUid: item.uid,
    name: step.name,
    status: failed ? polling && !latest.pollingSatisfied ? 'polling-timeout' : 'failed' : 'passed',
    httpStatus: latest.response?.status ?? null,
    duration: latest.response?.duration ?? Date.now() - startedAt,
    assertionResults,
    attempts,
    responseSchema: replaySchema(latest.responseData),
    responseFingerprint: replayFingerprint(latest.responseData)
  };
};

export const executeReplayScenario = async ({ scenario, collectionUid, options = {}, dispatch, getState, sendRequestAction }) => {
  const variables = { ...(options.variables || {}) };
  const run = {
    id: uuid(), scenarioId: scenario.id, scenarioName: scenario.name,
    environmentUid: options.environmentUid || null, startedAt: new Date().toISOString(),
    status: 'running', steps: []
  };
  const steps = (scenario.steps || []).filter((step) => step.enabled !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
  for (const step of steps) {
    const collection = findCollectionByUid(getState().collections.collections, collectionUid);
    const item = resolveLinkedItem(collection, step);
    if (!item) {
      run.steps.push({ stepId: step.id, name: step.name, status: 'missing-link', error: 'Linked request not found', attempts: [] });
      run.status = 'failed';
      break;
    }
    const result = await executeStep({ step, item, variables, collectionUid, dispatch, getState, sendRequestAction });
    run.steps.push(result);
    if (result.status !== 'passed' && options.stopOnFailure !== false) {
      run.status = 'failed';
      break;
    }
  }
  if (run.status === 'running') run.status = run.steps.every((step) => step.status === 'passed') ? 'passed' : 'failed';
  run.endedAt = new Date().toISOString();
  run.variables = Object.fromEntries(Object.entries(variables).map(([key, value]) => [key, /token|secret|password/i.test(key) ? '<redacted>' : value]));
  return run;
};
