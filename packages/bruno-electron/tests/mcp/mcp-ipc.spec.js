const mockHandlers = new Map();

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel, handler) => mockHandlers.set(channel, handler))
  }
}));

const { envelope, registerMcpIpc } = require('../../src/mcp/ipc');

describe('Bruno MCP preferences IPC', () => {
  beforeEach(() => {
    mockHandlers.clear();
    require('electron').ipcMain.handle.mockClear();
  });

  it('registers status, restart, token rotation, disconnect, and audit channels', () => {
    const manager = {
      setMainWindow: jest.fn(),
      getStatus: jest.fn(),
      restart: jest.fn(),
      rotateToken: jest.fn(),
      disconnectClients: jest.fn(),
      listAudit: jest.fn()
    };
    const mainWindow = {};
    registerMcpIpc(mainWindow, manager);

    expect([...mockHandlers.keys()]).toEqual([
      'renderer:mcp-status',
      'renderer:mcp-restart',
      'renderer:mcp-rotate-token',
      'renderer:mcp-disconnect-clients',
      'renderer:mcp-audit-list'
    ]);
    expect(manager.setMainWindow).toHaveBeenCalledWith(mainWindow);
  });

  it('returns safe envelopes and reveals a token only for an explicit rotation request', async () => {
    const manager = {
      setMainWindow: jest.fn(),
      getStatus: jest.fn(() => ({ running: true, endpoint: 'http://127.0.0.1:3847/mcp' })),
      restart: jest.fn(async () => ({ running: true })),
      rotateToken: jest.fn(async ({ reveal }) => ({ fingerprint: 'abcd', ...(reveal ? { token: 'shown-once' } : {}) })),
      disconnectClients: jest.fn(async () => ({ disconnected: true, token: 'replacement-token' })),
      listAudit: jest.fn(async () => [{ event: 'mcp.tool.completed' }])
    };
    registerMcpIpc({}, manager);

    await expect(mockHandlers.get('renderer:mcp-status')()).resolves.toEqual({
      ok: true,
      data: { running: true, endpoint: 'http://127.0.0.1:3847/mcp' }
    });
    await expect(mockHandlers.get('renderer:mcp-rotate-token')({}, { reveal: false })).resolves.toEqual({
      ok: true,
      data: { fingerprint: 'abcd' }
    });
    await expect(mockHandlers.get('renderer:mcp-rotate-token')({}, { reveal: true })).resolves.toEqual({
      ok: true,
      data: { fingerprint: 'abcd', token: 'shown-once' }
    });
    expect(manager.rotateToken).toHaveBeenNthCalledWith(1, { reveal: false });
    expect(manager.rotateToken).toHaveBeenNthCalledWith(2, { reveal: true });
  });

  it('serializes failures without copying arbitrary fields', async () => {
    const error = Object.assign(new Error('restart failed'), { code: 'BRUNO_MCP_RESTART_FAILED', token: 'never-copy' });
    await expect(envelope(async () => { throw error; })).resolves.toEqual({
      ok: false,
      error: { code: 'BRUNO_MCP_RESTART_FAILED', message: 'restart failed' }
    });
  });
});
