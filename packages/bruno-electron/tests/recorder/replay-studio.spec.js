const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { ReplayStudioStore, buildCollectionIdentity, requestFingerprint } = require('../../src/recorder/replay-studio/store');
const { pairExchanges, classifyExchange, analyzeRecording } = require('../../src/recorder/replay-studio/analyzer');

const collection = { uid: 'shop-api', name: 'Shop API', pathname: '/tmp/shop-api' };
const session = {
  manifest: { id: 'session-1', name: 'Checkout' },
  events: [
    { id: 'request-event-r1', type: 'network-request', timestamp: 1, data: { requestId: 'r1', method: 'POST', url: 'https://api.shop.test/login', resourceType: 'Fetch', headers: {}, body: '{"email":"a@b.com","password":"<redacted>"}' } },
    { type: 'network-response', timestamp: 2, data: { requestId: 'r1', status: 200, duration: 120, body: '{"accessToken":"<redacted>","user":{"id":"usr_12345"}}', sensitiveFingerprints: [{ path: 'body.accessToken', fingerprint: 'access-token-fingerprint' }] } },
    { id: 'state-before-r2', type: 'storage-checkpoint', timestamp: 2.5, data: { origin: 'https://api.shop.test', localStorage: { values: { userId: 'usr_12345', accessToken: '<redacted>' }, truncated: false }, sessionStorage: { values: { currency: 'THB' }, truncated: false } } },
    { id: 'request-event-r2', type: 'network-request', timestamp: 3, data: { requestId: 'r2', method: 'POST', url: 'https://api.shop.test/users/usr_12345/orders', resourceType: 'Fetch', headers: { Authorization: '<redacted>' }, body: '{"amount":42}', sensitiveFingerprints: [{ path: 'headers.Authorization', fingerprint: 'access-token-fingerprint' }] } },
    { id: 'request-extra-r2', type: 'network-request-extra', timestamp: 3.1, data: { requestId: 'r2', headers: { Cookie: '<redacted>' }, sensitiveFingerprints: [{ path: 'headers.Cookie', fingerprint: 'cookie-fingerprint' }] } },
    { type: 'network-response', timestamp: 4, data: { requestId: 'r2', status: 201, duration: 240, body: '{"id":"ord_98765","status":"pending"}' } },
    { type: 'network-request', timestamp: 5, data: { requestId: 'asset', method: 'GET', url: 'https://api.shop.test/logo.png', resourceType: 'Image', headers: {} } }
  ]
};

describe('Replay Studio local core', () => {
  let root;
  let store;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-replay-studio-'));
    store = new ReplayStudioStore(root);
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('builds stable local collection identity and request fingerprints', () => {
    expect(buildCollectionIdentity(collection).key).toHaveLength(32);
    const one = requestFingerprint({ request: { method: 'GET', url: 'https://x.test/users/123' } });
    const two = requestFingerprint({ request: { method: 'GET', url: 'https://x.test/users/456' } });
    expect(one).toBe(two);
  });

  test('persists scenarios atomically and tracks request usage', () => {
    const saved = store.saveScenario(collection, { name: 'Checkout', steps: [{ id: 's1', name: 'Login', link: { requestUid: 'login' } }] });
    expect(store.getScenario(collection, saved.id).name).toBe('Checkout');
    expect(store.listScenarios(collection)).toHaveLength(1);
    expect(store.getRequestUsage(collection, 'login')[0]).toMatchObject({ scenarioId: saved.id, stepName: 'Login' });
  });

  test('exports and imports a checksummed-safe standalone replay archive', () => {
    const saved = store.saveScenario(collection, { name: 'Checkout', steps: [] });
    const archive = path.join(root, 'checkout.brunoreplay');
    store.exportScenario(collection, saved.id, archive);
    expect(new AdmZip(archive).getEntries().map((entry) => entry.entryName)).toEqual(expect.arrayContaining(['manifest.json', 'scenario.json']));
    const imported = store.importScenario(archive, collection);
    expect(imported.id).not.toBe(saved.id);
    expect(imported.importedFrom).toBe(saved.id);
  });

  test('matches redacted secret dependencies through one-way fingerprints', () => {
    const fingerprinted = {
      manifest: { id: 'session-fp', name: 'Token flow' },
      events: [
        { type: 'network-request', timestamp: 1, data: { requestId: 'login', method: 'POST', url: 'https://api.test/login', resourceType: 'Fetch', headers: {}, body: '{}' } },
        { type: 'network-response', timestamp: 2, data: { requestId: 'login', status: 200, body: '{"accessToken":"<redacted>"}', sensitiveFingerprints: [{ path: 'body.accessToken', fingerprint: 'same-fingerprint' }] } },
        { type: 'network-request', timestamp: 3, data: { requestId: 'profile', method: 'GET', url: 'https://api.test/profile', resourceType: 'Fetch', headers: { Authorization: '<redacted>' }, sensitiveFingerprints: [{ path: 'headers.Authorization', fingerprint: 'same-fingerprint' }] } },
        { type: 'network-response', timestamp: 4, data: { requestId: 'profile', status: 200, body: '{"ok":true}' } }
      ]
    };
    const scenario = analyzeRecording({ session: fingerprinted, requests: [] });
    expect(scenario.steps[0].extracts).toEqual(expect.arrayContaining([expect.objectContaining({ variable: 'accessToken', sensitivity: 'secret' })]));
    expect(scenario.steps[1].overrides.bindings).toEqual(expect.arrayContaining([expect.objectContaining({ targetPath: 'headers.Authorization', originalValue: '<redacted>' })]));
  });

  test('infers polling terminal conditions and retry policies', () => {
    const policySession = {
      manifest: { id: 'policy-session', name: 'Async job' },
      events: [
        { type: 'network-request', timestamp: 1, data: { requestId: 'p1', method: 'GET', url: 'https://api.test/jobs/1', resourceType: 'Fetch', headers: {} } },
        { type: 'network-response', timestamp: 2, data: { requestId: 'p1', status: 200, body: '{"status":"pending"}' } },
        { type: 'network-request', timestamp: 3, data: { requestId: 'p2', method: 'GET', url: 'https://api.test/jobs/1', resourceType: 'Fetch', headers: {} } },
        { type: 'network-response', timestamp: 4, data: { requestId: 'p2', status: 200, body: '{"status":"processing"}' } },
        { type: 'network-request', timestamp: 5, data: { requestId: 'p3', method: 'GET', url: 'https://api.test/jobs/1', resourceType: 'Fetch', headers: {} } },
        { type: 'network-response', timestamp: 6, data: { requestId: 'p3', status: 200, body: '{"status":"complete"}' } },
        { type: 'network-request', timestamp: 7, data: { requestId: 'retry', method: 'POST', url: 'https://api.test/charge', resourceType: 'Fetch', headers: {}, body: '{}' } },
        { type: 'network-response', timestamp: 8, data: { requestId: 'retry', status: 503, body: '{"error":"busy"}' } }
      ]
    };
    const scenario = analyzeRecording({ session: policySession, requests: [] });
    const polling = scenario.steps.find((step) => step.role === 'polling');
    const retry = scenario.steps.find((step) => step.role === 'retry-candidate');
    expect(polling.sourceObservations).toHaveLength(3);
    expect(polling.observation.schema).toMatchObject({ type: 'object' });
    expect(polling.replay.polling).toMatchObject({
      maxAttempts: 3,
      until: { path: 'body.status', operator: 'eq', expected: 'complete' }
    });
    expect(retry.replay.retry).toMatchObject({ maxAttempts: 3, backoff: 'exponential', onNetworkError: true });
  });

  test('pairs exchanges, filters noise, links requests, and infers dependencies', () => {
    const exchanges = pairExchanges(session.events);
    expect(exchanges).toHaveLength(3);
    expect(classifyExchange(exchanges[0]).role).toBe('authentication');
    const scenario = analyzeRecording({
      session,
      requests: [
        { itemUid: 'login', pathname: '/tmp/shop-api/Auth/Login.bru', name: 'Login', method: 'POST', url: '{{baseUrl}}/login' },
        { itemUid: 'create-order', pathname: '/tmp/shop-api/Orders/Create.bru', name: 'Create order', method: 'POST', url: '{{baseUrl}}/users/{{userId}}/orders' }
      ]
    });
    expect(scenario.analysis).toMatchObject({ totalExchanges: 3, includedExchanges: 2, ignoredExchanges: 1 });
    expect(scenario.steps).toHaveLength(2);
    expect(scenario.steps[0].link.requestUid).toBe('login');
    expect(scenario.steps[0].observation).toMatchObject({ status: 200, duration: 120, schema: { type: 'object' } });
    expect(scenario.steps[1].observation).toMatchObject({ status: 201, duration: 240, schema: { type: 'object' } });
    expect(JSON.stringify(scenario.steps.map((step) => step.observation))).not.toContain('token-123456789');
    expect(scenario.steps[0].extracts).toEqual(expect.arrayContaining([expect.objectContaining({ variable: 'accessToken', sensitivity: 'secret' })]));
    expect(scenario.steps[1].overrides.bindings).toEqual(expect.arrayContaining([expect.objectContaining({ variable: 'accessToken' })]));
    expect(scenario.steps[1].assertions).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'status', expected: 201 })]));
    expect(scenario.steps[1].capturedRequest).toMatchObject({
      method: 'POST',
      url: 'https://api.shop.test/users/usr_12345/orders',
      body: { mode: 'json' }
    });
    expect(scenario.steps[1].capturedRequest.headers).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Authorization' })]));
    expect(scenario.steps[1].capturedRequest.headers).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Cookie' })]));
    expect(scenario.steps[1].capturedRequest.state.snapshot).toMatchObject({ localStorage: { userId: 'usr_12345' }, sessionStorage: { currency: 'THB' } });
    expect(scenario.steps[1].capturedRequest.source).toMatchObject({ eventId: 'request-event-r2', requestId: 'r2' });
    expect(scenario.steps[1].capturedRequest.source.eventIds).toContain('state-before-r2');
  });
});
