const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const AdmZip = require('adm-zip');
const {
  inferSchema,
  compareSchema,
  ContractStore,
  ObservationStore,
  CoverageStore,
  TraceStore,
  TestDataStore,
  IntelligenceBundle,
  MockLabService,
  buildObservation,
  buildObservationFromShape,
  buildCollectionIdentity,
  buildRequestIdentity,
  resolveCollectionReference,
  resolveRequestReference,
  createContractFromResponse,
  createContractFromObservations,
  generateAssertionsFromContract,
  createContractFromOpenApi,
  compareContractWithResponse,
  compareContractWithObservation,
  computeCoverage,
  materializeProfile,
  buildTraceFromRun,
  compareTraces,
  matchRoute,
  applyFailurePreset,
  parseCsv,
  serializeCsv
} = require('../../src/services/api-intelligence');

const collection = { uid: 'shop-api', name: 'Shop API', pathname: '/tmp/shop-api' };
const request = { uid: 'get-user', name: 'Get user', pathname: '/tmp/shop-api/GetUser.bru', request: { method: 'GET', url: '{{baseUrl}}/users/{{id}}' } };

describe('API intelligence core', () => {
  let root;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-api-intelligence-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  test('resolves moved collections and requests with ordered identity fallbacks', () => {
    const movedCollection = { ...collection, uid: 'new-uid', pathname: '/new/shop-api', gitRemote: 'git@example.com:shop/api.git', relativeGitPath: 'api' };
    const reference = buildCollectionIdentity({ ...collection, uid: 'old-uid', gitRemote: 'git@example.com:shop/api.git', relativeGitPath: 'api' });
    expect(resolveCollectionReference(reference, [movedCollection])).toMatchObject({ status: 'resolved', strategy: 'git-path', match: movedCollection });

    const movedRequest = { ...request, uid: 'new-request-uid', pathname: '/new/shop-api/GetUser.bru' };
    const requestReference = buildRequestIdentity({ ...request, uid: 'old-request-uid', pathname: '/old/GetUser.bru' });
    expect(resolveRequestReference(requestReference, [movedRequest])).toMatchObject({ status: 'resolved', strategy: 'method-url', match: movedRequest });
    expect(resolveRequestReference(requestReference, [movedRequest, { ...movedRequest, uid: 'duplicate' }]).status).toBe('ambiguous');
  });

  test('infers secret-safe response shape without storing values', () => {
    const schema = inferSchema({ id: 'usr_123', email: 'user@example.com', token: 'super-secret-token', age: 42 });
    expect(schema).toMatchObject({
      type: 'object',
      properties: {
        age: { type: 'integer' },
        email: { type: 'string', format: 'email' },
        id: { type: 'string' },
        token: { type: 'string' }
      },
      required: ['age', 'email', 'id', 'token']
    });
    expect(JSON.stringify(schema)).not.toContain('super-secret-token');
  });

  test('classifies removed required fields as breaking and additions as compatible', () => {
    const expected = inferSchema({ id: 'usr_1', name: 'Ada' });
    const actual = inferSchema({ id: 'usr_1', nickname: 'A' });
    const findings = compareSchema(expected, actual);
    expect(findings).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: 'breaking', ruleId: 'required-field-removed', path: '$.name' }),
      expect.objectContaining({ severity: 'non-breaking', ruleId: 'optional-field-added', path: '$.nickname' })
    ]));
  });

  test('persists accepted contracts atomically outside the collection', () => {
    const store = new ContractStore(root);
    const contract = createContractFromResponse({
      requestRef: buildRequestIdentity(request),
      response: { status: 200, headers: { 'content-type': 'application/json' }, data: { id: 'usr_1' } }
    });
    store.saveContract(collection, request, contract);
    expect(store.getContract(collection, request)).toMatchObject({ format: 'bruno-api-contract', requestRef: { uid: 'get-user' } });
    expect(fs.existsSync(path.join(root, 'collections'))).toBe(true);
    expect(fs.existsSync(path.join(collection.pathname, 'intelligence'))).toBe(false);
  });

  test('builds Replay and recording observations from precomputed response shapes without bodies', () => {
    const schema = inferSchema({ id: 'usr_1', accessToken: 'never-store-this-token' });
    const observation = buildObservationFromShape({
      requestRef: buildRequestIdentity(request),
      status: 200,
      duration: 42,
      contentType: 'application/json; charset=utf-8',
      schema,
      source: 'replay',
      environmentKey: 'dev'
    });
    expect(observation).toMatchObject({
      source: 'replay',
      environmentKey: 'dev',
      response: { status: 200, duration: 42, contentType: 'application/json', schema }
    });
    expect(JSON.stringify(observation)).not.toContain('never-store-this-token');
  });

  test('records bounded secret-safe observations', () => {
    const store = new ObservationStore(root, { maxPerRequest: 2 });
    for (let index = 0; index < 3; index++) {
      const observation = buildObservation({
        requestRef: buildRequestIdentity(request),
        response: {
          status: 200,
          duration: 10 + index,
          headers: { 'content-type': 'application/json' },
          data: { token: `secret-${index}`, id: index }
        }
      });
      store.record(collection, request, observation);
    }
    const observations = store.list(collection, request);
    expect(observations).toHaveLength(2);
    expect(JSON.stringify(observations)).not.toContain('secret-');
    expect(observations[0].response).toMatchObject({ status: 200, contentType: 'application/json' });
  });

  test('adapts OpenAPI refs, nullable fields and status contracts', () => {
    const contract = createContractFromOpenApi({
      request,
      spec: {
        openapi: '3.0.3',
        paths: {
          '/users/{id}': {
            get: {
              responses: {
                200: {
                  content: {
                    'application/json': {
                      schema: { $ref: '#/components/schemas/User' }
                    }
                  }
                }
              }
            }
          }
        },
        components: {
          schemas: {
            User: {
              type: 'object',
              required: ['id'],
              properties: {
                id: { type: 'string' },
                nickname: { type: 'string', nullable: true }
              }
            }
          }
        }
      }
    });
    expect(contract.source).toBe('openapi');
    expect(contract.responseContracts['200'].schema).toMatchObject({
      type: 'object',
      required: ['id'],
      properties: { nickname: { type: 'union' } }
    });
  });

  test('computes transparent request coverage and revision staleness', () => {
    const contract = createContractFromResponse({
      requestRef: buildRequestIdentity(request),
      response: { status: 200, data: { id: 'usr_1' } }
    });
    const coverage = computeCoverage({
      collection,
      requests: [{ ...request, type: 'http-request' }],
      scenarios: [{
        id: 'scenario-1',
        name: 'User flow',
        steps: [{
          id: 'step-1',
          enabled: true,
          role: 'api',
          link: { requestUid: request.uid },
          requestHint: { method: 'POST', url: '/old' },
          assertions: [{ type: 'status', expected: 401 }]
        }]
      }],
      runsByScenario: {
        'scenario-1': [{ id: 'run-1', status: 'passed', environmentUid: 'dev', createdAt: '2026-01-01T00:00:00.000Z', steps: [{ stepId: 'step-1', httpStatus: 401 }] }]
      },
      contracts: [contract]
    });
    expect(coverage.summary).toMatchObject({ requests: 1, coveredByScenarios: 1, successfullyReplayed: 1, haveFailureCases: 1, staleLinks: 1 });
    expect(coverage.dimensions).toMatchObject({ execution: 100, assertions: 100, contracts: 100, failurePaths: 100, environments: 100 });
    expect(coverage.requests[0].variants.authFailure).toBe(true);
  });

  test('merges historical observations conservatively and generates explicit assertion suggestions', () => {
    const observations = [
      buildObservation({ requestRef: buildRequestIdentity(request), response: { status: 200, duration: 100, headers: { 'content-type': 'application/json' }, data: { id: 'usr_1', name: 'Ada' } } }),
      buildObservation({ requestRef: buildRequestIdentity(request), response: { status: 200, duration: 180, headers: { 'content-type': 'application/json' }, data: { id: 'usr_2', nickname: 'A' } } })
    ];
    const contract = createContractFromObservations({ requestRef: buildRequestIdentity(request), observations });
    expect(contract).toMatchObject({ source: 'historical-observations', sampleCount: 2 });
    expect(contract.responseContracts['200'].schema).toMatchObject({ type: 'object', required: ['id'] });
    expect(contract.responseContracts['200'].durationBudget).toMatchObject({ p50: 100, p95: 180 });
    const assertions = generateAssertionsFromContract(contract);
    expect(assertions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'status', expected: 200 }),
      expect.objectContaining({ type: 'json-path-exists', path: 'id' }),
      expect.objectContaining({ type: 'response-time' })
    ]));
  });

  test('filters locally suppressed contract findings without mutating schemas', () => {
    const contract = createContractFromResponse({
      requestRef: buildRequestIdentity(request),
      response: { status: 200, data: { id: 'usr_1', name: 'Ada' } }
    });
    contract.ignoredPaths = ['$.name'];
    const result = compareContractWithResponse(contract, { status: 200, data: { id: 'usr_2' } });
    expect(result.status).toBe('pass');
    expect(result.findings).toEqual([]);
    expect(result.suppressed).toBe(1);
    expect(contract.responseContracts['200'].schema.required).toContain('name');
  });

  test('materializes deterministic test data with datasets and derived templates', () => {
    const profile = {
      profileId: 'profile-1',
      name: 'Checkout',
      seed: 'same-seed',
      datasets: [{ id: 'rows', rows: [{ plan: 'pro' }] }],
      activeDatasetId: 'rows',
      generators: {
        email: { type: 'randomEmail', options: { prefix: 'test' } },
        ref: { type: 'template', options: { template: 'ORDER-{{plan}}-{{email}}' } }
      }
    };
    const one = materializeProfile({ profile, now: new Date('2026-01-01T00:00:00.000Z') });
    const two = materializeProfile({ profile, now: new Date('2026-01-01T00:00:00.000Z') });
    expect(one.variables).toEqual(two.variables);
    expect(one.variables.ref).toContain('ORDER-pro-test+');
  });

  test('stores and compares secret-safe time-travel traces', () => {
    const store = new TraceStore(root, { maxPerScenario: 2 });
    const first = buildTraceFromRun({ scenario: { id: 'scenario-1', name: 'Flow' }, run: { id: 'run-1', status: 'passed', startedAt: '2026-01-01T00:00:00.000Z', initialVariables: { token: 'secret-one' }, steps: [{ stepId: 'step-1', name: 'Get user', status: 'passed', duration: 10 }] } });
    const second = buildTraceFromRun({ scenario: { id: 'scenario-1', name: 'Flow' }, run: { id: 'run-2', status: 'failed', startedAt: '2026-01-02T00:00:00.000Z', initialVariables: { token: 'secret-two' }, steps: [{ stepId: 'step-1', name: 'Get user', status: 'failed', duration: 30 }] } });
    store.save(collection, first);
    store.save(collection, second);
    const comparison = compareTraces(first, second);
    expect(comparison.firstDivergence.stepId).toBe('step-1');
    expect(JSON.stringify(store.list(collection, 'scenario-1'))).not.toContain('secret-one');
  });

  test('matches declarative mock routes and applies schema failure overlays', () => {
    const match = matchRoute({ method: 'GET', pathTemplate: '/users/:id', match: { query: { include: 'profile' } } }, { method: 'GET', pathname: '/users/42', query: { include: 'profile' }, headers: {}, body: null });
    expect(match.params).toEqual({ id: '42' });
    const failed = applyFailurePreset({ status: 200, body: { user: { id: '42', name: 'Ada' } } }, { type: 'missing-field', path: 'body.user.name' });
    expect(failed.body).toEqual({ user: { id: '42' } });
  });

  test('serves localhost mock routes and keeps lab state local', async () => {
    const service = new MockLabService(root);
    service.save(collection, {
      mode: 'pure-mock',
      routes: [{ id: 'route-1', name: 'Get user', enabled: true, method: 'GET', pathTemplate: '/users/:id', match: {}, responses: [{ id: 'response-1', status: 200, headers: { 'content-type': 'application/json' }, body: { ok: true } }] }]
    });
    const state = await service.start(collection);
    try {
      expect(state.url).toMatch(/^http:\/\/127\.0\.0\.1:/);
      const response = await fetch(`${state.url}/users/42`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(service.listLogs()[0]).toMatchObject({ matchedRouteId: 'route-1', status: 200 });
    } finally {
      await service.stop();
    }
  });

  test('round-trips CSV datasets and local fixtures safely', () => {
    const rows = [{ email: 'a@example.com', note: 'hello, "world"' }, { email: 'b@example.com', note: 'line\nbreak' }];
    expect(parseCsv(serializeCsv(rows))).toEqual(rows);
    const store = new TestDataStore(root);
    const fixture = store.saveFixture(collection, { name: 'payload.json', type: 'json', content: { ok: true, token: '<placeholder>' } });
    expect(store.readFixture(collection, fixture.id)).toMatchObject({ name: 'payload.json', type: 'json' });
    expect(store.listFixtures(collection)).toHaveLength(1);
    store.deleteFixture(collection, fixture.id);
    expect(store.listFixtures(collection)).toHaveLength(0);
  });

  test('redacts secrets from profile and Intelligence bundle exports', () => {
    const store = new TestDataStore(root);
    const profile = store.save(collection, {
      name: 'Secret data',
      generators: {},
      datasets: [{ id: 'rows', rows: [{ email: 'safe@example.com', apiKey: 'profile-secret-value', sessionToken: '{{secret:SESSION_TOKEN}}' }] }]
    });
    const storedProfileText = JSON.stringify(store.get(collection, profile.profileId));
    expect(storedProfileText).not.toContain('profile-secret-value');
    expect(storedProfileText).toContain('{{secret:SESSION_TOKEN}}');
    store.saveFixture(collection, {
      name: 'payload.json',
      type: 'json',
      content: { authorization: 'Bearer fixture-secret-value', id: 'safe-id' }
    });

    const profilePath = path.join(root, 'profile.brunodataset');
    store.exportProfile(collection, profile.profileId, profilePath);
    const exportedProfile = fs.readFileSync(profilePath, 'utf8');
    expect(exportedProfile).not.toContain('profile-secret-value');
    expect(exportedProfile).toContain('<redacted>');

    const archivePath = path.join(root, 'collection.brunointel');
    new IntelligenceBundle(root).exportCollection(collection, archivePath);
    const archiveText = new AdmZip(archivePath).getEntries()
      .filter((entry) => !entry.isDirectory)
      .map((entry) => entry.getData().toString('utf8'))
      .join('\n');
    expect(archiveText).not.toContain('profile-secret-value');
    expect(archiveText).not.toContain('fixture-secret-value');
    expect(archiveText).toContain('<redacted>');
  });

  test('sanitizes user-authored mock routes before local persistence', () => {
    const service = new MockLabService(root);
    service.save(collection, {
      mode: 'pure-mock',
      routes: [{
        id: 'secret-route',
        method: 'GET',
        pathTemplate: '/token',
        match: { headers: { authorization: '{{secret:AUTH_HEADER}}' } },
        responses: [{ status: 200, body: { accessToken: 'plaintext-token', id: 'safe' } }]
      }]
    });
    const stored = service.load(collection);
    expect(stored.routes[0].responses[0].body).toEqual({ accessToken: '<redacted>', id: 'safe' });
    expect(stored.routes[0].match.headers.authorization).toBe('{{secret:AUTH_HEADER}}');
  });

  test('records sanitized proxy responses into replayable local mock routes', async () => {
    const upstream = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'remote-1', token: 'must-not-be-recorded' }));
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;
    const service = new MockLabService(root);
    service.save(collection, { mode: 'proxy-override', proxyBaseUrl: upstreamUrl, recordProxyResponses: true, routes: [] });
    const state = await service.start(collection);
    try {
      const response = await fetch(`${state.url}/remote`);
      expect(await response.json()).toMatchObject({ id: 'remote-1' });
      const recorded = service.load(collection).routes[0];
      expect(recorded).toMatchObject({ recorded: true, method: 'GET', pathTemplate: '/remote' });
      expect(JSON.stringify(recorded)).not.toContain('must-not-be-recorded');
    } finally {
      await service.stop();
      await new Promise((resolve) => upstream.close(resolve));
    }
  });

  test('persists bounded coverage and test data profiles outside collections', () => {
    const coverageStore = new CoverageStore(root, { maxSnapshots: 1 });
    coverageStore.save(collection, { snapshotId: 'one', generatedAt: '2026-01-01T00:00:00.000Z' });
    coverageStore.save(collection, { snapshotId: 'two', generatedAt: '2026-01-02T00:00:00.000Z' });
    expect(coverageStore.list(collection)).toHaveLength(1);
    const testDataStore = new TestDataStore(root);
    const saved = testDataStore.save(collection, { name: 'Local data', generators: {} });
    expect(testDataStore.get(collection, saved.profileId).name).toBe('Local data');
    expect(fs.existsSync(path.join(collection.pathname, 'test-data'))).toBe(false);
  });

  test('stores environment-specific contracts without replacing the all-environment fallback', () => {
    const store = new ContractStore(root);
    const allContract = createContractFromResponse({
      requestRef: buildRequestIdentity(request),
      response: { status: 200, data: { environment: 'all' } }
    });
    const devContract = createContractFromResponse({
      requestRef: buildRequestIdentity(request),
      response: { status: 200, data: { environment: 'dev', debug: true } },
      environmentScope: 'environment-specific',
      environmentKey: 'dev'
    });
    store.saveContract(collection, request, allContract);
    store.saveContract(collection, request, devContract);

    expect(store.getContract(collection, request, 'dev')).toMatchObject({ environmentScope: 'environment-specific', environmentKey: 'dev' });
    expect(store.getContract(collection, request, 'prod')).toMatchObject({ environmentScope: 'all', environmentKey: null });
    expect(store.getContractsForRequest(collection, request)).toHaveLength(2);
    store.deleteContract(collection, request, 'dev');
    expect(store.getContract(collection, request, 'dev')).toMatchObject({ environmentScope: 'all' });
  });

  test('detects status, content type, and schema drift', () => {
    const contract = createContractFromResponse({
      requestRef: buildRequestIdentity(request),
      response: { status: 200, headers: { 'content-type': 'application/json' }, data: { id: 'usr_1', name: 'Ada' } }
    });
    const result = compareContractWithResponse(contract, {
      status: 500,
      headers: { 'content-type': 'text/plain' },
      data: 'failed'
    });
    expect(result.status).toBe('breaking');
    expect(result.findings[0]).toMatchObject({ ruleId: 'unknown-response-status', severity: 'breaking' });
  });

  test('compares accepted contracts with secret-safe historical observations', () => {
    const contract = createContractFromResponse({
      requestRef: buildRequestIdentity(request),
      response: { status: 200, duration: 100, headers: { 'content-type': 'application/json' }, data: { id: 'usr_1', name: 'Ada' } }
    });
    const observation = buildObservation({
      requestRef: buildRequestIdentity(request),
      source: 'runner',
      response: { status: 200, duration: 120, headers: { 'content-type': 'application/json' }, data: { id: 'usr_2' } }
    });
    const result = compareContractWithObservation(contract, observation);
    expect(result.status).toBe('breaking');
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: 'required-field-removed', path: '$.name' })]));
  });

  test('warns when a response exceeds its accepted duration budget', () => {
    const contract = createContractFromResponse({
      requestRef: buildRequestIdentity(request),
      response: { status: 200, duration: 100, headers: { 'content-type': 'application/json' }, data: { id: 'usr_1' } }
    });
    const result = compareContractWithResponse(contract, { status: 200, duration: 1000, headers: { 'content-type': 'application/json' }, data: { id: 'usr_2' } });
    expect(result.status).toBe('warning');
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: 'duration-budget-exceeded', severity: 'warning' })]));
  });
});
