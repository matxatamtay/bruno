const { EventEmitter } = require('node:events');
const { FlowPersistenceService, assertWorkspacePath } = require('../../src/services/flow-persistence-service');

class FakeWatcher extends EventEmitter {
  constructor() {
    super();
    this.start = jest.fn(async () => this);
    this.close = jest.fn(async () => {});
  }
}

describe('FlowPersistenceService', () => {
  it('caches stores per resolved workspace and opens a watched catalog', async () => {
    const watcher = new FakeWatcher();
    let watcherOptions;
    const store = {
      createWatcher: jest.fn((options) => {
        watcherOptions = options;
        return watcher;
      }),
      listFlows: jest.fn(async () => [{ uid: 'flow_checkout' }])
    };
    const storeFactory = jest.fn(() => store);
    const mainWindow = { isDestroyed: () => false, webContents: { send: jest.fn() } };
    const service = new FlowPersistenceService({ mainWindow, storeFactory });

    const catalog = await service.openCatalog({ workspaceUid: 'workspace_local', workspacePath: '/tmp/workspace/.' });

    expect(catalog).toEqual([{ uid: 'flow_checkout' }]);
    expect(storeFactory).toHaveBeenCalledTimes(1);
    expect(store.createWatcher).toHaveBeenCalledWith(expect.objectContaining({ ignoreInitial: true }));
    expect(watcher.start).toHaveBeenCalledTimes(1);
    expect(service.getStore('/tmp/workspace')).toBe(store);

    const event = { type: 'changed', relativePath: 'checkout.flow.yml' };
    watcherOptions.onEvent(event);
    expect(mainWindow.webContents.send).toHaveBeenCalledWith('main:flow-catalog-event', {
      workspaceUid: 'workspace_local',
      event
    });
  });

  it('replaces a workspace watcher and closes every watcher on shutdown', async () => {
    const firstWatcher = new FakeWatcher();
    const secondWatcher = new FakeWatcher();
    const store = {
      createWatcher: jest.fn()
        .mockReturnValueOnce(firstWatcher)
        .mockReturnValueOnce(secondWatcher)
    };
    const service = new FlowPersistenceService({ storeFactory: () => store });

    await service.watchWorkspace({ workspaceUid: 'workspace_local', workspacePath: '/tmp/workspace' });
    await service.watchWorkspace({ workspaceUid: 'workspace_local', workspacePath: '/tmp/workspace' });

    expect(firstWatcher.close).toHaveBeenCalledTimes(1);
    await service.closeAll();
    expect(secondWatcher.close).toHaveBeenCalledTimes(1);
  });

  it('resolves subflows by safe relative path or catalog UID', async () => {
    const store = {
      readFlow: jest.fn(async (relativePath) => ({ relativePath, flow: { uid: relativePath === 'child.flow.yml' ? 'flow_child' : 'flow_other' } })),
      listFlows: jest.fn(async () => [
        { uid: 'flow_child', relativePath: 'child.flow.yml', status: 'valid' },
        { uid: null, relativePath: 'broken.flow.yml', status: 'invalid' }
      ])
    };
    const service = new FlowPersistenceService({ storeFactory: () => store });
    const base = { workspacePath: '/tmp/workspace' };

    await expect(service.resolveFlowReference({ ...base, relativePath: 'child.flow.yml' })).resolves.toMatchObject({
      relativePath: 'child.flow.yml', flow: { uid: 'flow_child' }
    });
    await expect(service.resolveFlowReference({ ...base, flowUid: 'flow_child' })).resolves.toMatchObject({
      relativePath: 'child.flow.yml', flow: { uid: 'flow_child' }
    });
    await expect(service.resolveFlowReference({ ...base, flowUid: 'missing' })).rejects.toMatchObject({ code: 'FLOW_SUBFLOW_NOT_FOUND' });
    expect(store.readFlow).toHaveBeenCalledWith('child.flow.yml');
  });

  it('delegates CRUD and draft operations to the domain store', async () => {
    const store = {
      readFlow: jest.fn(async () => 'read'),
      createFlow: jest.fn(async () => 'create'),
      saveFlow: jest.fn(async () => 'save'),
      deleteFlow: jest.fn(async () => {}),
      moveFlow: jest.fn(async () => 'move'),
      saveDraft: jest.fn(async () => 'draft'),
      listDrafts: jest.fn(async () => []),
      recoverDraft: jest.fn(async () => 'recover'),
      applyDraft: jest.fn(async () => 'apply'),
      discardDraft: jest.fn(async () => {})
    };
    const service = new FlowPersistenceService({ storeFactory: () => store });
    const base = { workspacePath: '/tmp/workspace' };

    await expect(service.readFlow({ ...base, relativePath: 'a.flow.yml' })).resolves.toBe('read');
    await expect(service.createFlow({ ...base, relativePath: 'a.flow.yml', flow: {} })).resolves.toBe('create');
    await expect(service.saveFlow({ ...base, relativePath: 'a.flow.yml', flow: {}, expectedRevision: 'rev' })).resolves.toBe('save');
    await expect(service.deleteFlow({ ...base, relativePath: 'a.flow.yml', expectedRevision: 'rev' })).resolves.toEqual({ relativePath: 'a.flow.yml' });
    await expect(service.moveFlow({ ...base, fromRelativePath: 'a.flow.yml', toRelativePath: 'b.flow.yml', expectedRevision: 'rev' })).resolves.toBe('move');
    await expect(service.saveDraft({ ...base, flowUid: 'flow', relativePath: 'a.flow.yml' })).resolves.toBe('draft');
    await expect(service.listDrafts(base)).resolves.toEqual([]);
    await expect(service.recoverDraft({ ...base, draftUid: 'flow' })).resolves.toBe('recover');
    await expect(service.applyDraft({ ...base, draftUid: 'flow' })).resolves.toBe('apply');
    await expect(service.discardDraft({ ...base, draftUid: 'flow' })).resolves.toEqual({ draftUid: 'flow' });
  });

  it('rejects missing workspace paths', () => {
    expect(() => assertWorkspacePath()).toThrow('workspacePath is required');
  });
});
