jest.mock('utils/common', () => ({ uuid: () => 'run-1' }));

import { executeReplayScenario } from './replay-runner';

const createHarness = (responses) => {
  const item = {
    uid: 'request-1',
    name: 'Async request',
    type: 'http-request',
    pathname: '/collection/request.bru',
    request: { method: 'GET', url: 'https://api.test/job', headers: [], body: { mode: 'none' } },
    response: null
  };
  const collection = { uid: 'collection-1', items: [item] };
  const state = { collections: { collections: [collection] } };
  const getState = () => state;
  const sendRequestAction = () => async () => {
    item.response = responses.shift() || null;
  };
  const dispatch = async (action) => typeof action === 'function' ? action(dispatch, getState) : action;
  return { dispatch, getState, sendRequestAction };
};

const scenarioFor = (replay) => ({
  id: 'scenario-1',
  name: 'Policy scenario',
  steps: [{
    id: 'step-1', name: 'Async request', order: 1, enabled: true,
    link: { requestUid: 'request-1' }, requestHint: { method: 'GET', url: 'https://api.test/job' },
    overrides: {}, extracts: [], assertions: [], replay
  }]
});

describe('Replay scenario attempt controller', () => {
  test('retries a configured transient status and records every attempt', async () => {
    const harness = createHarness([
      { status: 503, duration: 20, data: { error: 'busy' } },
      { status: 200, duration: 25, data: { ok: true } }
    ]);
    const run = await executeReplayScenario({
      scenario: scenarioFor({ retry: { maxAttempts: 3, backoff: 'fixed', backoffMs: 0, onStatuses: [503] } }),
      collectionUid: 'collection-1',
      dispatch: harness.dispatch,
      getState: harness.getState,
      sendRequestAction: harness.sendRequestAction
    });
    expect(run.status).toBe('passed');
    expect(run.steps[0].attempts).toHaveLength(2);
    expect(run.steps[0].attempts.map((attempt) => attempt.httpStatus)).toEqual([503, 200]);
  });

  test('polls until a JSON condition becomes true', async () => {
    const harness = createHarness([
      { status: 200, duration: 10, data: { status: 'pending' } },
      { status: 200, duration: 12, data: { status: 'complete' } }
    ]);
    const run = await executeReplayScenario({
      scenario: scenarioFor({ polling: { maxAttempts: 4, intervalMs: 0, until: { path: 'body.status', operator: 'eq', expected: 'complete' } } }),
      collectionUid: 'collection-1',
      dispatch: harness.dispatch,
      getState: harness.getState,
      sendRequestAction: harness.sendRequestAction
    });
    expect(run.status).toBe('passed');
    expect(run.steps[0].attempts.map((attempt) => attempt.status)).toEqual(['waiting', 'passed']);
  });
});
