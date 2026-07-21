const { ipcMain } = require('electron');
const { FlowRuntimeService } = require('../../services/flow-runtime-service');

const REDACTED_KEY = /(authorization|token|secret|password|cookie|api[-_]?key|body|environmentvalues|runtimevariables|inputs)/i;
const sanitizeDebugValue = (value, depth = 0) => {
  if (depth > 4) return '[MAX_DEPTH]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > 800 ? `${value.slice(0, 800)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => sanitizeDebugValue(entry, depth + 1));
  if (typeof value !== 'object') return String(value);
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [
    key,
    REDACTED_KEY.test(key) ? '[REDACTED]' : sanitizeDebugValue(entry, depth + 1)
  ]));
};
const flowDebug = (stage, details = {}) => {
  console.log(`[FLOW-DEBUG][main][${new Date().toISOString()}] ${stage}`, sanitizeDebugValue(details));
};
const summarizeRunPayload = (payload = {}) => ({
  runId: payload.runId,
  workspacePath: payload.workspacePath,
  flowUid: payload.flow?.uid,
  revision: payload.flow?.revision,
  nodes: (payload.flow?.nodes || []).map((node) => ({
    id: node.id,
    kind: node.kind,
    semanticKey: node.semanticKey,
    requestRef: node.requestRef
  })),
  controlEdges: payload.flow?.controlEdges,
  dataEdgeCount: payload.flow?.dataEdges?.length || 0,
  requestCatalog: (payload.requestCatalog || []).map((asset) => ({
    collectionPath: asset.collectionPath || asset.collection?.pathname,
    itemPathname: asset.itemPathname || asset.item?.pathname,
    itemUid: asset.item?.uid,
    itemName: asset.item?.name,
    itemType: asset.item?.type,
    method: asset.item?.request?.method
  })),
  inputNames: Object.keys(payload.inputs || {}),
  environmentNames: Object.keys(payload.environmentValues || {})
});

const serializeRuntimeError = (error) => ({
  code: error?.code || 'FLOW_RUNTIME_ERROR',
  message: error?.message || String(error),
  ...(error?.nodeId ? { nodeId: error.nodeId } : {})
});

const resultEnvelope = async (operation) => {
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return { ok: false, error: serializeRuntimeError(error) };
  }
};

const registerFlowRuntimeIpc = (mainWindow, options = {}) => {
  const flowRuntimeService = options.flowRuntimeService || new FlowRuntimeService({
    requestExecutionService: options.requestExecutionService,
    flowPersistenceService: options.flowPersistenceService,
    checkpointStore: options.checkpointStore,
    mainWindow
  });
  flowRuntimeService.setMainWindow(mainWindow);

  ipcMain.on('renderer:flow-debug-log', (event, entry = {}) => {
    flowDebug(`renderer:${entry.stage || 'log'}`, {
      rendererTimestamp: entry.timestamp,
      details: entry.details
    });
  });

  ipcMain.handle('renderer:flow-run', async (event, payload = {}) => {
    flowDebug('ipc:flow-run:received', summarizeRunPayload(payload));
    const envelope = await resultEnvelope(() => flowRuntimeService.run(payload));
    flowDebug('ipc:flow-run:returned', envelope.ok ? {
      ok: true,
      runId: envelope.data?.runId,
      status: envelope.data?.status,
      durationMs: envelope.data?.durationMs,
      nodeOrder: envelope.data?.nodeOrder,
      eventCount: envelope.data?.events?.length,
      error: envelope.data?.error
    } : { ok: false, error: envelope.error });
    return envelope;
  });
  ipcMain.handle('renderer:flow-resume', async (event, payload = {}) => resultEnvelope(() => flowRuntimeService.resume(payload)));
  ipcMain.handle('renderer:flow-cancel', async (event, { runId } = {}) => resultEnvelope(() => flowRuntimeService.cancel(runId)));
  ipcMain.handle('renderer:flow-preview-request', async (event, payload = {}) => resultEnvelope(() => flowRuntimeService.previewRequest(payload)));
  ipcMain.handle('renderer:flow-checkpoint-list', async (event, payload = {}) => resultEnvelope(() => flowRuntimeService.listCheckpoints(payload)));
  ipcMain.handle('renderer:flow-checkpoint-delete', async (event, payload = {}) => resultEnvelope(() => flowRuntimeService.deleteCheckpoint(payload)));

  return { flowRuntimeService };
};

module.exports = registerFlowRuntimeIpc;
module.exports.resultEnvelope = resultEnvelope;
module.exports.serializeRuntimeError = serializeRuntimeError;
