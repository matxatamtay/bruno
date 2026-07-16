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
  const calls = [];
  const sendRequestAction = (sentItem) => async () => {
    calls.push(sentItem);
    item.response = responses.shift() || null;
  };
  const dispatch = async (action) => typeof action === 'function' ? action(dispatch, getState) : action;
  return { dispatch, getState, sendRequestAction, calls };
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

  test('always runs cleanup without replacing the primary scenario failure', async () => {
    const harness = createHarness([
      { status: 500, duration: 10, data: { error: 'failed' } },
      { status: 200, duration: 8, data: { deleted: true } }
    ]);
    const scenario = scenarioFor({});
    scenario.cleanup = [{ id: 'cleanup-1', name: 'Cleanup request', requestUid: 'request-1', continueOnFailure: true }];
    const run = await executeReplayScenario({
      scenario,
      collectionUid: 'collection-1',
      dispatch: harness.dispatch,
      getState: harness.getState,
      sendRequestAction: harness.sendRequestAction
    });
    expect(run.status).toBe('failed');
    expect(run.primaryFailure).toMatchObject({ stepId: 'step-1', status: 'failed' });
    expect(run.cleanup).toEqual([expect.objectContaining({ stepId: 'cleanup-1', status: 'passed' })]);
    expect(run.cleanupStatus).toBe('passed');
  });

  test('applies Mock Lab target and preserves deterministic test-data evidence', async () => {
    const harness = createHarness([{ status: 200, duration: 10, data: { ok: true } }]);
    const run = await executeReplayScenario({
      scenario: scenarioFor({}),
      collectionUid: 'collection-1',
      options: {
        targetBaseUrl: 'http://127.0.0.1:6178',
        testData: { profileId: 'profile-1', profileName: 'Seed', seed: 'stable', variables: { email: 'seed@example.com' }, setupSteps: [], cleanupSteps: [] }
      },
      dispatch: harness.dispatch,
      getState: harness.getState,
      sendRequestAction: harness.sendRequestAction
    });
    expect(run.target).toMatchObject({ type: 'mock-lab', baseUrl: 'http://127.0.0.1:6178' });
    expect(run.testData).toMatchObject({ profileId: 'profile-1', seed: 'stable' });
    expect(run.initialVariables).toMatchObject({ email: 'seed@example.com' });
    expect(harness.calls[0].request.url).toBe('http://127.0.0.1:6178/job');
  });

  test('can replay from a selected step without re-running earlier producers', async () => {
    const harness = createHarness([{ status: 200, duration: 10, data: { ok: true } }]);
    const scenario = scenarioFor({});
    scenario.steps.push({ ...scenario.steps[0], id: 'step-2', name: 'Second request', order: 2 });
    scenario.steps.push({ ...scenario.steps[0], id: 'step-3', name: 'Third request', order: 3 });
    const run = await executeReplayScenario({
      scenario,
      collectionUid: 'collection-1',
      options: { startStepId: 'step-2', onlyStep: true, historicalVariables: { userId: 'usr_1' } },
      dispatch: harness.dispatch,
      getState: harness.getState,
      sendRequestAction: harness.sendRequestAction
    });
    expect(run.steps).toHaveLength(1);
    expect(run.steps[0].stepId).toBe('step-2');
    expect(run.stateCompleteness.status).toBe('partial');
    expect(harness.calls).toHaveLength(1);
  });
});
