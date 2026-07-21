const mockHandlers = new Map();

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel, handler) => mockHandlers.set(channel, handler)),
    on: jest.fn()
  }
}));

const registerFlowRuntimeIpc = require('../../src/ipc/flow-runtime');
const { resultEnvelope } = require('../../src/ipc/flow-runtime');

describe('flow runtime IPC adapter', () => {
  beforeEach(() => {
    mockHandlers.clear();
    require('electron').ipcMain.handle.mockClear();
    require('electron').ipcMain.on.mockClear();
  });

  it('registers run, cancel and preview channels against one runtime service', () => {
    const flowRuntimeService = {
      setMainWindow: jest.fn(),
      run: jest.fn(),
      resume: jest.fn(),
      cancel: jest.fn(),
      previewRequest: jest.fn(),
      listCheckpoints: jest.fn(),
      deleteCheckpoint: jest.fn()
    };
    const mainWindow = {};
    registerFlowRuntimeIpc(mainWindow, { flowRuntimeService });

    expect([...mockHandlers.keys()]).toEqual([
      'renderer:flow-run',
      'renderer:flow-resume',
      'renderer:flow-cancel',
      'renderer:flow-preview-request',
      'renderer:flow-checkpoint-list',
      'renderer:flow-checkpoint-delete'
    ]);
    expect(flowRuntimeService.setMainWindow).toHaveBeenCalledWith(mainWindow);
  });

  it('wraps successful run and cancellation results', async () => {
    const flowRuntimeService = {
      setMainWindow: jest.fn(),
      run: jest.fn(async (payload) => ({ runId: payload.runId, status: 'success' })),
      resume: jest.fn(async (payload) => ({ runId: payload.runId, status: 'success', resumed: payload.checkpointId })),
      cancel: jest.fn((runId) => ({ runId, cancelled: true })),
      previewRequest: jest.fn(),
      listCheckpoints: jest.fn(async ({ flowUid }) => [{ checkpointId: 'checkpoint_1', flowUid }]),
      deleteCheckpoint: jest.fn(async ({ checkpointId }) => ({ checkpointId }))
    };
    registerFlowRuntimeIpc({}, { flowRuntimeService });

    await expect(mockHandlers.get('renderer:flow-run')({}, { runId: 'run_1' })).resolves.toEqual({
      ok: true,
      data: { runId: 'run_1', status: 'success' }
    });
    await expect(mockHandlers.get('renderer:flow-resume')({}, { runId: 'run_2', checkpointId: 'checkpoint_1' })).resolves.toEqual({
      ok: true,
      data: { runId: 'run_2', status: 'success', resumed: 'checkpoint_1' }
    });
    await expect(mockHandlers.get('renderer:flow-cancel')({}, { runId: 'run_1' })).resolves.toEqual({
      ok: true,
      data: { runId: 'run_1', cancelled: true }
    });
    await expect(mockHandlers.get('renderer:flow-checkpoint-list')({}, { flowUid: 'flow_1' })).resolves.toEqual({
      ok: true,
      data: [{ checkpointId: 'checkpoint_1', flowUid: 'flow_1' }]
    });
    await expect(mockHandlers.get('renderer:flow-checkpoint-delete')({}, { checkpointId: 'checkpoint_1' })).resolves.toEqual({
      ok: true,
      data: { checkpointId: 'checkpoint_1' }
    });
  });

  it('serializes runtime failures without leaking arbitrary error fields', async () => {
    const error = Object.assign(new Error('bad flow'), { code: 'FLOW_RUNTIME_INVALID', secret: 'do-not-copy' });
    await expect(resultEnvelope(async () => { throw error; })).resolves.toEqual({
      ok: false,
      error: { code: 'FLOW_RUNTIME_INVALID', message: 'bad flow' }
    });
  });
});
