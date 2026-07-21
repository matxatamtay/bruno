const fs = require('fs/promises');
const path = require('path');
const { parseRequest } = require('@usebruno/filestore');
const {
  DeterministicFlowScheduler,
  appendProvenance,
  applyBindingTransform,
  createRuntimeValue,
  mergeRuntimeValues,
  resolveInputNode,
  resolveOutputValue,
  resolveRequestBindings,
  normalizeFlowDefinition
} = require('@usebruno/flow-core');
const { uuid } = require('../utils/common');
const { getCollectionFormat } = require('../utils/filesystem');
const { hydrateRequestWithUuid } = require('../utils/collection');
const { getRequestUid } = require('../cache/requestUids');
const { FlowCheckpointStore } = require('./flow-checkpoint-store');

const flowDebug = (stage, details = {}) => {
  console.log(`[FLOW-DEBUG][runtime][${new Date().toISOString()}] ${stage}`, details);
};
const debugError = (error) => ({
  name: error?.name,
  code: error?.code,
  message: error?.message || String(error || 'Unknown error'),
  stack: error?.stack,
  nodeId: error?.nodeId
});

const normalizePath = (value = '') => String(value).replace(/\\/g, '/').replace(/\/+$/, '');
const pathMatches = (candidate, expected) => {
  const left = normalizePath(candidate);
  const right = normalizePath(expected);
  return left === right || left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
};

const isRequestNode = (node) => ['http', 'graphql', 'websocket', 'grpc-unary', 'sse'].includes(node?.kind);
const isInputNode = (node) => ['static-input', 'form-input', 'environment-input', 'dataset-input', 'secret-reference'].includes(node?.kind);

const findCatalogAsset = (requestCatalog = [], node) => {
  const requestRef = node?.requestRef;
  if (!requestRef) throw new Error(`Request node ${node?.id || 'unknown'} has no requestRef`);
  const asset = requestCatalog.find((candidate) => {
    const collectionMatches = pathMatches(candidate.collectionPath || candidate.collection?.pathname, requestRef.collectionPath);
    const uidMatches = Boolean(requestRef.expectedItemUid && candidate.item?.uid === requestRef.expectedItemUid);
    const pathnameMatches = pathMatches(candidate.itemPathname || candidate.item?.pathname, requestRef.itemPathname);
    return collectionMatches && (uidMatches || pathnameMatches);
  });
  if (!asset) {
    throw new Error(`Request asset not found for ${requestRef.collectionPath}/${requestRef.itemPathname}`);
  }
  return asset;
};

const isPathInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const loadRequestAssetFromDisk = async (asset, node, payload) => {
  const requestRef = node.requestRef;
  const collectionPath = path.isAbsolute(requestRef.collectionPath)
    ? path.resolve(requestRef.collectionPath)
    : path.resolve(payload.workspacePath, requestRef.collectionPath);
  const catalogCollectionPath = path.resolve(asset.collection?.pathname || '');
  if (catalogCollectionPath !== collectionPath) {
    throw new Error(`Collection path mismatch for request node ${node.id}`);
  }
  const itemPath = path.resolve(collectionPath, requestRef.itemPathname);
  flowDebug('request-asset:disk-load:start', {
    runId: payload.runId,
    nodeId: node.id,
    collectionPath,
    itemPath,
    expectedMethod: requestRef.expectedMethod,
    expectedItemUid: requestRef.expectedItemUid
  });
  if (!isPathInside(collectionPath, itemPath)) {
    throw new Error(`Request path escapes collection for node ${node.id}`);
  }
  const [realCollectionPath, realItemPath] = await Promise.all([
    fs.realpath(collectionPath),
    fs.realpath(itemPath)
  ]);
  if (!isPathInside(realCollectionPath, realItemPath)) {
    throw new Error(`Request symlink escapes collection for node ${node.id}`);
  }
  const content = await fs.readFile(realItemPath, 'utf8');
  const item = await parseRequest(content, { format: getCollectionFormat(collectionPath) });
  item.raw = content;
  item.pathname = itemPath;
  item.uid = getRequestUid(itemPath);
  item.name = item.name || asset.item?.name || path.basename(itemPath, path.extname(itemPath));
  item.type = item.type || 'http-request';
  hydrateRequestWithUuid(item, itemPath);
  flowDebug('request-asset:disk-load:completed', {
    runId: payload.runId,
    nodeId: node.id,
    itemPath,
    itemUid: item.uid,
    itemName: item.name,
    itemType: item.type,
    method: item.request?.method
  });
  return {
    ...asset,
    collection: { ...asset.collection, pathname: collectionPath },
    item
  };
};

class FlowRuntimeService {
  constructor({
    requestExecutionService,
    flowPersistenceService = null,
    checkpointStore = new FlowCheckpointStore(),
    mainWindow = null,
    idFactory = uuid,
    now = () => new Date(),
    loadRequestAsset = loadRequestAssetFromDisk
  }) {
    if (!requestExecutionService) throw new TypeError('FlowRuntimeService requires requestExecutionService');
    this.requestExecutionService = requestExecutionService;
    this.flowPersistenceService = flowPersistenceService;
    this.checkpointStore = checkpointStore;
    this.mainWindow = mainWindow;
    this.idFactory = idFactory;
    this.now = now;
    this.loadRequestAsset = loadRequestAsset;
    this.activeRuns = new Map();
  }

  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  emitEvent(event) {
    flowDebug('event:emit', {
      runId: event?.runId,
      flowUid: event?.flowUid,
      sequence: event?.sequence,
      type: event?.type,
      nodeId: event?.nodeId,
      edgeId: event?.edgeId,
      payloadKeys: Object.keys(event?.payload || {})
    });
    if (!this.mainWindow || this.mainWindow.isDestroyed?.()) return;
    this.mainWindow.webContents.send('main:flow-runtime-event', event);
  }

  createScheduler(payload, controller) {
    return new DeterministicFlowScheduler({
      idFactory: this.idFactory,
      now: this.now,
      emitEvent: (event) => this.emitEvent(event),
      saveCheckpoint: async (checkpoint) => this.checkpointStore.save({
        workspacePath: payload.workspacePath,
        checkpoint
      }),
      resolveSubflow: async (node) => {
        if (!this.flowPersistenceService) throw new Error('FlowPersistenceService is required for subflows');
        const record = await this.flowPersistenceService.resolveFlowReference({
          workspacePath: payload.workspacePath,
          relativePath: node.config?.relativePath,
          flowUid: node.config?.flowUid
        });
        return record.flow;
      },
      resolveRequest: async (node) => {
        flowDebug('request:resolve:start', {
          runId: payload.runId,
          nodeId: node.id,
          kind: node.kind,
          requestRef: node.requestRef,
          catalogSize: payload.requestCatalog.length
        });
        try {
          const catalogAsset = findCatalogAsset(payload.requestCatalog, node);
          flowDebug('request:resolve:catalog-match', {
            runId: payload.runId,
            nodeId: node.id,
            collectionPath: catalogAsset.collectionPath || catalogAsset.collection?.pathname,
            itemPathname: catalogAsset.itemPathname || catalogAsset.item?.pathname,
            itemUid: catalogAsset.item?.uid,
            itemType: catalogAsset.item?.type
          });
          return await this.loadRequestAsset(catalogAsset, node, payload);
        } catch (error) {
          flowDebug('request:resolve:error', { runId: payload.runId, nodeId: node.id, error: debugError(error) });
          throw error;
        }
      },
      executeRequest: async ({ node, asset, item, signal, runId }) => {
        flowDebug('request:execute:start', {
          runId,
          nodeId: node.id,
          kind: node.kind,
          itemUid: item?.uid,
          itemName: item?.name,
          itemType: item?.type,
          method: item?.request?.method,
          aborted: Boolean(signal?.aborted)
        });
        try {
          const execution = await this.requestExecutionService.executeWithLegacy({
            workspaceContext: {
              uid: payload.flow.workspace?.uid,
              pathname: payload.workspacePath
            },
            collection: asset.collection,
            item,
            environmentContext: asset.environmentContext || payload.environmentContext,
            runtimeVariables: asset.runtimeVariables || payload.runtimeVariables,
            signal,
            executionContext: {
              source: 'flow-runtime',
              correlationId: runId,
              runInBackground: true,
              parentExecutionMode: 'flow-runtime',
              flowUid: payload.flow.uid,
              nodeId: node.id
            }
          });
          flowDebug('request:execute:completed', {
            runId,
            nodeId: node.id,
            normalizedStatus: execution?.result?.status,
            responseStatus: execution?.result?.response?.status ?? execution?.legacyResult?.status,
            hasLegacyResult: Boolean(execution?.legacyResult)
          });
          return execution;
        } catch (error) {
          flowDebug('request:execute:error', { runId, nodeId: node.id, error: debugError(error) });
          throw error;
        }
      }
    });
  }

  normalizeRunPayload(payload) {
    flowDebug('run:normalize-payload', {
      runId: payload.runId,
      workspacePath: payload.workspacePath,
      flowUid: payload.flow?.uid,
      nodeCount: payload.flow?.nodes?.length,
      controlEdgeCount: payload.flow?.controlEdges?.length,
      dataEdgeCount: payload.flow?.dataEdges?.length,
      catalogSize: payload.requestCatalog?.length
    });
    if (!payload.flow || typeof payload.flow !== 'object') throw new TypeError('Flow run requires flow');
    if (!Array.isArray(payload.requestCatalog)) throw new TypeError('Flow run requires requestCatalog');
    if (!payload.workspacePath || typeof payload.workspacePath !== 'string') throw new TypeError('Flow run requires workspacePath');
    return {
      ...payload,
      flow: normalizeFlowDefinition(payload.flow)
    };
  }

  async executeRun(payload, resumeState = null) {
    const normalizedPayload = this.normalizeRunPayload(payload);
    const runId = normalizedPayload.runId || this.idFactory();
    normalizedPayload.runId = runId;
    flowDebug('run:start', {
      runId,
      flowUid: normalizedPayload.flow.uid,
      revision: normalizedPayload.flow.revision,
      nodes: normalizedPayload.flow.nodes.map((node) => ({ id: node.id, kind: node.kind })),
      controlEdges: normalizedPayload.flow.controlEdges,
      resume: Boolean(resumeState)
    });
    if (this.activeRuns.has(runId)) throw new Error(`Flow run ${runId} is already active`);
    const controller = new AbortController();
    this.activeRuns.set(runId, controller);
    try {
      const scheduler = this.createScheduler(normalizedPayload, controller);
      flowDebug('run:scheduler-created', { runId });
      const result = await scheduler.run({
        flow: normalizedPayload.flow,
        inputs: normalizedPayload.inputs || {},
        environmentValues: normalizedPayload.environmentValues || {},
        dataset: normalizedPayload.dataset,
        signal: controller.signal,
        runId,
        resumeState
      });
      flowDebug('run:scheduler-returned', {
        runId,
        status: result.status,
        durationMs: result.durationMs,
        nodeOrder: result.nodeOrder,
        eventCount: result.events?.length,
        error: result.error
      });
      return result;
    } catch (error) {
      flowDebug('run:error', { runId, error: debugError(error) });
      throw error;
    } finally {
      this.activeRuns.delete(runId);
      flowDebug('run:cleanup', { runId, activeRunCount: this.activeRuns.size });
    }
  }

  run(payload = {}) {
    return this.executeRun(payload, null);
  }

  async resume(payload = {}) {
    const normalizedPayload = this.normalizeRunPayload(payload);
    if (!normalizedPayload.checkpointId) throw new TypeError('Flow resume requires checkpointId');
    const checkpoint = await this.checkpointStore.read({
      workspacePath: normalizedPayload.workspacePath,
      flowUid: normalizedPayload.flow.uid,
      checkpointId: normalizedPayload.checkpointId
    });
    return this.executeRun({
      ...normalizedPayload,
      runId: normalizedPayload.runId || this.idFactory()
    }, checkpoint);
  }

  listCheckpoints({ workspacePath, flowUid } = {}) {
    return this.checkpointStore.list({ workspacePath, flowUid });
  }

  deleteCheckpoint({ workspacePath, flowUid, checkpointId } = {}) {
    return this.checkpointStore.delete({ workspacePath, flowUid, checkpointId });
  }

  cancel(runId) {
    const controller = this.activeRuns.get(runId);
    if (!controller) return { cancelled: false, runId };
    controller.abort(new Error('Cancelled by user'));
    return { cancelled: true, runId };
  }

  async previewRequest(payload = {}) {
    const flow = normalizeFlowDefinition(payload.flow);
    const { nodeId } = payload;
    if (!flow || !nodeId) throw new TypeError('Resolved request preview requires flow and nodeId');
    const node = flow.nodes.find((candidate) => candidate.id === nodeId);
    if (!node || !isRequestNode(node)) throw new Error(`Request node ${nodeId} was not found`);
    const outputs = new Map();
    const resolving = new Set();

    const resolveDataNode = (sourceNodeId) => {
      if (outputs.has(sourceNodeId)) return;
      if (resolving.has(sourceNodeId)) throw new Error(`Data dependency cycle at ${sourceNodeId}`);
      resolving.add(sourceNodeId);
      const sourceNode = flow.nodes.find((candidate) => candidate.id === sourceNodeId);
      if (!sourceNode) throw new Error(`Data node ${sourceNodeId} was not found`);
      const incoming = flow.dataEdges.filter((edge) => edge.target.nodeId === sourceNodeId);
      incoming.forEach((edge) => resolveDataNode(edge.source.nodeId));

      if (isInputNode(sourceNode)) {
        outputs.set(sourceNodeId, resolveInputNode(flow, sourceNode, {
          formValues: payload.inputs || {},
          environmentValues: payload.environmentValues || {},
          dataset: payload.dataset
        }));
      } else if (sourceNode.kind === 'merge') {
        const values = incoming.map((edge) => {
          const value = resolveOutputValue(outputs, edge.source.nodeId, edge.source.path);
          if (!value) return null;
          return appendProvenance(applyBindingTransform(value, edge.transform), {
            kind: 'binding',
            nodeId: sourceNode.id,
            sourceNodeId: edge.source.nodeId,
            edgeId: edge.id,
            path: edge.target.path
          });
        }).filter(Boolean);
        const merged = mergeRuntimeValues(values, {
          strategy: sourceNode.config?.strategy === 'first-write-wins' ? 'first-write-wins' : 'last-write-wins'
        });
        outputs.set(sourceNodeId, {
          [String(sourceNode.config?.outputPath || 'value')]: createRuntimeValue(merged.value, {
            secret: merged.secret,
            provenance: merged.provenance
          })
        });
      } else {
        throw new Error(`Preview cannot resolve ${sourceNode.kind} before a flow run`);
      }
      resolving.delete(sourceNodeId);
    };

    flow.dataEdges.filter((edge) => edge.target.nodeId === nodeId).forEach((edge) => resolveDataNode(edge.source.nodeId));
    const asset = await this.loadRequestAsset(findCatalogAsset(payload.requestCatalog, node), node, payload);
    const resolved = resolveRequestBindings({ flow, node, item: asset.item, outputs });
    return {
      nodeId,
      preview: resolved.preview,
      bindings: resolved.bindings
    };
  }
}

module.exports = {
  FlowRuntimeService,
  findCatalogAsset,
  normalizePath,
  isPathInside,
  loadRequestAssetFromDisk,
  pathMatches
};
