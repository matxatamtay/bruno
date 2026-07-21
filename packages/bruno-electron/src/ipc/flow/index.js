const { ipcMain } = require('electron');
const { FlowPersistenceService } = require('../../services/flow-persistence-service');

const serializeError = (error) => ({
  code: error?.code || 'FLOW_PERSISTENCE_ERROR',
  message: error?.message || String(error),
  ...(error?.pathname ? { pathname: error.pathname } : {}),
  ...(error?.expectedRevision ? { expectedRevision: error.expectedRevision } : {}),
  ...(error?.actualRevision ? { actualRevision: error.actualRevision } : {}),
  ...(error?.issues ? { issues: error.issues } : {})
});

const resultEnvelope = async (operation) => {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return { ok: false, error: serializeError(error) };
  }
};

const registerFlowIpc = (mainWindow, options = {}) => {
  const flowPersistenceService = options.flowPersistenceService || new FlowPersistenceService({ mainWindow });
  flowPersistenceService.setMainWindow(mainWindow);

  const register = (channel, handler) => {
    ipcMain.handle(channel, async (event, payload = {}) => resultEnvelope(() => handler(payload)));
  };

  register('renderer:flow-catalog-open', (payload) => flowPersistenceService.openCatalog(payload));
  register('renderer:flow-catalog-close', ({ workspaceUid }) => flowPersistenceService.unwatchWorkspace(workspaceUid));
  register('renderer:flow-read', (payload) => flowPersistenceService.readFlow(payload));
  register('renderer:flow-create', (payload) => flowPersistenceService.createFlow(payload));
  register('renderer:flow-save', (payload) => flowPersistenceService.saveFlow(payload));
  register('renderer:flow-delete', (payload) => flowPersistenceService.deleteFlow(payload));
  register('renderer:flow-move', (payload) => flowPersistenceService.moveFlow(payload));
  register('renderer:flow-draft-save', (payload) => flowPersistenceService.saveDraft(payload));
  register('renderer:flow-draft-list', (payload) => flowPersistenceService.listDrafts(payload));
  register('renderer:flow-draft-recover', (payload) => flowPersistenceService.recoverDraft(payload));
  register('renderer:flow-draft-apply', (payload) => flowPersistenceService.applyDraft(payload));
  register('renderer:flow-draft-discard', (payload) => flowPersistenceService.discardDraft(payload));

  return { flowPersistenceService };
};

module.exports = registerFlowIpc;
module.exports.serializeError = serializeError;
module.exports.resultEnvelope = resultEnvelope;
