const { ipcMain } = require('electron');

const envelope = async (operation) => {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return {
      ok: false,
      error: {
        code: error?.code || 'BRUNO_MCP_ERROR',
        message: error?.message || String(error)
      }
    };
  }
};

const registerMcpIpc = (mainWindow, manager) => {
  manager.setMainWindow(mainWindow);
  ipcMain.handle('renderer:mcp-status', () => envelope(() => manager.getStatus()));
  ipcMain.handle('renderer:mcp-client-configs', () => envelope(() => manager.getClientConfigurations()));
  ipcMain.handle('renderer:mcp-restart', () => envelope(() => manager.restart()));
  ipcMain.handle('renderer:mcp-rotate-token', (event, { reveal = true } = {}) => envelope(() => manager.rotateToken({ reveal })));
  ipcMain.handle('renderer:mcp-disconnect-clients', () => envelope(() => manager.disconnectClients()));
  return manager;
};

module.exports = { envelope, registerMcpIpc };
