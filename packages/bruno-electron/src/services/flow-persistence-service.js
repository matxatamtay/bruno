const path = require('node:path');
const { FlowStore } = require('@usebruno/flow-core/persistence');

const assertWorkspacePath = (workspacePath) => {
  if (!workspacePath || typeof workspacePath !== 'string') {
    throw new TypeError('workspacePath is required');
  }
  return path.resolve(workspacePath);
};

class FlowPersistenceService {
  constructor({ mainWindow = null, storeFactory = (workspacePath) => new FlowStore({ workspacePath }) } = {}) {
    this.mainWindow = mainWindow;
    this.storeFactory = storeFactory;
    this.stores = new Map();
    this.watchers = new Map();
  }

  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  getStore(workspacePath) {
    const resolvedPath = assertWorkspacePath(workspacePath);
    if (!this.stores.has(resolvedPath)) {
      this.stores.set(resolvedPath, this.storeFactory(resolvedPath));
    }
    return this.stores.get(resolvedPath);
  }

  async openCatalog({ workspaceUid, workspacePath }) {
    if (!workspaceUid) throw new TypeError('workspaceUid is required');
    await this.watchWorkspace({ workspaceUid, workspacePath });
    return this.getStore(workspacePath).listFlows();
  }

  async watchWorkspace({ workspaceUid, workspacePath }) {
    if (!workspaceUid) throw new TypeError('workspaceUid is required');
    await this.unwatchWorkspace(workspaceUid);

    const store = this.getStore(workspacePath);
    const watcher = store.createWatcher({
      ignoreInitial: true,
      onEvent: (event) => {
        if (!this.mainWindow || this.mainWindow.isDestroyed?.()) return;
        this.mainWindow.webContents.send('main:flow-catalog-event', { workspaceUid, event });
      }
    });
    watcher.on('watcher-error', (error) => {
      if (!this.mainWindow || this.mainWindow.isDestroyed?.()) return;
      this.mainWindow.webContents.send('main:flow-catalog-error', {
        workspaceUid,
        error: error?.message || String(error)
      });
    });
    await watcher.start();
    this.watchers.set(workspaceUid, { workspacePath: assertWorkspacePath(workspacePath), watcher });
  }

  async unwatchWorkspace(workspaceUid) {
    const current = this.watchers.get(workspaceUid);
    if (!current) return;
    this.watchers.delete(workspaceUid);
    await current.watcher.close();
  }

  async readFlow({ workspacePath, relativePath }) {
    return this.getStore(workspacePath).readFlow(relativePath);
  }

  async resolveFlowReference({ workspacePath, relativePath, flowUid }) {
    if (relativePath) return this.readFlow({ workspacePath, relativePath });
    if (!flowUid) throw new TypeError('Subflow requires relativePath or flowUid');
    const store = this.getStore(workspacePath);
    const catalog = await store.listFlows();
    const entry = catalog.find((candidate) => candidate.status === 'valid' && candidate.uid === flowUid);
    if (!entry) {
      const error = new Error(`Subflow ${flowUid} was not found`);
      error.code = 'FLOW_SUBFLOW_NOT_FOUND';
      throw error;
    }
    return store.readFlow(entry.relativePath);
  }

  async createFlow({ workspacePath, relativePath, flow }) {
    return this.getStore(workspacePath).createFlow({ relativePath, flow });
  }

  async saveFlow({ workspacePath, relativePath, flow, expectedRevision }) {
    return this.getStore(workspacePath).saveFlow({ relativePath, flow, expectedRevision });
  }

  async deleteFlow({ workspacePath, relativePath, expectedRevision }) {
    await this.getStore(workspacePath).deleteFlow(relativePath, expectedRevision);
    return { relativePath };
  }

  async moveFlow({ workspacePath, fromRelativePath, toRelativePath, expectedRevision }) {
    return this.getStore(workspacePath).moveFlow({
      fromRelativePath,
      toRelativePath,
      expectedRevision
    });
  }

  async saveDraft({ workspacePath, ...options }) {
    return this.getStore(workspacePath).saveDraft(options);
  }

  async listDrafts({ workspacePath }) {
    return this.getStore(workspacePath).listDrafts();
  }

  async recoverDraft({ workspacePath, draftUid }) {
    return this.getStore(workspacePath).recoverDraft(draftUid);
  }

  async applyDraft({ workspacePath, draftUid }) {
    return this.getStore(workspacePath).applyDraft(draftUid);
  }

  async discardDraft({ workspacePath, draftUid }) {
    await this.getStore(workspacePath).discardDraft(draftUid);
    return { draftUid };
  }

  async closeAll() {
    const watchers = [...this.watchers.values()].map(({ watcher }) => watcher.close());
    this.watchers.clear();
    await Promise.allSettled(watchers);
  }
}

module.exports = {
  FlowPersistenceService,
  assertWorkspacePath
};
