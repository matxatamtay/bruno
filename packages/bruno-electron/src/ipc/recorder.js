const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, app } = require('electron');
const isDev = require('electron-is-dev');
const RecorderManager = require('../recorder/RecorderManager');
const { ReplayStudioStore } = require('../recorder/replay-studio/store');
const { analyzeRecording } = require('../recorder/replay-studio/analyzer');

const registerRecorderIpc = (mainWindow) => {
  const manager = new RecorderManager(mainWindow);
  const replayStore = new ReplayStudioStore(path.join(app.getPath('userData'), 'replay-studio'));
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
    return replayStore.saveScenario(collection, scenario);
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
    return replayStore.saveScenario(collection, scenario);
  });

  ipcMain.handle('renderer:recorder:delete-scenario', async (event, { collection, scenarioId }) => {
    if (!collection?.pathname || !scenarioId) throw new Error('Collection and scenario are required');
    return replayStore.deleteScenario(collection, scenarioId);
  });

  ipcMain.handle('renderer:recorder:get-request-usage', async (event, { collection, requestUid }) => {
    if (!collection?.pathname || !requestUid) return [];
    return replayStore.getRequestUsage(collection, requestUid);
  });

  ipcMain.handle('renderer:recorder:save-run', async (event, { collection, scenarioId, run }) => {
    if (!collection?.pathname || !scenarioId || !run) throw new Error('Collection, scenario, and run are required');
    return replayStore.saveRun(collection, scenarioId, run);
  });

  ipcMain.handle('renderer:recorder:list-runs', async (event, { collection, scenarioId }) => {
    if (!collection?.pathname || !scenarioId) return [];
    return replayStore.listRuns(collection, scenarioId);
  });

  ipcMain.handle('renderer:recorder:save-baseline', async (event, { collection, scenarioId, environmentKey, run }) => {
    if (!collection?.pathname || !scenarioId || !run) throw new Error('Collection, scenario, and run are required');
    return replayStore.saveBaseline(collection, scenarioId, environmentKey, run);
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
