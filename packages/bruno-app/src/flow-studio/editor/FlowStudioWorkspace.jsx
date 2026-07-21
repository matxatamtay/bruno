import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import toast from 'react-hot-toast';
import cloneDeep from 'lodash/cloneDeep';
import { useDispatch, useSelector } from 'react-redux';
import { IconAlertTriangle, IconFilePlus, IconGitBranch, IconRefresh, IconTrash } from '@tabler/icons';
import {
  applyFlowDraft,
  createFlowFile,
  discardFlowDraft,
  openWorkspaceFlowCatalog,
  readFlowFile,
  recoverFlowDraft,
  saveFlowDraft,
  saveFlowFile
} from 'providers/ReduxStore/slices/flow-catalog-actions';
import { selectWorkspaceFlowCatalog, selectWorkspaceFlows } from 'providers/ReduxStore/slices/flow-catalog';
import EnvironmentSelector from 'components/Environments/EnvironmentSelector';
import {
  findItemInCollection,
  getGlobalEnvironmentVariables,
  getGlobalEnvironmentVariablesMasked
} from 'utils/collections';
import { getPromptVariableNamesForRequest, promptForRequestVariables } from 'providers/ReduxStore/slices/collections/actions';
import {
  cancelFlowRun,
  deleteFlowCheckpoint,
  listFlowCheckpoints,
  previewFlowRequest,
  resumeFlow,
  runFlow
} from 'providers/ReduxStore/slices/flow-runtime-actions';
import {
  buildEnvironmentRuntimeValues,
  buildFlowRequestCatalog,
  collectRequestAssets
} from './assets';
import {
  autoLayoutFlow,
  createAuthoringFlow,
  createEntityId,
  createFlowClipboard,
  createFrame,
  deleteEntities,
  getFlowDataCases,
  groupNodesInFrame,
  pasteFlowClipboard,
  removeFlowDataCase,
  REQUEST_NODE_KINDS,
  upsertFlowDataCase
} from './model';
import { useFlowEditor } from './useFlowEditor';
import AssetsPanel from './components/AssetsPanel';
import FlowCanvas from './components/FlowCanvas';
import Inspector from './components/Inspector';
import Toolbar from './components/Toolbar';
import RunConsole from './components/RunConsole';
import { createRuntimeProjection, runtimeProjectionReducer } from './runtime-projection';
import './flow-studio.scss';

const emptySelection = () => ({ nodeIds: [], frameIds: [], controlEdgeIds: [], dataEdgeIds: [] });
const isEditableTarget = (target) => ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable;
const slugify = (value) => String(value || 'flow').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'flow';
const flowDebugError = (error) => ({
  name: error?.name,
  message: error?.message || String(error || 'Unknown error'),
  stack: error?.stack
});
const flowDebug = (stage, details = {}) => {
  const entry = { timestamp: new Date().toISOString(), stage, details };
  console.log(`[FLOW-DEBUG][renderer] ${stage}`, details);
  try {
    window.ipcRenderer?.send?.('renderer:flow-debug-log', entry);
  } catch (error) {
    console.error('[FLOW-DEBUG][renderer] unable to forward log', flowDebugError(error));
  }
};
const summarizeFlowForDebug = (flow) => ({
  uid: flow?.uid,
  revision: flow?.revision,
  nodes: (flow?.nodes || []).map((node) => ({
    id: node.id,
    kind: node.kind,
    semanticKey: node.semanticKey,
    requestRef: node.requestRef ? {
      collectionPath: node.requestRef.collectionPath,
      itemPathname: node.requestRef.itemPathname,
      expectedMethod: node.requestRef.expectedMethod,
      expectedItemUid: node.requestRef.expectedItemUid
    } : undefined
  })),
  controlEdges: (flow?.controlEdges || []).map((edge) => ({
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    sourcePort: edge.sourcePort,
    targetNodeId: edge.targetNodeId,
    targetPort: edge.targetPort
  })),
  dataEdgeCount: flow?.dataEdges?.length || 0
});
const summarizeCatalogForDebug = (requestCatalog) => requestCatalog.map((asset) => ({
  collectionPath: asset.collectionPath || asset.collection?.pathname,
  itemPathname: asset.itemPathname || asset.item?.pathname,
  itemUid: asset.item?.uid,
  itemName: asset.item?.name,
  itemType: asset.item?.type,
  method: asset.item?.request?.method
}));
const inputDefaults = (flow) => Object.fromEntries(Object.entries(flow?.inputSchema?.properties || {}).map(([name, definition]) => [
  name,
  definition.default ?? (definition.type === 'boolean' ? false : '')
]));

const FlowCatalogRail = ({ entries, activeFlowUid, onOpen, creating, onSetCreating, newFlowName, onNewFlowName, onCreate }) => (
  <div className="flow-catalog-rail">
    <div className="flow-panel-heading">
      <span>Flows</span>
      <button type="button" title="Create flow" onClick={() => onSetCreating(!creating)}><IconFilePlus size={15} /></button>
    </div>
    {creating && (
      <form
        className="flow-create-form"
        onSubmit={(event) => {
          event.preventDefault();
          onCreate();
        }}
      >
        <input autoFocus value={newFlowName} onChange={(event) => onNewFlowName(event.target.value)} placeholder="Checkout smoke" data-testid="flow-create-name" />
        <div><button type="submit" className="flow-primary-button" disabled={!newFlowName.trim()}>Create</button><button type="button" onClick={() => onSetCreating(false)}>Cancel</button></div>
      </form>
    )}
    <div className="flow-catalog-list">
      {entries.length === 0 && !creating && <div className="flow-empty-copy">No flows yet. Create one here.</div>}
      {entries.map((entry) => (
        <button
          type="button"
          key={entry.uid || entry.relativePath}
          className={`flow-catalog-entry ${activeFlowUid === entry.uid ? 'active' : ''} ${entry.status === 'invalid' ? 'invalid' : ''}`}
          onClick={() => entry.status === 'valid' && onOpen(entry)}
          disabled={entry.status !== 'valid'}
        >
          <span>{entry.name}</span>
          <small>{entry.relativePath}</small>
          {entry.status === 'invalid' && <IconAlertTriangle size={13} />}
        </button>
      ))}
    </div>
  </div>
);

const FlowStudioWorkspace = ({ collection, workspace }) => {
  const dispatch = useDispatch();
  const { globalEnvironments, activeGlobalEnvironmentUid } = useSelector((state) => state.globalEnvironments);
  const scopeUid = collection?.uid;
  const scopePath = collection?.pathname;
  const catalog = useSelector((state) => selectWorkspaceFlowCatalog(state, scopeUid));
  const flowEntries = useSelector((state) => selectWorkspaceFlows(state, scopeUid));
  const editor = useFlowEditor();
  const [record, setRecord] = useState(null);
  const [selection, setSelection] = useState(emptySelection);
  const [searchQuery, setSearchQuery] = useState('');
  const [projectionMs, setProjectionMs] = useState(0);
  const [saving, setSaving] = useState(false);
  const [loadingFlow, setLoadingFlow] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newFlowName, setNewFlowName] = useState('');
  const [externalChange, setExternalChange] = useState(null);
  const [runtime, dispatchRuntime] = useReducer(runtimeProjectionReducer, undefined, createRuntimeProjection);
  const [runInputs, setRunInputs] = useState({});
  const [activeCaseId, setActiveCaseId] = useState('');
  const [runHistory, setRunHistory] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  const [checkpoints, setCheckpoints] = useState([]);
  const [flowClipboard, setFlowClipboard] = useState(null);
  const searchInputRef = useRef(null);
  const draftTimerRef = useRef(null);

  const executionCollection = useMemo(() => {
    if (!collection) return null;
    const copy = cloneDeep(collection);
    copy.globalEnvironmentVariables = getGlobalEnvironmentVariables({
      globalEnvironments,
      activeGlobalEnvironmentUid
    });
    copy.globalEnvSecrets = getGlobalEnvironmentVariablesMasked({
      globalEnvironments,
      activeGlobalEnvironmentUid
    });
    return copy;
  }, [collection, globalEnvironments, activeGlobalEnvironmentUid]);
  const requestAssets = useMemo(() => collectRequestAssets(collection), [collection]);
  const requestCatalog = useMemo(() => buildFlowRequestCatalog(executionCollection), [executionCollection]);
  const environmentValues = useMemo(() => buildEnvironmentRuntimeValues(executionCollection), [executionCollection]);
  const activeEnvironment = (collection?.environments || []).find((environment) => environment.uid === collection.activeEnvironmentUid) || null;
  const activeEnvironmentName = activeEnvironment?.name || 'No environment';
  const activeGlobalEnvironment = (globalEnvironments || []).find((environment) => environment.uid === activeGlobalEnvironmentUid) || null;
  const activeFlowUid = record?.flow?.uid || editor.flow?.uid || null;
  const dataCases = useMemo(() => getFlowDataCases(editor.flow), [editor.flow]);
  const activeDataCase = dataCases.find((dataCase) => dataCase.id === activeCaseId) || null;
  const activeEntry = flowEntries.find((entry) => entry.uid === activeFlowUid);
  const reusableFlowAssets = useMemo(() => flowEntries
    .filter((entry) => entry.status === 'valid' && entry.uid !== activeFlowUid)
    .map((entry) => ({
      assetType: 'control',
      id: `subflow:${entry.uid || entry.relativePath}`,
      kind: 'subflow',
      name: entry.name,
      flowUid: entry.uid,
      relativePath: entry.relativePath,
      revision: entry.revision,
      inputSchema: entry.inputSchema,
      outputSchema: entry.outputSchema
    })), [activeFlowUid, flowEntries]);
  const draftRecovery = activeFlowUid ? catalog.drafts?.[activeFlowUid] : null;
  const showDraftRecovery = Boolean(draftRecovery && !editor.dirty);
  const hasSelection = Object.values(selection).some((ids) => Array.isArray(ids) && ids.length > 0);
  const refreshCheckpoints = useCallback(async (flowUid) => {
    if (!flowUid || !scopePath) {
      setCheckpoints([]);
      return [];
    }
    try {
      const next = await dispatch(listFlowCheckpoints({
        workspacePath: scopePath,
        flowUid
      }));
      setCheckpoints(next);
      return next;
    } catch (_) {
      setCheckpoints([]);
      return [];
    }
  }, [dispatch, scopePath]);
  const selectedRequestNode = selection.nodeIds?.length === 1
    ? editor.flow?.nodes?.find((node) => node.id === selection.nodeIds[0] && REQUEST_NODE_KINDS.has(node.kind)) || null
    : null;
  const selectedRequestAsset = selectedRequestNode
    ? requestAssets.find((asset) => (
      asset.itemUid === selectedRequestNode.requestRef?.expectedItemUid
      || asset.itemPathname === selectedRequestNode.requestRef?.itemPathname
    )) || null
    : null;

  const selectedRequestItem = selectedRequestAsset ? findItemInCollection(collection, selectedRequestAsset.itemUid) : null;

  const buildRunRequestCatalog = useCallback(async (flow) => {
    if (!executionCollection) return [];
    const referencedItems = new Map();
    (flow?.nodes || []).filter((node) => REQUEST_NODE_KINDS.has(node.kind)).forEach((node) => {
      const asset = requestCatalog.find((candidate) => (
        candidate.item?.uid === node.requestRef?.expectedItemUid
        || candidate.itemPathname === node.requestRef?.itemPathname
      ));
      if (asset?.item?.uid) referencedItems.set(asset.item.uid, asset.item);
    });
    const promptNames = [...referencedItems.values()].flatMap((item) => (
      getPromptVariableNamesForRequest(item, executionCollection)
    ));
    const promptVariables = await promptForRequestVariables(promptNames);
    const promptedCollection = cloneDeep(executionCollection);
    promptedCollection.promptVariables = promptVariables || {};
    return buildFlowRequestCatalog(promptedCollection);
  }, [executionCollection, requestCatalog]);

  useEffect(() => {
    if (catalog.status === 'idle') {
      dispatch(openWorkspaceFlowCatalog({ workspaceUid: scopeUid, workspacePath: scopePath }));
    }
  }, [catalog.status, dispatch, scopeUid, scopePath]);

  const openFlow = useCallback(async (entry, options = {}) => {
    if (!entry?.relativePath) return null;
    setLoadingFlow(true);
    try {
      const nextRecord = await dispatch(readFlowFile({ workspacePath: scopePath, relativePath: entry.relativePath }));
      setRecord(nextRecord);
      editor.load(nextRecord.flow, { baseRevision: nextRecord.flow.revision, dirty: Boolean(options.dirty) });
      setRunInputs(inputDefaults(nextRecord.flow));
      setActiveCaseId('');
      setRunHistory([]);
      dispatchRuntime({ type: 'reset', flowUid: nextRecord.flow.uid });
      setPreview(null);
      setPreviewError(null);
      setSelection(emptySelection());
      setExternalChange(null);
      refreshCheckpoints(nextRecord.flow.uid);
      return nextRecord;
    } catch (error) {
      toast.error(error.message || 'Unable to open flow');
      return null;
    } finally {
      setLoadingFlow(false);
    }
  }, [dispatch, editor.load, refreshCheckpoints, scopePath]);

  useEffect(() => {
    if (!record && !loadingFlow) {
      const firstValid = flowEntries.find((entry) => entry.status === 'valid');
      if (firstValid) openFlow(firstValid);
    }
  }, [record, loadingFlow, flowEntries, openFlow]);

  useEffect(() => {
    if (!record || !activeEntry?.revision || saving) return;
    if (activeEntry.revision === editor.baseRevision) return;
    if (editor.dirty) {
      setExternalChange({ expectedRevision: editor.baseRevision, actualRevision: activeEntry.revision });
    } else {
      openFlow(activeEntry);
    }
  }, [record, activeEntry?.revision, editor.baseRevision, editor.dirty, saving, openFlow]);

  const createFlow = useCallback(async () => {
    const name = newFlowName.trim();
    if (!name) return;
    const base = slugify(name);
    const usedPaths = new Set(flowEntries.map((entry) => entry.relativePath));
    let relativePath = `${base}.flow.yml`;
    let suffix = 2;
    while (usedPaths.has(relativePath)) relativePath = `${base}-${suffix++}.flow.yml`;
    const flow = createAuthoringFlow({ uid: createEntityId('flow'), name, workspaceUid: workspace?.uid || scopeUid });
    try {
      const nextRecord = await dispatch(createFlowFile({
        workspaceUid: scopeUid,
        workspacePath: scopePath,
        relativePath,
        flow
      }));
      setRecord(nextRecord);
      editor.load(nextRecord.flow, { baseRevision: nextRecord.flow.revision });
      setRunInputs(inputDefaults(nextRecord.flow));
      setActiveCaseId('');
      setRunHistory([]);
      dispatchRuntime({ type: 'reset', flowUid: nextRecord.flow.uid });
      setPreview(null);
      setPreviewError(null);
      setSelection(emptySelection());
      refreshCheckpoints(nextRecord.flow.uid);
      setCreating(false);
      setNewFlowName('');
      toast.success('Flow created');
    } catch (error) {
      toast.error(error.message || 'Unable to create flow');
    }
  }, [newFlowName, flowEntries, workspace?.uid, scopeUid, scopePath, dispatch, editor.load, refreshCheckpoints]);

  useEffect(() => {
    if (activeCaseId && !dataCases.some((dataCase) => dataCase.id === activeCaseId)) {
      setActiveCaseId('');
    }
  }, [activeCaseId, dataCases]);

  const changeDataCase = useCallback((caseId) => {
    setActiveCaseId(caseId);
    const dataCase = dataCases.find((candidate) => candidate.id === caseId);
    setRunInputs(dataCase ? { ...inputDefaults(editor.flow), ...dataCase.values } : inputDefaults(editor.flow));
  }, [dataCases, editor.flow]);

  const createDataCase = useCallback(() => {
    if (!editor.flow) return;
    const nextName = `Case ${dataCases.length + 1}`;
    const next = upsertFlowDataCase(editor.flow, { name: nextName, values: runInputs });
    const created = getFlowDataCases(next).at(-1);
    editor.commit(next, {});
    setActiveCaseId(created?.id || '');
    toast.success(`${nextName} created`);
  }, [dataCases.length, editor, runInputs]);

  const updateDataCase = useCallback(() => {
    if (!editor.flow || !activeDataCase) return;
    editor.commit(upsertFlowDataCase(editor.flow, { ...activeDataCase, values: runInputs }), {});
    toast.success(`${activeDataCase.name} updated`);
  }, [activeDataCase, editor, runInputs]);

  const renameDataCase = useCallback((name) => {
    const nextName = String(name || '').trim();
    if (!editor.flow || !activeDataCase || !nextName || nextName === activeDataCase.name) return;
    editor.commit(upsertFlowDataCase(editor.flow, { ...activeDataCase, name: nextName }), {});
  }, [activeDataCase, editor]);

  const deleteDataCase = useCallback(() => {
    if (!editor.flow || !activeDataCase) return;
    editor.commit(removeFlowDataCase(editor.flow, activeDataCase.id), {});
    setActiveCaseId('');
    setRunInputs(inputDefaults(editor.flow));
    toast.success(`${activeDataCase.name} deleted`);
  }, [activeDataCase, editor]);

  const save = useCallback(async () => {
    if (!record || !editor.flow || saving) return;
    const validation = editor.fullValidate();
    const blocking = validation.issues.filter((issue) => issue.severity !== 'warning');
    if (blocking.length > 0) {
      toast.error(`Flow has ${blocking.length} blocking validation issue(s)`);
      return;
    }
    setSaving(true);
    try {
      const nextRecord = await dispatch(saveFlowFile({
        workspaceUid: scopeUid,
        workspacePath: scopePath,
        relativePath: record.relativePath,
        flow: editor.flow,
        expectedRevision: editor.baseRevision
      }));
      setRecord(nextRecord);
      editor.markSaved(nextRecord.flow);
      setExternalChange(null);
      if (draftRecovery?.draftUid) {
        await dispatch(discardFlowDraft({
          workspaceUid: scopeUid,
          workspacePath: scopePath,
          flowUid: nextRecord.flow.uid,
          draftUid: draftRecovery.draftUid
        })).catch(() => null);
      }
      toast.success('Flow saved');
    } catch (error) {
      if (error.code === 'FLOW_REVISION_CONFLICT') {
        setExternalChange({ expectedRevision: error.expectedRevision, actualRevision: error.actualRevision });
        toast.error('Flow changed on disk. Your file was not overwritten.');
      } else {
        toast.error(error.message || 'Unable to save flow');
      }
    } finally {
      setSaving(false);
    }
  }, [record, editor, saving, dispatch, scopeUid, scopePath, draftRecovery]);

  useEffect(() => {
    clearTimeout(draftTimerRef.current);
    if (!record || !editor.flow || !editor.dirty || saving) return undefined;
    draftTimerRef.current = setTimeout(() => {
      dispatch(saveFlowDraft({
        workspaceUid: scopeUid,
        workspacePath: scopePath,
        flowUid: editor.flow.uid,
        relativePath: record.relativePath,
        baseRevision: editor.baseRevision,
        flow: editor.flow
      })).catch(() => null);
    }, 900);
    return () => clearTimeout(draftTimerRef.current);
  }, [record, editor.flow, editor.dirty, editor.baseRevision, saving, dispatch, scopeUid, scopePath]);

  const recoverDraft = useCallback(async () => {
    if (!draftRecovery?.draftUid) return;
    try {
      const recovery = await dispatch(recoverFlowDraft({
        workspaceUid: scopeUid,
        workspacePath: scopePath,
        draftUid: draftRecovery.draftUid
      }));
      editor.load(recovery.draft.flow, { baseRevision: recovery.draft.baseRevision, dirty: true });
      setExternalChange(recovery.hasConflict ? { expectedRevision: recovery.draft.baseRevision, actualRevision: recovery.currentRevision } : null);
      toast.success('Draft recovered into the editor');
    } catch (error) {
      toast.error(error.message || 'Unable to recover draft');
    }
  }, [draftRecovery, dispatch, scopeUid, scopePath, editor.load]);

  const applyDraft = useCallback(async () => {
    if (!draftRecovery?.draftUid || !activeFlowUid) return;
    try {
      const nextRecord = await dispatch(applyFlowDraft({
        workspaceUid: scopeUid,
        workspacePath: scopePath,
        flowUid: activeFlowUid,
        draftUid: draftRecovery.draftUid
      }));
      setRecord(nextRecord);
      editor.markSaved(nextRecord.flow, { keepHistory: false });
      setExternalChange(null);
    } catch (error) {
      toast.error(error.message || 'Draft conflicts with the current file');
    }
  }, [draftRecovery, activeFlowUid, dispatch, scopeUid, scopePath, editor.markSaved]);

  const discardDraft = useCallback(async () => {
    if (!draftRecovery?.draftUid || !activeFlowUid) return;
    await dispatch(discardFlowDraft({
      workspaceUid: scopeUid,
      workspacePath: scopePath,
      flowUid: activeFlowUid,
      draftUid: draftRecovery.draftUid
    }));
  }, [draftRecovery, activeFlowUid, dispatch, scopeUid, scopePath]);

  const deleteSelected = useCallback(() => {
    if (!editor.flow || !hasSelection) return;
    const next = deleteEntities(editor.flow, selection);
    editor.commit(next, {
      topology: true,
      nodeIds: selection.nodeIds,
      controlEdgeIds: selection.controlEdgeIds,
      dataEdgeIds: selection.dataEdgeIds
    });
    setSelection(emptySelection());
  }, [editor, hasSelection, selection]);

  const groupSelected = useCallback(() => {
    if (!editor.flow || selection.nodeIds.length === 0) return;
    const next = groupNodesInFrame(editor.flow, selection.nodeIds);
    editor.commit(next, { topology: true, nodeIds: selection.nodeIds, frameIds: next.frames.slice(-1).map((frame) => frame.id) });
  }, [editor, selection.nodeIds]);

  const addFrame = useCallback(() => {
    if (!editor.flow) return;
    const next = createFrame(editor.flow);
    const frame = next.frames[next.frames.length - 1];
    editor.commit(next, { frameIds: [frame.id] });
    setSelection({ ...emptySelection(), frameIds: [frame.id], focusNonce: Date.now() });
  }, [editor, flowClipboard]);

  useEffect(() => {
    const removeRuntimeListener = window.ipcRenderer?.on?.('main:flow-runtime-event', (event) => {
      flowDebug('runtime:event:received', {
        runId: event?.runId,
        flowUid: event?.flowUid,
        sequence: event?.sequence,
        type: event?.type,
        nodeId: event?.nodeId,
        edgeId: event?.edgeId,
        payloadKeys: Object.keys(event?.payload || {})
      });
      dispatchRuntime({ type: 'event', event });
    });
    return () => removeRuntimeListener?.();
  }, []);

  useEffect(() => {
    const onWindowError = (event) => {
      flowDebug('renderer:window-error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        error: flowDebugError(event.error)
      });
    };
    const onUnhandledRejection = (event) => {
      flowDebug('renderer:unhandled-rejection', { reason: flowDebugError(event.reason) });
    };
    window.addEventListener('error', onWindowError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    flowDebug('renderer:diagnostics-attached', {
      collectionUid: scopeUid,
      collectionPath: scopePath
    });
    return () => {
      window.removeEventListener('error', onWindowError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
    };
  }, [scopePath, scopeUid]);

  const runActiveFlow = useCallback(async () => {
    flowDebug('run:click', {
      runtimeStatus: runtime.status,
      hasFlow: Boolean(editor.flow),
      flow: summarizeFlowForDebug(editor.flow),
      requestCatalog: summarizeCatalogForDebug(requestCatalog),
      inputNames: Object.keys(runInputs || {}),
      environmentNames: Object.keys(environmentValues || {})
    });
    if (!editor.flow || runtime.status === 'queued' || runtime.status === 'running') {
      flowDebug('run:ignored', { hasFlow: Boolean(editor.flow), runtimeStatus: runtime.status });
      return;
    }
    const validation = editor.fullValidate();
    const blocking = validation.issues.filter((issue) => issue.severity !== 'warning');
    flowDebug('run:validation', {
      issueCount: validation.issues.length,
      blockingCount: blocking.length,
      issues: validation.issues.map((issue) => ({
        code: issue.code,
        severity: issue.severity,
        nodeId: issue.nodeId,
        edgeId: issue.edgeId,
        message: issue.message
      }))
    });
    if (blocking.length > 0) {
      toast.error(`Flow has ${blocking.length} blocking validation issue(s)`);
      return;
    }
    const runId = createEntityId('run');
    dispatchRuntime({ type: 'reset', runId, flowUid: editor.flow.uid });
    flowDebug('run:ipc-dispatch', { runId, flowUid: editor.flow.uid });
    try {
      const executionCatalog = await buildRunRequestCatalog(editor.flow);
      const result = await dispatch(runFlow({
        runId,
        flow: editor.flow,
        workspacePath: scopePath,
        workspaceContext: workspace ? { uid: workspace.uid, pathname: workspace.pathname } : null,
        requestCatalog: executionCatalog,
        inputs: runInputs,
        environmentValues
      }));
      flowDebug('run:ipc-result', {
        runId,
        resultRunId: result?.runId,
        status: result?.status,
        durationMs: result?.durationMs,
        nodeOrder: result?.nodeOrder,
        eventCount: result?.events?.length,
        resultNodeIds: Object.keys(result?.results || {}),
        error: result?.error
      });
      dispatchRuntime({ type: 'result', result });
      setRunHistory((current) => [{
        ...result,
        dataCaseId: activeCaseId || null,
        dataCaseName: activeDataCase?.name || 'Live inputs',
        inputs: cloneDeep(runInputs),
        completedAt: new Date().toISOString()
      }, ...current.filter((entry) => entry.runId !== result.runId)].slice(0, 20));
      if (result.status === 'paused') await refreshCheckpoints(editor.flow.uid);
      if (result.status === 'failed') toast.error(result.error?.message || 'Flow run failed');
    } catch (error) {
      flowDebug('run:ipc-error', { runId, error: flowDebugError(error) });
      dispatchRuntime({
        type: 'result',
        result: { runId, status: 'failed', error: { message: error.message || 'Flow run failed' } }
      });
      toast.error(error.message || 'Flow run failed');
    } finally {
      flowDebug('run:finished-renderer', { runId });
    }
  }, [editor, runtime.status, dispatch, scopePath, workspace, requestCatalog, runInputs, environmentValues, refreshCheckpoints, buildRunRequestCatalog, activeCaseId, activeDataCase?.name]);

  const resumeActiveFlow = useCallback(async (checkpointId) => {
    if (!editor.flow || !checkpointId || runtime.status === 'running' || runtime.status === 'queued') return;
    const runId = createEntityId('run');
    dispatchRuntime({ type: 'reset', runId, flowUid: editor.flow.uid });
    try {
      const executionCatalog = await buildRunRequestCatalog(editor.flow);
      const result = await dispatch(resumeFlow({
        runId,
        checkpointId,
        flow: editor.flow,
        workspacePath: scopePath,
        workspaceContext: workspace ? { uid: workspace.uid, pathname: workspace.pathname } : null,
        requestCatalog: executionCatalog,
        inputs: runInputs,
        environmentValues
      }));
      dispatchRuntime({ type: 'result', result });
      await refreshCheckpoints(editor.flow.uid);
      if (result.status === 'failed') toast.error(result.error?.message || 'Flow resume failed');
    } catch (error) {
      dispatchRuntime({ type: 'result', result: { runId, status: 'failed', error: { message: error.message || 'Flow resume failed' } } });
      toast.error(error.message || 'Flow resume failed');
    }
  }, [dispatch, editor.flow, environmentValues, refreshCheckpoints, requestCatalog, runInputs, runtime.status, scopePath, workspace, buildRunRequestCatalog]);

  const removeCheckpoint = useCallback(async (checkpointId) => {
    if (!editor.flow || !checkpointId) return;
    try {
      await dispatch(deleteFlowCheckpoint({
        workspacePath: scopePath,
        flowUid: editor.flow.uid,
        checkpointId
      }));
      await refreshCheckpoints(editor.flow.uid);
    } catch (error) {
      toast.error(error.message || 'Unable to delete checkpoint');
    }
  }, [dispatch, editor.flow, refreshCheckpoints, scopePath]);

  const cancelActiveRun = useCallback(async () => {
    if (!runtime.runId) return;
    await dispatch(cancelFlowRun(runtime.runId)).catch((error) => toast.error(error.message || 'Unable to cancel flow'));
  }, [dispatch, runtime.runId]);

  const resolveSelectedPreview = useCallback(async () => {
    if (!editor.flow || !selectedRequestNode) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    setPreviewing(true);
    setPreviewError(null);
    try {
      const resolved = await dispatch(previewFlowRequest({
        flow: editor.flow,
        nodeId: selectedRequestNode.id,
        workspacePath: scopePath,
        requestCatalog,
        inputs: runInputs,
        environmentValues
      }));
      setPreview(resolved.preview);
    } catch (error) {
      setPreview(null);
      setPreviewError(error.message || 'Unable to resolve request preview');
    } finally {
      setPreviewing(false);
    }
  }, [dispatch, editor.flow, selectedRequestNode, scopePath, requestCatalog, runInputs, environmentValues]);

  useEffect(() => {
    if (!selectedRequestNode) {
      setPreview(null);
      setPreviewError(null);
      return undefined;
    }
    const timer = setTimeout(resolveSelectedPreview, 220);
    return () => clearTimeout(timer);
  }, [selectedRequestNode?.id, runInputs, environmentValues, resolveSelectedPreview]);

  const copySelected = useCallback(() => {
    if (!editor.flow) return;
    const clipboard = createFlowClipboard(editor.flow, selection);
    if (!clipboard.nodes.length && !clipboard.frames.length) return;
    setFlowClipboard(clipboard);
    toast.success(`Copied ${clipboard.nodes.length + clipboard.frames.length} item(s)`);
  }, [editor.flow, selection]);

  const pasteCopied = useCallback(() => {
    if (!editor.flow || !flowClipboard) return;
    const pasted = pasteFlowClipboard(editor.flow, flowClipboard);
    if (pasted.flow === editor.flow || !pasted.selection) return;
    editor.commit(pasted.flow, { topology: true, ...pasted.selection });
    setSelection({ ...emptySelection(), ...pasted.selection, focusNonce: Date.now() });
  }, [editor, flowClipboard]);

  const autoLayout = useCallback(() => {
    if (!editor.flow) return;
    const next = autoLayoutFlow(editor.flow);
    if (next === editor.flow) return;
    editor.commit(next, { topology: true, nodeIds: next.nodes.map((node) => node.id) });
  }, [editor]);

  const focusSearchResult = useCallback(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!editor.flow || !query) return;
    const node = editor.flow.nodes.find((candidate) => [candidate.name, candidate.semanticKey, candidate.kind, candidate.requestRef?.itemPathname]
      .filter(Boolean).join(' ').toLowerCase().includes(query));
    if (node) setSelection({ ...emptySelection(), nodeIds: [node.id], focusNonce: Date.now() });
  }, [editor.flow, searchQuery]);

  useEffect(() => {
    const handleSaveEvent = () => save();
    const handleKeyDown = (event) => {
      const modifier = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 's') {
        event.preventDefault();
        save();
      } else if (modifier && key === 'z' && !event.shiftKey) {
        event.preventDefault();
        editor.undo();
      } else if ((modifier && event.shiftKey && key === 'z') || (modifier && key === 'y')) {
        event.preventDefault();
        editor.redo();
      } else if (modifier && key === 'c' && !isEditableTarget(event.target)) {
        event.preventDefault();
        copySelected();
      } else if (modifier && key === 'v' && !isEditableTarget(event.target)) {
        event.preventDefault();
        pasteCopied();
      } else if (modifier && key === 'f') {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (event.key === 'Enter' && document.activeElement === searchInputRef.current) {
        focusSearchResult();
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && !isEditableTarget(event.target)) {
        event.preventDefault();
        deleteSelected();
      } else if (event.key === 'Escape' && !isEditableTarget(event.target)) {
        setSelection(emptySelection());
      }
    };
    window.addEventListener('flow-studio-save', handleSaveEvent);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('flow-studio-save', handleSaveEvent);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [save, editor.undo, editor.redo, focusSearchResult, deleteSelected, copySelected, pasteCopied]);

  if (!scopePath) return <div className="flow-studio-loading">Collection path is unavailable.</div>;

  return (
    <div className="flow-studio-workspace" data-testid="flow-studio-workspace">
      <FlowCatalogRail
        entries={flowEntries}
        activeFlowUid={activeFlowUid}
        onOpen={openFlow}
        creating={creating}
        onSetCreating={setCreating}
        newFlowName={newFlowName}
        onNewFlowName={setNewFlowName}
        onCreate={createFlow}
      />

      <div className="flow-authoring-shell">
        <div className="flow-suite-header">
          <div className="flow-suite-header-copy">
            <strong>Flow Studio</strong>
            <span>Connect canonical Bruno HTTP and GraphQL requests. Variables, auth, scripts, tests, cookies and networking behave exactly like normal Send.</span>
          </div>
          <div className="flow-suite-context">
            <span className="flow-suite-context-chip" title={collection.name}>{collection.name}</span>
            {activeGlobalEnvironment && <span className="flow-suite-context-chip" title={activeGlobalEnvironment.name}>Global · {activeGlobalEnvironment.name}</span>}
            <EnvironmentSelector collection={collection} />
          </div>
        </div>
        <Toolbar
          flow={editor.flow}
          dirty={editor.dirty}
          saving={saving}
          canUndo={editor.canUndo}
          canRedo={editor.canRedo}
          validation={editor.validation}
          projectionMs={projectionMs}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          searchInputRef={searchInputRef}
          onSave={save}
          onUndo={editor.undo}
          onRedo={editor.redo}
          onAddFrame={addFrame}
          onGroup={groupSelected}
          onDelete={deleteSelected}
          onCopy={copySelected}
          onPaste={pasteCopied}
          onAutoLayout={autoLayout}
          canCopy={selection.nodeIds.length > 0 || selection.frameIds.length > 0}
          canPaste={Boolean(flowClipboard)}
          canGroup={selection.nodeIds.length > 0}
          canDelete={hasSelection}
          runStatus={runtime.status}
          onRun={runActiveFlow}
          onCancel={cancelActiveRun}
          dataCases={dataCases}
          activeCaseId={activeCaseId}
          onCaseChange={changeDataCase}
          onCreateCase={createDataCase}
          onUpdateCase={updateDataCase}
          onRenameCase={renameDataCase}
          onDeleteCase={deleteDataCase}
        />

        {(externalChange || showDraftRecovery) && (
          <div className={`flow-recovery-banner ${externalChange ? 'conflict' : ''}`}>
            <IconGitBranch size={15} />
            <span>
              {externalChange
                ? 'The flow changed on disk. Bruno will not overwrite it with a stale revision.'
                : `A recovery draft from ${new Date(draftRecovery.savedAt).toLocaleString()} is available.`}
            </span>
            {externalChange && activeEntry && <button type="button" onClick={() => openFlow(activeEntry)}><IconRefresh size={14} /> Reload disk</button>}
            {showDraftRecovery && <button type="button" onClick={recoverDraft}>Open draft</button>}
            {showDraftRecovery && !draftRecovery.hasConflict && <button type="button" onClick={applyDraft}>Apply draft</button>}
            {showDraftRecovery && <button type="button" onClick={discardDraft}><IconTrash size={13} /> Discard</button>}
          </div>
        )}

        <div className="flow-editor-layout">
          <AssetsPanel
            requestAssets={requestAssets}
            reusableFlowAssets={reusableFlowAssets}
            collectionName={collection.name}
            searchQuery={searchQuery}
            onSearchQueryChange={setSearchQuery}
            searchInputRef={null}
          />
          <main className="flow-canvas-region">
            {loadingFlow && <div className="flow-canvas-overlay">Loading flow…</div>}
            {!editor.flow && !loadingFlow && <div className="flow-empty-canvas"><IconFilePlus size={28} /><strong>Create or open a flow</strong><span>Then connect requests and map response values into Bruno runtime variables.</span></div>}
            {editor.flow && (
              <ReactFlowProvider>
                <FlowCanvas
                  flow={editor.flow}
                  validation={editor.validation}
                  searchQuery={searchQuery}
                  selection={selection}
                  onSelectionChange={setSelection}
                  onCommit={editor.commit}
                  onReplace={editor.replace}
                  onProjectionMeasured={setProjectionMs}
                  runtimeProjection={runtime}
                  requestAssets={requestAssets}
                />
              </ReactFlowProvider>
            )}
          </main>
          {editor.flow ? (
            <Inspector
              flow={editor.flow}
              selection={selection}
              validation={editor.validation}
              onCommit={editor.commit}
              requestAsset={selectedRequestAsset}
              requestItem={selectedRequestItem}
              environmentName={activeEnvironmentName}
              preview={preview}
              previewError={previewError}
              previewing={previewing}
              onPreview={resolveSelectedPreview}
              runtimeNode={selectedRequestNode ? runtime.nodes?.[selectedRequestNode.id] : null}
            />
          ) : (
            <aside className="flow-inspector"><div className="flow-panel-heading">Inspector</div></aside>
          )}
        </div>
        <RunConsole
          flow={editor.flow}
          runtime={runtime}
          inputs={runInputs}
          onInputChange={(name, value) => setRunInputs((current) => ({ ...current, [name]: value }))}
          onRun={runActiveFlow}
          onCancel={cancelActiveRun}
          onResume={resumeActiveFlow}
          onDeleteCheckpoint={removeCheckpoint}
          checkpoints={checkpoints}
          onPreview={resolveSelectedPreview}
          selectedRequestNode={selectedRequestNode}
          preview={preview}
          previewError={previewError}
          previewing={previewing}
          runHistory={runHistory}
          activeCaseName={activeDataCase?.name || 'Live inputs'}
        />
      </div>
    </div>
  );
};

export default FlowStudioWorkspace;
