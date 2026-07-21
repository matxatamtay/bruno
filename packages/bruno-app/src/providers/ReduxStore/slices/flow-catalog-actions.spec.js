import {
  FlowIpcError,
  createFlowFile,
  invokeFlowIpc,
  loadWorkspaceFlowDraftRecoveries,
  openWorkspaceFlowCatalog,
  saveFlowFile
} from './flow-catalog-actions';
import {
  flowCatalogEventReceived,
  flowCatalogFailed,
  flowCatalogLoaded,
  flowCatalogLoading,
  flowConflictDetected,
  flowDraftRecoveryFailed
} from './flow-catalog';

const record = {
  relativePath: 'checkout.flow.yml',
  pathname: '/workspace/flows/checkout.flow.yml',
  flow: {
    uid: 'flow_checkout',
    name: 'Checkout',
    revision: `sha256:${'a'.repeat(64)}`,
    metadata: { updatedAt: '2026-07-20T10:00:00.000Z', tags: [] }
  }
};

describe('flow catalog IPC actions', () => {
  beforeEach(() => {
    window.ipcRenderer = { invoke: jest.fn() };
  });

  afterEach(() => {
    delete window.ipcRenderer;
  });

  it('unwraps successful envelopes and throws typed IPC errors', async () => {
    const ipcRenderer = {
      invoke: jest.fn()
        .mockResolvedValueOnce({ ok: true, data: { value: 1 } })
        .mockResolvedValueOnce({
          ok: false,
          error: { code: 'FLOW_REVISION_CONFLICT', message: 'conflict', actualRevision: 'external' }
        })
    };

    await expect(invokeFlowIpc(ipcRenderer, 'channel')).resolves.toEqual({ value: 1 });
    await expect(invokeFlowIpc(ipcRenderer, 'channel')).rejects.toMatchObject({
      name: 'FlowIpcError',
      code: 'FLOW_REVISION_CONFLICT',
      actualRevision: 'external'
    });
  });

  it('loads a workspace catalog and contains open failures in Redux state', async () => {
    const dispatch = jest.fn();
    window.ipcRenderer.invoke
      .mockResolvedValueOnce({ ok: true, data: [{ uid: 'flow_checkout' }] })
      .mockResolvedValueOnce({ ok: true, data: [] })
      .mockResolvedValueOnce({ ok: false, error: { message: 'watcher failed' } });

    await openWorkspaceFlowCatalog({ workspaceUid: 'workspace_local', workspacePath: '/workspace' })(dispatch);
    expect(dispatch).toHaveBeenNthCalledWith(1, flowCatalogLoading({ workspaceUid: 'workspace_local' }));
    expect(dispatch).toHaveBeenNthCalledWith(2, flowCatalogLoaded({
      workspaceUid: 'workspace_local',
      entries: [{ uid: 'flow_checkout' }]
    }));

    dispatch.mockClear();
    await openWorkspaceFlowCatalog({ workspaceUid: 'workspace_local', workspacePath: '/workspace' })(dispatch);
    expect(dispatch).toHaveBeenLastCalledWith(flowCatalogFailed({
      workspaceUid: 'workspace_local',
      error: 'watcher failed'
    }));
  });

  it('keeps a loaded catalog usable when draft recovery loading fails', async () => {
    const dispatch = jest.fn();
    window.ipcRenderer.invoke
      .mockResolvedValueOnce({ ok: true, data: [{ uid: 'flow_checkout' }] })
      .mockResolvedValueOnce({ ok: false, error: { message: 'draft index damaged' } });

    const entries = await openWorkspaceFlowCatalog({
      workspaceUid: 'workspace_local',
      workspacePath: '/workspace'
    })(dispatch);

    expect(entries).toEqual([{ uid: 'flow_checkout' }]);
    expect(dispatch).toHaveBeenCalledWith(flowDraftRecoveryFailed({
      workspaceUid: 'workspace_local',
      error: 'draft index damaged'
    }));
  });

  it('loads recoverable drafts and projects conflict badges', async () => {
    const dispatch = jest.fn();
    window.ipcRenderer.invoke
      .mockResolvedValueOnce({
        ok: true,
        data: [{ draftUid: 'flow_checkout' }]
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          draft: {
            draftUid: 'flow_checkout',
            flowUid: 'flow_checkout',
            savedAt: '2026-07-20T10:00:00.000Z',
            baseRevision: 'old'
          },
          currentRevision: 'external',
          hasConflict: true
        }
      });

    const recoveries = await loadWorkspaceFlowDraftRecoveries({
      workspaceUid: 'workspace_local',
      workspacePath: '/workspace'
    })(dispatch);

    expect(recoveries).toHaveLength(1);
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({
      type: 'flowCatalog/flowDraftRecoveryAvailable',
      payload: expect.objectContaining({
        flowUid: 'flow_checkout',
        recovery: expect.objectContaining({ hasConflict: true })
      })
    }));
  });

  it('projects created records immediately while watcher events remain idempotent', async () => {
    const dispatch = jest.fn();
    window.ipcRenderer.invoke.mockResolvedValue({ ok: true, data: record });

    await createFlowFile({
      workspaceUid: 'workspace_local',
      workspacePath: '/workspace',
      relativePath: record.relativePath,
      flow: record.flow
    })(dispatch);

    expect(dispatch).toHaveBeenCalledWith(flowCatalogEventReceived({
      workspaceUid: 'workspace_local',
      event: expect.objectContaining({
        type: 'created',
        relativePath: record.relativePath,
        entry: expect.objectContaining({ uid: 'flow_checkout', revision: record.flow.revision })
      })
    }));
  });

  it('turns revision conflicts into catalog conflict badges without swallowing the error', async () => {
    const dispatch = jest.fn();
    window.ipcRenderer.invoke.mockResolvedValue({
      ok: false,
      error: {
        code: 'FLOW_REVISION_CONFLICT',
        message: 'conflict',
        pathname: record.pathname,
        expectedRevision: 'old',
        actualRevision: 'external'
      }
    });

    const operation = saveFlowFile({
      workspaceUid: 'workspace_local',
      workspacePath: '/workspace',
      relativePath: record.relativePath,
      flow: record.flow,
      expectedRevision: 'old'
    })(dispatch);

    await expect(operation).rejects.toBeInstanceOf(FlowIpcError);
    expect(dispatch).toHaveBeenCalledWith(flowConflictDetected({
      workspaceUid: 'workspace_local',
      flowUid: 'flow_checkout',
      conflict: expect.objectContaining({
        pathname: record.pathname,
        expectedRevision: 'old',
        actualRevision: 'external'
      })
    }));
  });
});
