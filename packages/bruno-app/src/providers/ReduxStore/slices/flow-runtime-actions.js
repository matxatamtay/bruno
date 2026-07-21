import { invokeFlowIpc } from './flow-catalog-actions';

const getIpcRenderer = () => window.ipcRenderer;

export const runFlow = (payload) => async () => invokeFlowIpc(
  getIpcRenderer(),
  'renderer:flow-run',
  payload
);

export const resumeFlow = (payload) => async () => invokeFlowIpc(
  getIpcRenderer(),
  'renderer:flow-resume',
  payload
);

export const cancelFlowRun = (runId) => async () => invokeFlowIpc(
  getIpcRenderer(),
  'renderer:flow-cancel',
  { runId }
);

export const previewFlowRequest = (payload) => async () => invokeFlowIpc(
  getIpcRenderer(),
  'renderer:flow-preview-request',
  payload
);

export const listFlowCheckpoints = (payload) => async () => invokeFlowIpc(
  getIpcRenderer(),
  'renderer:flow-checkpoint-list',
  payload
);

export const deleteFlowCheckpoint = (payload) => async () => invokeFlowIpc(
  getIpcRenderer(),
  'renderer:flow-checkpoint-delete',
  payload
);
