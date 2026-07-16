const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, app } = require('electron');
const isDev = require('electron-is-dev');
const RecorderManager = require('../recorder/RecorderManager');
const { ReplayStudioStore } = require('../recorder/replay-studio/store');
const { analyzeRecording } = require('../recorder/replay-studio/analyzer');
const {
  TraceStore,
  ObservationStore,
  buildTraceFromRun,
  buildObservationFromShape,
  buildRequestIdentity
} = require('../services/api-intelligence');

const registerRecorderIpc = (mainWindow) => {
  const manager = new RecorderManager(mainWindow);
  const replayStore = new ReplayStudioStore(path.join(app.getPath('userData'), 'replay-studio'));
  const intelligenceDirectory = path.join(app.getPath('userData'), 'intelligence');
  const traceStore = new TraceStore(intelligenceDirectory);
  const observationStore = new ObservationStore(intelligenceDirectory);
  const emitIntelligenceUpdate = (feature, collection, detail = {}) => {
    mainWindow?.webContents?.send('main:api-intelligence-updated', {
      feature,
      collection: collection ? { uid: collection.uid || null, pathname: collection.pathname || null } : null,
      timestamp: new Date().toISOString(),
      ...detail
    });
  };
  const requestDescriptorForStep = (step) => ({
    uid: step.link?.requestUid || step.requestUid || null,
    itemUid: step.link?.requestUid || step.requestUid || null,
    name: step.name || null,
    pathname: step.link?.pathHint || null,
    type: 'http-request',
    request: {
      method: step.requestHint?.method || 'GET',
      url: step.requestHint?.url || ''
    }
  });
  const recordShape = ({ collection, step, shape, source, environmentKey = null, timestamp = null }) => {
    if (!shape || !Number.isInteger(Number(shape.status)) || !shape.schema) return false;
    const request = requestDescriptorForStep(step);
    if (!request.uid && !request.pathname && !request.request.url) return false;
    const observation = buildObservationFromShape({
      requestRef: buildRequestIdentity(request),
      status: shape.status,
      duration: shape.duration,
      contentType: shape.contentType,
      schema: shape.schema,
      source,
      environmentKey,
      timestamp: timestamp || shape.timestamp || null
    });
    observationStore.record(collection, request, observation);
    return true;
  };
  const extensionPath = isDev
    ? path.resolve(__dirname, '../../../bruno-recorder-extension')
    : path.join(process.resourcesPath, 'recorder-extension');

  ipcMain.handle('renderer:recorder:get-state', async () => {
    await manager.ensureServer();
    return manager.getState();
  });

  ipcMain.handle('renderer:recorder:start', async (event, metadata) => {
    await manager.ensureServer();
    return manager.startSession(metadata || {});
  });

  ipcMain.handle('renderer:recorder:stop', async (event, sessionId) => manager.stopSession(sessionId));
  ipcMain.handle('renderer:recorder:list-sessions', async () => manager.store.listSessions());
  ipcMain.handle('renderer:recorder:load-session', async (event, sessionId) => manager.store.loadSession(sessionId));

  ipcMain.handle('renderer:recorder:export', async (event, sessionId) => {
    const manifest = manager.store.readManifest(sessionId);
    if (!manifest) throw new Error('Recording session not found');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Bruno Web Recording',
      defaultPath: `${String(manifest.name || 'web-recording').replace(/[^a-z0-9._-]+/gi, '-')}.brurec`,
      filters: [{ name: 'Bruno Web Recording', extensions: ['brurec'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    manager.store.exportSession(sessionId, result.filePath);
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('renderer:recorder:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Bruno Web Recording',
      properties: ['openFile'],
      filters: [{ name: 'Bruno Web Recording', extensions: ['brurec'] }]
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    const session = manager.store.importSession(result.filePaths[0]);
    manager.broadcastState();
    return { canceled: false, session };
  });

  ipcMain.handle('renderer:recorder:get-asset', async (event, sessionId, relativePath) => {
    if (!sessionId || !relativePath || typeof relativePath !== 'string') throw new Error('Invalid recording asset');
    const sessionDirectory = path.resolve(manager.store.getSessionDirectory(sessionId));
    const assetPath = path.resolve(sessionDirectory, relativePath);
    if (!assetPath.startsWith(`${sessionDirectory}${path.sep}`) || !fs.existsSync(assetPath)) {
      throw new Error('Recording asset not found');
    }
    const extension = path.extname(assetPath).toLowerCase();
    const mimeType = extension === '.png' ? 'image/png' : 'image/jpeg';
    return `data:${mimeType};base64,${fs.readFileSync(assetPath).toString('base64')}`;
  });

  ipcMain.handle('renderer:recorder:analyze-session', async (event, { sessionId, collection, requests = [], name }) => {
    if (!sessionId || !collection?.pathname) throw new Error('Recording session and collection are required');
    const session = manager.store.loadSession(sessionId, 50000);
    const scenario = analyzeRecording({ session, requests: Array.isArray(requests) ? requests.slice(0, 10000) : [], name });
    const saved = replayStore.saveScenario(collection, scenario);
    let observationCount = 0;
    for (const step of saved.steps || []) {
      const shapes = step.sourceObservations?.length ? step.sourceObservations : [step.observation].filter(Boolean);
      for (const shape of shapes) {
        if (recordShape({ collection, step, shape, source: 'recording' })) observationCount += 1;
      }
    }
    emitIntelligenceUpdate('replay', collection, { scenarioId: saved.id });
    if (observationCount) emitIntelligenceUpdate('observations', collection, { source: 'recording', observationCount });
    return saved;
  });

  ipcMain.handle('renderer:recorder:list-scenarios', async (event, collection) => {
    if (!collection?.pathname) throw new Error('Collection is required');
    return replayStore.listScenarios(collection);
  });

  ipcMain.handle('renderer:recorder:get-scenario', async (event, { collection, scenarioId }) => {
    if (!collection?.pathname || !scenarioId) throw new Error('Collection and scenario are required');
    return replayStore.getScenario(collection, scenarioId);
  });

  ipcMain.handle('renderer:recorder:save-scenario', async (event, { collection, scenario }) => {
    if (!collection?.pathname || !scenario?.name) throw new Error('Collection and named scenario are required');
    const saved = replayStore.saveScenario(collection, scenario);
    emitIntelligenceUpdate('replay', collection, { scenarioId: saved.id });
    return saved;
  });

  ipcMain.handle('renderer:recorder:delete-scenario', async (event, { collection, scenarioId }) => {
    if (!collection?.pathname || !scenarioId) throw new Error('Collection and scenario are required');
    const result = replayStore.deleteScenario(collection, scenarioId);
    emitIntelligenceUpdate('replay', collection, { scenarioId });
    return result;
  });

  ipcMain.handle('renderer:recorder:get-request-usage', async (event, { collection, requestUid }) => {
    if (!collection?.pathname || !requestUid) return [];
    return replayStore.getRequestUsage(collection, requestUid);
  });

  ipcMain.handle('renderer:recorder:save-run', async (event, { collection, scenarioId, run }) => {
    if (!collection?.pathname || !scenarioId || !run) throw new Error('Collection, scenario, and run are required');
    const scenario = replayStore.getScenario(collection, scenarioId);
    const saved = replayStore.saveRun(collection, scenarioId, run);
    const trace = traceStore.save(collection, buildTraceFromRun({ scenario, run: saved }));
    const enriched = replayStore.saveRun(collection, scenarioId, { ...saved, traceId: trace.traceId });
    let observationCount = 0;
    for (const runStep of enriched.steps || []) {
      const scenarioStep = (scenario?.steps || []).find((step) => step.id === runStep.stepId);
      if (!scenarioStep) continue;
      if (recordShape({
        collection,
        step: scenarioStep,
        shape: {
          status: runStep.httpStatus,
          duration: runStep.duration,
          contentType: runStep.contentType || null,
          schema: runStep.responseSchema
        },
        source: 'replay',
        environmentKey: enriched.environmentUid || enriched.environmentKey || null,
        timestamp: enriched.startedAt || enriched.createdAt || null
      })) observationCount += 1;
    }
    emitIntelligenceUpdate('traces', collection, { scenarioId, traceId: trace.traceId, runId: enriched.id });
    if (observationCount) emitIntelligenceUpdate('observations', collection, { source: 'replay', observationCount });
    emitIntelligenceUpdate('replay', collection, { scenarioId, runId: enriched.id });
    return enriched;
  });

  ipcMain.handle('renderer:recorder:list-runs', async (event, { collection, scenarioId }) => {
    if (!collection?.pathname || !scenarioId) return [];
    return replayStore.listRuns(collection, scenarioId);
  });

  ipcMain.handle('renderer:recorder:save-baseline', async (event, { collection, scenarioId, environmentKey, run }) => {
    if (!collection?.pathname || !scenarioId || !run) throw new Error('Collection, scenario, and run are required');
    const saved = replayStore.saveBaseline(collection, scenarioId, environmentKey, run);
    emitIntelligenceUpdate('replay', collection, { scenarioId, baseline: true });
    return saved;
  });

  ipcMain.handle('renderer:recorder:get-baseline', async (event, { collection, scenarioId, environmentKey }) => {
    if (!collection?.pathname || !scenarioId) return null;
    return replayStore.getBaseline(collection, scenarioId, environmentKey);
  });

  ipcMain.handle('renderer:recorder:export-scenario', async (event, { collection, scenarioId, includeRuns = false }) => {
    const scenario = replayStore.getScenario(collection, scenarioId);
    if (!scenario) throw new Error('Replay scenario not found');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Replay Studio Scenario',
      defaultPath: `${String(scenario.name || 'scenario').replace(/[^a-z0-9._-]+/gi, '-')}.brunoreplay`,
      filters: [{ name: 'Bruno Replay Studio', extensions: ['brunoreplay'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    replayStore.exportScenario(collection, scenarioId, result.filePath, { includeRuns });
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('renderer:recorder:import-scenario', async (event, collection) => {
    if (!collection?.pathname) throw new Error('Collection is required');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Replay Studio Scenario',
      properties: ['openFile'],
      filters: [{ name: 'Bruno Replay Studio', extensions: ['brunoreplay'] }]
    });
    if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
    return { canceled: false, scenario: replayStore.importScenario(result.filePaths[0], collection) };
  });

  ipcMain.handle('renderer:recorder:reveal-replay-data', async () => {
    shell.openPath(replayStore.baseDirectory);
    return { path: replayStore.baseDirectory };
  });

  ipcMain.handle('renderer:recorder:get-extension-path', async () => ({ path: extensionPath }));
  ipcMain.handle('renderer:recorder:reveal-extension', async () => {
    shell.showItemInFolder(path.join(extensionPath, 'manifest.json'));
    return { path: extensionPath };
  });

  app.once('will-quit', () => manager.close());
};

module.exports = registerRecorderIpc;
