const mockHandlers = new Map();

jest.mock('electron', () => ({
  ipcMain: {
    handle: jest.fn((channel, handler) => mockHandlers.set(channel, handler))
  }
}));

const registerFlowIpc = require('../../src/ipc/flow');
const { resultEnvelope, serializeError } = require('../../src/ipc/flow');

describe('flow IPC adapter', () => {
  beforeEach(() => {
    mockHandlers.clear();
    require('electron').ipcMain.handle.mockClear();
  });

  it('registers CRUD, catalog and draft channels against one persistence service', () => {
    const flowPersistenceService = {
      setMainWindow: jest.fn(),
      openCatalog: jest.fn(),
      unwatchWorkspace: jest.fn(),
      readFlow: jest.fn(),
      createFlow: jest.fn(),
      saveFlow: jest.fn(),
      deleteFlow: jest.fn(),
      moveFlow: jest.fn(),
      saveDraft: jest.fn(),
      listDrafts: jest.fn(),
      recoverDraft: jest.fn(),
      applyDraft: jest.fn(),
      discardDraft: jest.fn()
    };

    registerFlowIpc({}, { flowPersistenceService });

    expect([...mockHandlers.keys()]).toEqual(expect.arrayContaining([
      'renderer:flow-catalog-open',
      'renderer:flow-read',
      'renderer:flow-create',
      'renderer:flow-save',
      'renderer:flow-delete',
      'renderer:flow-move',
      'renderer:flow-draft-save',
      'renderer:flow-draft-recover'
    ]));
    expect(flowPersistenceService.setMainWindow).toHaveBeenCalledWith({});
  });

  it('returns structured conflict errors rather than throwing across IPC', async () => {
    const conflict = Object.assign(new Error('stale revision'), {
      code: 'FLOW_REVISION_CONFLICT',
      pathname: '/workspace/flows/a.flow.yml',
      expectedRevision: 'old',
      actualRevision: 'external'
    });

    await expect(resultEnvelope(async () => {
      throw conflict;
    })).resolves.toEqual({
      ok: false,
      error: {
        code: 'FLOW_REVISION_CONFLICT',
        message: 'stale revision',
        pathname: '/workspace/flows/a.flow.yml',
        expectedRevision: 'old',
        actualRevision: 'external'
      }
    });
    expect(serializeError(conflict).actualRevision).toBe('external');
  });

  it('invokes the registered save handler and wraps success', async () => {
    const flowPersistenceService = {
      setMainWindow: jest.fn(),
      openCatalog: jest.fn(),
      unwatchWorkspace: jest.fn(),
      readFlow: jest.fn(),
      createFlow: jest.fn(),
      saveFlow: jest.fn(async (payload) => ({ saved: payload.relativePath })),
      deleteFlow: jest.fn(),
      moveFlow: jest.fn(),
      saveDraft: jest.fn(),
      listDrafts: jest.fn(),
      recoverDraft: jest.fn(),
      applyDraft: jest.fn(),
      discardDraft: jest.fn()
    };
    registerFlowIpc({}, { flowPersistenceService });

    const result = await mockHandlers.get('renderer:flow-save')({}, { relativePath: 'a.flow.yml' });

    expect(result).toEqual({ ok: true, data: { saved: 'a.flow.yml' } });
    expect(flowPersistenceService.saveFlow).toHaveBeenCalledWith({ relativePath: 'a.flow.yml' });
  });
});
