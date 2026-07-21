import {
  flowCatalogEventReceived,
  flowCatalogFailed,
  flowCatalogLoaded,
  flowCatalogLoading,
  flowConflictCleared,
  flowConflictDetected,
  flowDraftRecoveryAvailable,
  flowDraftRecoveryFailed,
  flowDraftRecoveryCleared
} from './flow-catalog';

export class FlowIpcError extends Error {
  constructor(error = {}) {
    super(error.message || 'Flow persistence operation failed');
    this.name = 'FlowIpcError';
    this.code = error.code || 'FLOW_PERSISTENCE_ERROR';
    this.pathname = error.pathname;
    this.expectedRevision = error.expectedRevision;
    this.actualRevision = error.actualRevision;
    this.issues = error.issues;
  }
}

export const invokeFlowIpc = async (ipcRenderer, channel, payload = {}) => {
  const result = await ipcRenderer.invoke(channel, payload);
  if (!result?.ok) {
    throw new FlowIpcError(result?.error);
  }
  return result.data;
};

const recordToCatalogEntry = (record) => ({
  uid: record.flow.uid,
  name: record.flow.name,
  relativePath: record.relativePath,
  pathname: record.pathname,
  revision: record.flow.revision,
  updatedAt: record.flow.metadata.updatedAt,
  tags: record.flow.metadata.tags || [],
  status: 'valid'
});

const dispatchRecord = (dispatch, workspaceUid, type, record, previous = null) => {
  dispatch(flowCatalogEventReceived({
    workspaceUid,
    event: {
      type,
      relativePath: record.relativePath,
      pathname: record.pathname,
      entry: recordToCatalogEntry(record),
      previous
    }
  }));
};

const getIpcRenderer = () => window.ipcRenderer;

export const loadWorkspaceFlowDraftRecoveries = ({ workspaceUid, workspacePath }) => async (dispatch) => {
  const drafts = await invokeFlowIpc(getIpcRenderer(), 'renderer:flow-draft-list', { workspacePath });
  const recoveries = await Promise.all(drafts.map((draft) => (
    invokeFlowIpc(getIpcRenderer(), 'renderer:flow-draft-recover', {
      workspacePath,
      draftUid: draft.draftUid
    })
  )));

  recoveries.forEach((recovery) => {
    dispatch(flowDraftRecoveryAvailable({
      workspaceUid,
      flowUid: recovery.draft.flowUid,
      recovery: {
        draftUid: recovery.draft.draftUid,
        savedAt: recovery.draft.savedAt,
        baseRevision: recovery.draft.baseRevision,
        currentRevision: recovery.currentRevision,
        hasConflict: recovery.hasConflict
      }
    }));
  });
  return recoveries;
};

export const openWorkspaceFlowCatalog = ({ workspaceUid, workspacePath }) => async (dispatch) => {
  dispatch(flowCatalogLoading({ workspaceUid }));
  try {
    const entries = await invokeFlowIpc(getIpcRenderer(), 'renderer:flow-catalog-open', {
      workspaceUid,
      workspacePath
    });
    dispatch(flowCatalogLoaded({ workspaceUid, entries }));
    try {
      await loadWorkspaceFlowDraftRecoveries({ workspaceUid, workspacePath })(dispatch);
    } catch (error) {
      dispatch(flowDraftRecoveryFailed({ workspaceUid, error: error.message }));
    }
    return entries;
  } catch (error) {
    dispatch(flowCatalogFailed({ workspaceUid, error: error.message }));
    return null;
  }
};

export const closeWorkspaceFlowCatalog = ({ workspaceUid }) => async () => {
  return invokeFlowIpc(getIpcRenderer(), 'renderer:flow-catalog-close', { workspaceUid });
};

export const readFlowFile = ({ workspacePath, relativePath }) => async () => {
  return invokeFlowIpc(getIpcRenderer(), 'renderer:flow-read', { workspacePath, relativePath });
};

export const createFlowFile = ({ workspaceUid, workspacePath, relativePath, flow }) => async (dispatch) => {
  const record = await invokeFlowIpc(getIpcRenderer(), 'renderer:flow-create', {
    workspacePath,
    relativePath,
    flow
  });
  dispatchRecord(dispatch, workspaceUid, 'created', record);
  return record;
};

export const saveFlowFile = ({
  workspaceUid,
  workspacePath,
  relativePath,
  flow,
  expectedRevision
}) => async (dispatch) => {
  try {
    const record = await invokeFlowIpc(getIpcRenderer(), 'renderer:flow-save', {
      workspacePath,
      relativePath,
      flow,
      expectedRevision
    });
    dispatch(flowConflictCleared({ workspaceUid, flowUid: record.flow.uid }));
    dispatchRecord(dispatch, workspaceUid, 'changed', record);
    return record;
  } catch (error) {
    if (error.code === 'FLOW_REVISION_CONFLICT') {
      dispatch(flowConflictDetected({
        workspaceUid,
        flowUid: flow.uid,
        conflict: {
          pathname: error.pathname,
          expectedRevision: error.expectedRevision,
          actualRevision: error.actualRevision,
          detectedAt: new Date().toISOString()
        }
      }));
    }
    throw error;
  }
};

export const deleteFlowFile = ({
  workspaceUid,
  workspacePath,
  relativePath,
  flowUid,
  expectedRevision
}) => async (dispatch) => {
  try {
    await invokeFlowIpc(getIpcRenderer(), 'renderer:flow-delete', {
      workspacePath,
      relativePath,
      expectedRevision
    });
    dispatch(flowCatalogEventReceived({
      workspaceUid,
      event: {
        type: 'deleted',
        relativePath,
        previous: { uid: flowUid, relativePath }
      }
    }));
  } catch (error) {
    if (error.code === 'FLOW_REVISION_CONFLICT') {
      dispatch(flowConflictDetected({
        workspaceUid,
        flowUid,
        conflict: {
          pathname: error.pathname,
          expectedRevision: error.expectedRevision,
          actualRevision: error.actualRevision,
          detectedAt: new Date().toISOString()
        }
      }));
    }
    throw error;
  }
};

export const moveFlowFile = ({
  workspaceUid,
  workspacePath,
  fromRelativePath,
  toRelativePath,
  expectedRevision,
  previous
}) => async (dispatch) => {
  try {
    const record = await invokeFlowIpc(getIpcRenderer(), 'renderer:flow-move', {
      workspacePath,
      fromRelativePath,
      toRelativePath,
      expectedRevision
    });
    dispatch(flowConflictCleared({ workspaceUid, flowUid: previous.uid }));
    dispatch(flowCatalogEventReceived({
      workspaceUid,
      event: { type: 'deleted', relativePath: fromRelativePath, previous }
    }));
    dispatchRecord(dispatch, workspaceUid, 'created', record, previous);
    return record;
  } catch (error) {
    if (error.code === 'FLOW_REVISION_CONFLICT') {
      dispatch(flowConflictDetected({
        workspaceUid,
        flowUid: previous.uid,
        conflict: {
          pathname: error.pathname,
          expectedRevision: error.expectedRevision,
          actualRevision: error.actualRevision,
          detectedAt: new Date().toISOString()
        }
      }));
    }
    throw error;
  }
};

export const saveFlowDraft = ({ workspaceUid, workspacePath, ...draft }) => async (dispatch) => {
  const saved = await invokeFlowIpc(getIpcRenderer(), 'renderer:flow-draft-save', {
    workspacePath,
    ...draft
  });
  dispatch(flowDraftRecoveryAvailable({
    workspaceUid,
    flowUid: saved.flowUid,
    recovery: {
      draftUid: saved.draftUid,
      savedAt: saved.savedAt,
      baseRevision: saved.baseRevision,
      hasConflict: false
    }
  }));
  return saved;
};

export const recoverFlowDraft = ({ workspaceUid, workspacePath, draftUid }) => async (dispatch) => {
  const recovery = await invokeFlowIpc(getIpcRenderer(), 'renderer:flow-draft-recover', {
    workspacePath,
    draftUid
  });
  dispatch(flowDraftRecoveryAvailable({
    workspaceUid,
    flowUid: recovery.draft.flowUid,
    recovery: {
      draftUid: recovery.draft.draftUid,
      savedAt: recovery.draft.savedAt,
      baseRevision: recovery.draft.baseRevision,
      currentRevision: recovery.currentRevision,
      hasConflict: recovery.hasConflict
    }
  }));
  return recovery;
};

export const applyFlowDraft = ({ workspaceUid, workspacePath, flowUid, draftUid }) => async (dispatch) => {
  try {
    const record = await invokeFlowIpc(getIpcRenderer(), 'renderer:flow-draft-apply', { workspacePath, draftUid });
    dispatch(flowDraftRecoveryCleared({ workspaceUid, flowUid }));
    dispatch(flowConflictCleared({ workspaceUid, flowUid }));
    dispatchRecord(dispatch, workspaceUid, 'changed', record);
    return record;
  } catch (error) {
    if (error.code === 'FLOW_REVISION_CONFLICT') {
      dispatch(flowConflictDetected({
        workspaceUid,
        flowUid,
        conflict: {
          pathname: error.pathname,
          expectedRevision: error.expectedRevision,
          actualRevision: error.actualRevision,
          detectedAt: new Date().toISOString()
        }
      }));
    }
    throw error;
  }
};

export const discardFlowDraft = ({ workspaceUid, workspacePath, flowUid, draftUid }) => async (dispatch) => {
  await invokeFlowIpc(getIpcRenderer(), 'renderer:flow-draft-discard', { workspacePath, draftUid });
  dispatch(flowDraftRecoveryCleared({ workspaceUid, flowUid }));
};
