const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const yaml = require('js-yaml');
const { app, ipcMain, shell, dialog } = require('electron');
const { ReplayStudioStore } = require('../recorder/replay-studio/store');
const {
  ContractStore,
  ObservationStore,
  CoverageStore,
  TraceStore,
  TestDataStore,
  IntelligenceBundle,
  MockLabService,
  buildObservation,
  buildRequestIdentity,
  resolveRequestReference,
  createContractFromResponse,
  createContractFromObservations,
  generateAssertionsFromContract,
  createContractFromOpenApi,
  compareContractWithResponse,
  compareContractWithObservation,
  computeCoverage,
  compareTraces,
  materializeProfile,
  buildMockRoute,
  schemaFingerprint,
  parseCsv,
  serializeCsv
} = require('../services/api-intelligence');

const validatePayload = ({ collection, request }) => {
  if (!collection?.pathname) throw new Error('Collection is required');
  if (!request?.uid && !request?.itemUid && !request?.pathname && !request?.request) throw new Error('Request is required');
};

const parseSpec = (spec) => {
  if (spec && typeof spec === 'object') return spec;
  if (typeof spec !== 'string' || !spec.trim()) throw new Error('OpenAPI spec is required');
  try { return JSON.parse(spec); } catch {
    const parsed = yaml.load(spec);
    if (!parsed || typeof parsed !== 'object') throw new Error('Unable to parse OpenAPI spec');
    return parsed;
  }
};

const contractFromSchema = ({ request, status, schema, contentType = 'application/json', source = 'replay-baseline', environmentScope = 'all', environmentKey = null }) => {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    format: 'bruno-api-contract',
    schemaVersion: 1,
    requestRef: buildRequestIdentity(request),
    environmentScope,
    environmentKey: environmentScope === 'environment-specific' ? environmentKey : null,
    source,
    acceptedAt: now,
    updatedAt: now,
    sampleCount: 1,
    responseContracts: {
      [String(Number(status) || 200)]: {
        contentTypes: contentType ? [contentType] : [],
        schema,
        schemaFingerprint: schemaFingerprint(schema)
      }
    }
  };
};

const registerApiIntelligenceIpc = (mainWindow) => {
  const baseDirectory = path.join(app.getPath('userData'), 'intelligence');
  const contractStore = new ContractStore(baseDirectory);
  const observationStore = new ObservationStore(baseDirectory);
  const coverageStore = new CoverageStore(baseDirectory);
  const traceStore = new TraceStore(baseDirectory);
  const testDataStore = new TestDataStore(baseDirectory);
  const bundle = new IntelligenceBundle(baseDirectory);
  const mockLab = new MockLabService(baseDirectory);
  const replayStore = new ReplayStudioStore(path.join(app.getPath('userData'), 'replay-studio'));
  const emitUpdate = (feature, collection, detail = {}) => {
    mainWindow?.webContents?.send('main:api-intelligence-updated', {
      feature,
      collection: collection ? { uid: collection.uid || null, pathname: collection.pathname || null } : null,
      timestamp: new Date().toISOString(),
      ...detail
    });
  };
  const buildContractDashboard = (collection, requests = []) => {
    const contracts = contractStore.listContracts(collection);
    const records = contracts.map((contract) => {
      const resolution = resolveRequestReference(contract.requestRef || {}, requests);
      const request = resolution.match;
      const current = request ? buildRequestIdentity(request) : null;
      const observations = observationStore.list(collection, request || contract.requestRef);
      const latestObservation = contract.environmentScope === 'environment-specific'
        ? observations.find((observation) => observation.environmentKey === contract.environmentKey) || null
        : observations[0] || null;
      const comparison = latestObservation ? compareContractWithObservation(contract, latestObservation) : null;
      let revisionStatus = 'broken';
      if (resolution.status === 'ambiguous') revisionStatus = 'ambiguous';
      else if (request) revisionStatus = current.fingerprint === contract.requestRef?.fingerprint ? 'current' : 'stale';
      return {
        ...contract,
        revisionStatus,
        relinkStrategy: resolution.strategy,
        latestObservation,
        comparison
      };
    });
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        endpoints: requests.length,
        contracts: records.length,
        current: records.filter((contract) => contract.revisionStatus === 'current').length,
        stale: records.filter((contract) => contract.revisionStatus === 'stale').length,
        broken: records.filter((contract) => contract.revisionStatus === 'broken').length,
        ambiguous: records.filter((contract) => contract.revisionStatus === 'ambiguous').length,
        breakingDrifts: records.filter((contract) => contract.comparison?.status === 'breaking').length,
        warnings: records.filter((contract) => contract.comparison?.status === 'warning').length,
        withoutContracts: requests.filter((request) => !records.some((contract) => resolveRequestReference(contract.requestRef || {}, [request]).status === 'resolved')).length
      },
      contracts: records
    };
  };

  ipcMain.handle('renderer:api-intelligence:get-contract-state', async (event, payload) => {
    validatePayload(payload || {});
    const contract = contractStore.getContract(payload.collection, payload.request, payload.environmentKey || null);
    const observations = observationStore.list(payload.collection, payload.request);
    const latestObservation = contract?.environmentScope === 'environment-specific'
      ? observations.find((observation) => observation.environmentKey === contract.environmentKey) || null
      : observations[0] || null;
    return {
      contract,
      comparison: contract
        ? payload.response
          ? compareContractWithResponse(contract, payload.response)
          : latestObservation
            ? compareContractWithObservation(contract, latestObservation)
            : null
        : null,
      observationCount: observations.length,
      latestObservation
    };
  });

  ipcMain.handle('renderer:api-intelligence:record-observation', async (event, payload) => {
    validatePayload(payload || {});
    const observation = buildObservation({
      requestRef: buildRequestIdentity(payload.request),
      response: payload.response,
      source: payload.source || 'single-run',
      environmentKey: payload.environmentKey || null
    });
    const saved = observationStore.record(payload.collection, payload.request, observation);
    emitUpdate('observations', payload.collection, { requestUid: payload.request.uid || payload.request.itemUid });
    return saved;
  });

  ipcMain.handle('renderer:api-intelligence:list-observations', async (event, payload) => {
    validatePayload(payload || {});
    return observationStore.list(payload.collection, payload.request);
  });

  ipcMain.handle('renderer:api-intelligence:accept-contract', async (event, payload) => {
    validatePayload(payload || {});
    const contract = createContractFromResponse({
      requestRef: buildRequestIdentity(payload.request),
      response: payload.response,
      source: payload.source || 'single-run',
      environmentScope: payload.environmentScope || 'all',
      environmentKey: payload.environmentKey || null
    });
    const saved = contractStore.saveContract(payload.collection, payload.request, contract);
    emitUpdate('contracts', payload.collection, { requestUid: payload.request.uid || payload.request.itemUid });
    return { contract: saved, comparison: compareContractWithResponse(saved, payload.response) };
  });

  ipcMain.handle('renderer:api-intelligence:accept-openapi-contract', async (event, payload) => {
    validatePayload(payload || {});
    const contract = createContractFromOpenApi({
      spec: parseSpec(payload.spec),
      request: payload.request,
      environmentScope: payload.environmentScope || 'all',
      environmentKey: payload.environmentKey || null
    });
    const saved = contractStore.saveContract(payload.collection, payload.request, contract);
    emitUpdate('contracts', payload.collection, { requestUid: payload.request.uid || payload.request.itemUid });
    return { contract: saved, comparison: null };
  });

  ipcMain.handle('renderer:api-intelligence:accept-schema-contract', async (event, payload) => {
    validatePayload(payload || {});
    if (!payload.schema) throw new Error('Response schema is required');
    const contract = contractFromSchema(payload);
    const saved = contractStore.saveContract(payload.collection, payload.request, contract);
    emitUpdate('contracts', payload.collection, { requestUid: payload.request.uid || payload.request.itemUid });
    return { contract: saved, comparison: null };
  });

  ipcMain.handle('renderer:api-intelligence:delete-contract', async (event, payload) => {
    validatePayload(payload || {});
    const result = contractStore.deleteContract(payload.collection, payload.request, payload.environmentKey || null);
    emitUpdate('contracts', payload.collection, { requestUid: payload.request.uid || payload.request.itemUid });
    return result;
  });

  ipcMain.handle('renderer:api-intelligence:list-contracts', async (event, collection) => {
    if (!collection?.pathname) return [];
    return contractStore.listContracts(collection);
  });

  ipcMain.handle('renderer:api-intelligence:get-contract-dashboard', async (event, { collection, requests = [] }) => {
    if (!collection?.pathname) throw new Error('Collection is required');
    return buildContractDashboard(collection, requests);
  });

  ipcMain.handle('renderer:api-intelligence:accept-historical-contract', async (event, payload) => {
    validatePayload(payload || {});
    const observations = observationStore.list(payload.collection, payload.request);
    const contract = createContractFromObservations({
      requestRef: buildRequestIdentity(payload.request),
      observations,
      environmentScope: payload.environmentScope || 'all',
      environmentKey: payload.environmentKey || null
    });
    const saved = contractStore.saveContract(payload.collection, payload.request, contract);
    emitUpdate('contracts', payload.collection, { requestUid: payload.request.uid || payload.request.itemUid });
    const latestObservation = saved.environmentScope === 'environment-specific'
      ? observations.find((observation) => observation.environmentKey === saved.environmentKey) || null
      : observations[0] || null;
    return { contract: saved, comparison: latestObservation ? compareContractWithObservation(saved, latestObservation) : null };
  });

  ipcMain.handle('renderer:api-intelligence:generate-contract-assertions', async (event, payload) => {
    validatePayload(payload || {});
    const contract = contractStore.getContract(payload.collection, payload.request, payload.environmentKey || null);
    if (!contract) throw new Error('No accepted contract exists for this request');
    return { assertions: generateAssertionsFromContract(contract), sourceContractId: contract.id };
  });

  ipcMain.handle('renderer:api-intelligence:suppress-contract-path', async (event, { collection, request, path: findingPath, suppressed = true, environmentKey = null }) => {
    validatePayload({ collection, request });
    if (!findingPath) throw new Error('Finding path is required');
    const contract = contractStore.getContract(collection, request, environmentKey);
    if (!contract) throw new Error('No accepted contract exists for this request');
    const ignoredPaths = new Set(contract.ignoredPaths || []);
    if (suppressed) ignoredPaths.add(findingPath);
    else ignoredPaths.delete(findingPath);
    const saved = contractStore.saveContract(collection, request, { ...contract, ignoredPaths: [...ignoredPaths].sort() });
    emitUpdate('contracts', collection, { requestUid: request.uid || request.itemUid });
    return saved;
  });

  ipcMain.handle('renderer:api-intelligence:export-contract-report', async (event, { collection, requests = [] }) => {
    if (!collection?.pathname) throw new Error('Collection is required');
    const report = buildContractDashboard(collection, requests);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Contract Guardian Report',
      defaultPath: `${String(collection.name || 'collection').replace(/[^a-z0-9._-]+/gi, '-')}-contracts.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(report, null, 2), { mode: 0o600 });
    return { canceled: false, filePath: result.filePath, summary: report.summary };
  });

  ipcMain.handle('renderer:api-intelligence:get-coverage', async (event, { collection, requests = [], saveSnapshot = true }) => {
    if (!collection?.pathname) throw new Error('Collection is required');
    const scenarios = replayStore.listScenarios(collection);
    const runsByScenario = Object.fromEntries(scenarios.map((scenario) => [scenario.id, replayStore.listRuns(collection, scenario.id)]));
    const snapshot = computeCoverage({ collection, requests, scenarios, runsByScenario, contracts: contractStore.listContracts(collection) });
    if (!saveSnapshot) return snapshot;
    const saved = coverageStore.save(collection, snapshot);
    emitUpdate('coverage', collection);
    return saved;
  });

  ipcMain.handle('renderer:api-intelligence:get-latest-coverage', async (event, collection) => {
    if (!collection?.pathname) return null;
    return coverageStore.latest(collection);
  });

  ipcMain.handle('renderer:api-intelligence:export-coverage', async (event, { collection, requests = [] }) => {
    const scenarios = replayStore.listScenarios(collection);
    const runsByScenario = Object.fromEntries(scenarios.map((scenario) => [scenario.id, replayStore.listRuns(collection, scenario.id)]));
    const snapshot = computeCoverage({ collection, requests, scenarios, runsByScenario, contracts: contractStore.listContracts(collection) });
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Scenario Coverage',
      defaultPath: `${String(collection.name || 'collection').replace(/[^a-z0-9._-]+/gi, '-')}-coverage.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('renderer:api-intelligence:list-traces', async (event, { collection, scenarioId = null }) => traceStore.list(collection, scenarioId));
  ipcMain.handle('renderer:api-intelligence:get-trace', async (event, { collection, scenarioId, traceId }) => traceStore.get(collection, scenarioId, traceId));
  ipcMain.handle('renderer:api-intelligence:compare-traces', async (event, { collection, scenarioId, leftTraceId, rightTraceId }) => {
    const left = traceStore.get(collection, scenarioId, leftTraceId);
    const right = traceStore.get(collection, scenarioId, rightTraceId);
    return compareTraces(left, right);
  });
  ipcMain.handle('renderer:api-intelligence:pin-trace', async (event, { collection, scenarioId, traceId, pinned }) => {
    const result = traceStore.setPinned(collection, scenarioId, traceId, pinned);
    emitUpdate('traces', collection, { scenarioId, traceId });
    return result;
  });
  ipcMain.handle('renderer:api-intelligence:delete-trace', async (event, { collection, scenarioId, traceId }) => {
    const result = traceStore.delete(collection, scenarioId, traceId);
    emitUpdate('traces', collection, { scenarioId, traceId });
    return result;
  });

  ipcMain.handle('renderer:api-intelligence:get-mock-lab', async (event, collection) => ({ lab: mockLab.load(collection), state: mockLab.state() }));
  ipcMain.handle('renderer:api-intelligence:save-mock-lab', async (event, { collection, lab }) => {
    const result = mockLab.save(collection, lab);
    emitUpdate('mocks', collection);
    return result;
  });
  ipcMain.handle('renderer:api-intelligence:sync-mock-routes', async (event, { collection, requests = [] }) => {
    const lab = mockLab.load(collection);
    const contracts = contractStore.listContracts(collection);
    const existingByUid = new Map((lab.routes || []).map((route) => [route.requestRef?.uid, route]));
    const routes = requests.map((request) => {
      const contract = contracts.find((candidate) => candidate.requestRef?.uid === (request.uid || request.itemUid));
      const generated = buildMockRoute({ request, contract });
      const existing = existingByUid.get(request.uid || request.itemUid);
      return existing ? { ...generated, ...existing, requestRef: generated.requestRef, method: generated.method, pathTemplate: generated.pathTemplate } : generated;
    });
    const saved = mockLab.save(collection, { ...lab, routes });
    emitUpdate('mocks', collection);
    return saved;
  });
  ipcMain.handle('renderer:api-intelligence:upsert-mock-route', async (event, { collection, route }) => {
    const result = mockLab.upsertRoute(collection, route);
    emitUpdate('mocks', collection, { routeId: route.id || null });
    return result;
  });
  ipcMain.handle('renderer:api-intelligence:delete-mock-route', async (event, { collection, routeId }) => {
    const result = mockLab.deleteRoute(collection, routeId);
    emitUpdate('mocks', collection, { routeId });
    return result;
  });
  ipcMain.handle('renderer:api-intelligence:start-mock-lab', async (event, collection) => {
    const result = await mockLab.start(collection);
    emitUpdate('mocks', collection, { state: result });
    return result;
  });
  ipcMain.handle('renderer:api-intelligence:stop-mock-lab', async () => {
    const collection = mockLab.collection;
    const result = await mockLab.stop();
    emitUpdate('mocks', collection, { state: result });
    return result;
  });
  ipcMain.handle('renderer:api-intelligence:get-mock-state', async () => mockLab.state());
  ipcMain.handle('renderer:api-intelligence:get-mock-logs', async () => mockLab.listLogs());
  ipcMain.handle('renderer:api-intelligence:reset-mock-state', async () => {
    const result = mockLab.resetState();
    emitUpdate('mocks', mockLab.collection, { state: result });
    return result;
  });

  ipcMain.handle('renderer:api-intelligence:list-test-data', async (event, collection) => testDataStore.list(collection));
  ipcMain.handle('renderer:api-intelligence:get-test-data', async (event, { collection, profileId }) => testDataStore.get(collection, profileId));
  ipcMain.handle('renderer:api-intelligence:save-test-data', async (event, { collection, profile }) => {
    const result = testDataStore.save(collection, profile);
    emitUpdate('test-data', collection, { profileId: result.profileId });
    return result;
  });
  ipcMain.handle('renderer:api-intelligence:delete-test-data', async (event, { collection, profileId }) => {
    const result = testDataStore.delete(collection, profileId);
    emitUpdate('test-data', collection, { profileId });
    return result;
  });
  ipcMain.handle('renderer:api-intelligence:materialize-test-data', async (event, { profile, datasetIndex = null, seed = null }) => materializeProfile({ profile, datasetIndex, seed }));
  ipcMain.handle('renderer:api-intelligence:export-test-data', async (event, { collection, profileId }) => {
    const profile = testDataStore.get(collection, profileId);
    if (!profile) throw new Error('Test data profile not found');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Test Data Profile',
      defaultPath: `${String(profile.name || 'test-data').replace(/[^a-z0-9._-]+/gi, '-')}.brunodataset`,
      filters: [{ name: 'Bruno Test Data', extensions: ['brunodataset'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    testDataStore.exportProfile(collection, profileId, result.filePath);
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle('renderer:api-intelligence:import-test-data', async (event, collection) => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Import Test Data Profile', properties: ['openFile'], filters: [{ name: 'Bruno Test Data', extensions: ['brunodataset', 'json'] }] });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const profile = testDataStore.importProfile(collection, result.filePaths[0]);
    emitUpdate('test-data', collection, { profileId: profile.profileId });
    return { canceled: false, profile };
  });

  ipcMain.handle('renderer:api-intelligence:import-dataset', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Import Dataset', properties: ['openFile'], filters: [{ name: 'Dataset', extensions: ['csv', 'json'] }] });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    const stats = fs.statSync(filePath);
    if (stats.size > 10 * 1024 * 1024) throw new Error('Dataset import exceeds 10 MB limit');
    const content = fs.readFileSync(filePath, 'utf8');
    const rows = path.extname(filePath).toLowerCase() === '.csv' ? parseCsv(content) : JSON.parse(content);
    if (!Array.isArray(rows) || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error('Dataset must contain an array of object rows');
    return { canceled: false, dataset: { id: crypto.randomUUID(), name: path.basename(filePath, path.extname(filePath)), rows: rows.slice(0, 10000) } };
  });

  ipcMain.handle('renderer:api-intelligence:export-dataset', async (event, { dataset, format = 'csv' }) => {
    if (!dataset || !Array.isArray(dataset.rows)) throw new Error('Dataset is required');
    const extension = format === 'json' ? 'json' : 'csv';
    const result = await dialog.showSaveDialog(mainWindow, { title: 'Export Dataset', defaultPath: `${String(dataset.name || 'dataset').replace(/[^a-z0-9._-]+/gi, '-')}.${extension}`, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
    if (result.canceled || !result.filePath) return { canceled: true };
    const content = extension === 'json' ? JSON.stringify(dataset.rows, null, 2) : serializeCsv(dataset.rows);
    fs.writeFileSync(result.filePath, content, { mode: 0o600 });
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('renderer:api-intelligence:list-fixtures', async (event, collection) => testDataStore.listFixtures(collection));
  ipcMain.handle('renderer:api-intelligence:read-fixture', async (event, { collection, fixtureId }) => testDataStore.readFixture(collection, fixtureId));
  ipcMain.handle('renderer:api-intelligence:save-fixture', async (event, { collection, fixture }) => {
    const result = testDataStore.saveFixture(collection, fixture);
    emitUpdate('test-data', collection, { fixtureId: result.id });
    return result;
  });
  ipcMain.handle('renderer:api-intelligence:delete-fixture', async (event, { collection, fixtureId }) => {
    const result = testDataStore.deleteFixture(collection, fixtureId);
    emitUpdate('test-data', collection, { fixtureId });
    return result;
  });

  ipcMain.handle('renderer:api-intelligence:export-bundle', async (event, collection) => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Bruno Intelligence Data',
      defaultPath: `${String(collection.name || 'collection').replace(/[^a-z0-9._-]+/gi, '-')}.brunointel`,
      filters: [{ name: 'Bruno Intelligence', extensions: ['brunointel'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    bundle.exportCollection(collection, result.filePath);
    return { canceled: false, filePath: result.filePath };
  });
  ipcMain.handle('renderer:api-intelligence:import-bundle', async (event, collection) => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Import Bruno Intelligence Data', properties: ['openFile'], filters: [{ name: 'Bruno Intelligence', extensions: ['brunointel'] }] });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const imported = bundle.importCollection(collection, result.filePaths[0]);
    emitUpdate('bundle', collection);
    return { canceled: false, result: imported };
  });

  ipcMain.handle('renderer:api-intelligence:reveal-data', async () => {
    await shell.openPath(baseDirectory);
    return { path: baseDirectory };
  });

  app.once('will-quit', () => mockLab.stop().catch(() => {}));
};

module.exports = registerApiIntelligenceIpc;
module.exports.contractFromSchema = contractFromSchema;
module.exports.parseSpec = parseSpec;
