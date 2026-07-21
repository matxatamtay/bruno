import { flowCatalogEventReceived, flowCatalogFailed } from './flow-catalog';

export const createFlowCatalogEventHandler = ({ dispatch, workspaceUid }) => {
  return (event) => dispatch(flowCatalogEventReceived({ workspaceUid, event }));
};

export const bindFlowCatalogEventSource = ({ subscribe, dispatch, workspaceUid }) => {
  const handler = createFlowCatalogEventHandler({ dispatch, workspaceUid });
  return subscribe(handler);
};

export const registerFlowCatalogIpcListeners = ({ ipcRenderer, dispatch }) => {
  const removeEventListener = ipcRenderer.on('main:flow-catalog-event', ({ workspaceUid, event }) => {
    dispatch(flowCatalogEventReceived({ workspaceUid, event }));
  });
  const removeErrorListener = ipcRenderer.on('main:flow-catalog-error', ({ workspaceUid, error }) => {
    dispatch(flowCatalogFailed({ workspaceUid, error }));
  });

  return () => {
    removeEventListener();
    removeErrorListener();
  };
};
