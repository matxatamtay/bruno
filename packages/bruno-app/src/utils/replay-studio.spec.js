import {
  evaluateReplayCondition,
  replayBackoffDelay,
  shouldRetryReplayResponse
} from './replay-studio';

describe('Replay Studio runtime policies', () => {
  test('evaluates JSON polling conditions', () => {
    const response = { status: 200, data: { job: { status: 'complete', progress: 100 } } };
    expect(evaluateReplayCondition({ path: 'body.job.status', operator: 'eq', expected: 'complete' }, response)).toBe(true);
    expect(evaluateReplayCondition({ path: 'body.job.progress', operator: 'neq', expected: 0 }, response)).toBe(true);
    expect(evaluateReplayCondition({ path: 'body.job', operator: 'exists' }, response)).toBe(true);
    expect(evaluateReplayCondition({ path: 'body.job.status', operator: 'contains', expected: 'plet' }, response)).toBe(true);
    expect(evaluateReplayCondition({ status: 201 }, response)).toBe(false);
  });

  test('retries network errors and configured statuses within the limit', () => {
    const retry = { maxAttempts: 3, onStatuses: [429, 503], onNetworkError: true };
    expect(shouldRetryReplayResponse({ status: 503 }, retry, 1)).toBe(true);
    expect(shouldRetryReplayResponse({ status: 400 }, retry, 1)).toBe(false);
    expect(shouldRetryReplayResponse({ status: 'Error', isError: true }, retry, 2)).toBe(true);
    expect(shouldRetryReplayResponse({ status: 503 }, retry, 3)).toBe(false);
  });

  test('calculates bounded fixed and exponential backoff', () => {
    expect(replayBackoffDelay({ backoff: 'fixed', backoffMs: 250 }, 3)).toBe(250);
    expect(replayBackoffDelay({ backoff: 'exponential', backoffMs: 500 }, 3)).toBe(2000);
    expect(replayBackoffDelay({ backoff: 'exponential', backoffMs: 5000, maxBackoffMs: 8000 }, 4)).toBe(8000);
  });
});
