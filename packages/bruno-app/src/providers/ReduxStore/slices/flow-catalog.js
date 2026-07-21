import { createSlice } from '@reduxjs/toolkit';

const initialState = {
  byWorkspace: {},
  activeFlowUidByWorkspace: {}
};

const createWorkspaceCatalog = () => ({
  ids: [],
  entities: {},
  status: 'idle',
  error: null,
  conflicts: {},
  drafts: {},
  draftError: null
});

const getWorkspaceCatalog = (state, workspaceUid) => {
  if (!state.byWorkspace[workspaceUid]) {
    state.byWorkspace[workspaceUid] = createWorkspaceCatalog();
  }
  return state.byWorkspace[workspaceUid];
};

const getEntryKey = (entry) => entry.uid || `invalid:${entry.relativePath}`;

const sortCatalog = (catalog) => {
  catalog.ids.sort((leftKey, rightKey) => {
    const left = catalog.entities[leftKey];
    const right = catalog.entities[rightKey];
    return (left?.relativePath || '').localeCompare(right?.relativePath || '');
  });
};

const upsertEntry = (catalog, entry) => {
  if (!entry?.relativePath) return;

  const staleKey = catalog.ids.find((key) => (
    catalog.entities[key]?.relativePath === entry.relativePath && key !== getEntryKey(entry)
  ));
  if (staleKey) {
    delete catalog.entities[staleKey];
    catalog.ids = catalog.ids.filter((key) => key !== staleKey);
  }

  const key = getEntryKey(entry);
  if (!catalog.entities[key]) catalog.ids.push(key);
  catalog.entities[key] = entry;
  sortCatalog(catalog);
};

const removeEntry = (catalog, event) => {
  const uid = event.previous?.uid || event.entry?.uid;
  const key = (uid && catalog.entities[uid] ? uid : null) || catalog.ids.find((candidate) => (
    catalog.entities[candidate]?.relativePath === event.relativePath
  ));
  if (!key) return;
  delete catalog.entities[key];
  catalog.ids = catalog.ids.filter((candidate) => candidate !== key);
  delete catalog.conflicts[key];
  delete catalog.drafts[key];
};

export const flowCatalogSlice = createSlice({
  name: 'flowCatalog',
  initialState,
  reducers: {
    flowCatalogLoading: (state, action) => {
      const catalog = getWorkspaceCatalog(state, action.payload.workspaceUid);
      catalog.status = 'loading';
      catalog.error = null;
    },
    flowCatalogLoaded: (state, action) => {
      const { workspaceUid, entries = [] } = action.payload;
      const catalog = getWorkspaceCatalog(state, workspaceUid);
      catalog.ids = [];
      catalog.entities = {};
      catalog.drafts = {};
      entries.forEach((entry) => upsertEntry(catalog, entry));
      catalog.status = 'ready';
      catalog.error = null;
      catalog.draftError = null;
    },
    flowCatalogFailed: (state, action) => {
      const catalog = getWorkspaceCatalog(state, action.payload.workspaceUid);
      catalog.status = 'error';
      catalog.error = action.payload.error;
    },
    flowCatalogEventReceived: (state, action) => {
      const { workspaceUid, event } = action.payload;
      const catalog = getWorkspaceCatalog(state, workspaceUid);
      if (event.type === 'deleted') {
        removeEntry(catalog, event);
      } else if (event.entry) {
        upsertEntry(catalog, event.entry);
      }
      catalog.status = 'ready';
      catalog.error = null;
    },
    flowConflictDetected: (state, action) => {
      const { workspaceUid, flowUid, conflict } = action.payload;
      const catalog = getWorkspaceCatalog(state, workspaceUid);
      catalog.conflicts[flowUid] = conflict;
    },
    flowConflictCleared: (state, action) => {
      const { workspaceUid, flowUid } = action.payload;
      const catalog = getWorkspaceCatalog(state, workspaceUid);
      delete catalog.conflicts[flowUid];
    },
    flowDraftRecoveryFailed: (state, action) => {
      const catalog = getWorkspaceCatalog(state, action.payload.workspaceUid);
      catalog.draftError = action.payload.error;
    },
    flowDraftRecoveryAvailable: (state, action) => {
      const { workspaceUid, flowUid, recovery } = action.payload;
      const catalog = getWorkspaceCatalog(state, workspaceUid);
      catalog.drafts[flowUid] = recovery;
      catalog.draftError = null;
    },
    flowDraftRecoveryCleared: (state, action) => {
      const { workspaceUid, flowUid } = action.payload;
      const catalog = getWorkspaceCatalog(state, workspaceUid);
      delete catalog.drafts[flowUid];
    },
    setActiveFlow: (state, action) => {
      const { workspaceUid, flowUid } = action.payload;
      state.activeFlowUidByWorkspace[workspaceUid] = flowUid;
    },
    clearWorkspaceFlowCatalog: (state, action) => {
      const workspaceUid = action.payload.workspaceUid;
      delete state.byWorkspace[workspaceUid];
      delete state.activeFlowUidByWorkspace[workspaceUid];
    }
  }
});

export const {
  flowCatalogLoading,
  flowCatalogLoaded,
  flowCatalogFailed,
  flowCatalogEventReceived,
  flowConflictDetected,
  flowConflictCleared,
  flowDraftRecoveryFailed,
  flowDraftRecoveryAvailable,
  flowDraftRecoveryCleared,
  setActiveFlow,
  clearWorkspaceFlowCatalog
} = flowCatalogSlice.actions;

export const selectWorkspaceFlowCatalog = (state, workspaceUid) => (
  state.flowCatalog.byWorkspace[workspaceUid] || createWorkspaceCatalog()
);

export const selectWorkspaceFlows = (state, workspaceUid) => {
  const catalog = selectWorkspaceFlowCatalog(state, workspaceUid);
  return catalog.ids.map((key) => catalog.entities[key]);
};

export const selectFlowCatalogEntry = (state, workspaceUid, flowUid) => (
  selectWorkspaceFlowCatalog(state, workspaceUid).entities[flowUid] || null
);

export const selectActiveFlowUid = (state, workspaceUid) => (
  state.flowCatalog.activeFlowUidByWorkspace[workspaceUid] || null
);

export default flowCatalogSlice.reducer;
