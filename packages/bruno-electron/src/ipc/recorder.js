const fs = require('fs');
const path = require('path');
const { ipcMain, dialog, shell, app } = require('electron');
const isDev = require('electron-is-dev');
const RecorderManager = require('../recorder/RecorderManager');

const registerRecorderIpc = (mainWindow) => {
  const manager = new RecorderManager(mainWindow);
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

  ipcMain.handle('renderer:recorder:get-extension-path', async () => ({ path: extensionPath }));
  ipcMain.handle('renderer:recorder:reveal-extension', async () => {
    shell.showItemInFolder(path.join(extensionPath, 'manifest.json'));
    return { path: extensionPath };
  });

  app.once('will-quit', () => manager.close());
};

module.exports = registerRecorderIpc;
