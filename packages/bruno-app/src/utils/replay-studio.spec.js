import {
  applyCapturedSecrets,
  buildCapturedDebugRequest,
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

  test('hydrates captured request data while preserving local secrets', () => {
    const item = {
      request: {
        method: 'POST',
        url: '{{baseUrl}}/checkout',
        headers: [
          { uid: 'auth', name: 'Authorization', value: 'Bearer {{accessToken}}', enabled: true },
          { uid: 'client', name: 'X-Client', value: 'old', enabled: true }
        ],
        body: { mode: 'json', json: JSON.stringify({ amount: 1, password: '{{password}}' }) }
      }
    };
    const request = buildCapturedDebugRequest(item, {
      method: 'POST',
      url: 'https://staging.test/checkout?orderId=ord_123',
      headers: [
        { name: 'Authorization', value: '<redacted>', enabled: true },
        { name: 'X-Client', value: 'recorded', enabled: true }
      ],
      body: { mode: 'json', content: JSON.stringify({ amount: 42, password: '<redacted>' }) }
    });

    expect(request.url).toContain('orderId=ord_123');
    expect(request.headers.find((header) => header.name === 'Authorization').value).toBe('Bearer {{accessToken}}');
    expect(request.headers.find((header) => header.name === 'X-Client').value).toBe('recorded');
    expect(JSON.parse(request.body.json)).toEqual({ amount: 42, password: '{{password}}' });
  });

  test('applies unlocked event secrets to captured headers, query and JSON body', () => {
    const captured = applyCapturedSecrets({
      url: 'https://api.test/pay?token=%3Credacted%3E',
      headers: [{ name: 'Authorization', value: '<redacted>' }],
      body: { mode: 'json', content: JSON.stringify({ password: '<redacted>' }) },
      state: {
        snapshot: {
          localStorage: { accessToken: '<redacted>' },
          sessionStorage: {},
          cookies: [{ name: 'session', value: '<redacted>' }]
        }
      }
    }, [
      { path: 'headers.Authorization', value: 'Bearer live-token' },
      { path: 'query.token', value: 'query-token' },
      { path: 'body.password', value: 'real-password' },
      { path: 'cookies.session', value: 'cookie-value' },
      { path: 'storage.localStorage.accessToken', value: 'storage-token' }
    ]);

    expect(captured.headers[0].value).toBe('Bearer live-token');
    expect(captured.headers.find((header) => header.name === 'Cookie').value).toBe('session=cookie-value');
    expect(captured.url).toContain('token=query-token');
    expect(JSON.parse(captured.body.content).password).toBe('real-password');
    expect(captured.state.snapshot.localStorage.accessToken).toBe('storage-token');
    expect(captured.state.snapshot.cookies[0].value).toBe('cookie-value');
  });

  test('hydrates explicitly unlocked secrets instead of preserving local placeholders', () => {
    const request = buildCapturedDebugRequest({
      request: {
        headers: [{ name: 'Authorization', value: 'Bearer {{accessToken}}', enabled: true }],
        body: { mode: 'json', json: JSON.stringify({ password: '{{password}}' }) }
      }
    }, {
      headers: [{ name: 'Authorization', value: 'Bearer captured-token', enabled: true }],
      body: { mode: 'json', content: JSON.stringify({ password: 'captured-password' }) },
      state: {
        secretsAvailable: true,
        snapshot: {
          localStorage: { accessToken: 'captured-token', region: 'ap-southeast-1' },
          sessionStorage: { currency: 'THB' }
        }
      }
    });

    expect(request.headers[0].value).toBe('Bearer captured-token');
    expect(JSON.parse(request.body.json).password).toBe('captured-password');
    expect(request.vars.req).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'accessToken', value: 'captured-token' }),
      expect.objectContaining({ name: 'currency', value: 'THB' })
    ]));
  });
});
