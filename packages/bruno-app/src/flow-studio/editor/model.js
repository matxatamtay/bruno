import { createFlowDefinition } from '@usebruno/flow-core';

export const FLOW_ASSET_MIME = 'application/x-bruno-flow-asset';
export const FLOW_ASSET_TEXT_PREFIX = 'bruno-flow-asset:';
export const REQUEST_NODE_KINDS = new Set(['http', 'graphql', 'websocket', 'grpc-unary', 'sse']);
export const CONTROL_NODE_KINDS = new Set(['start', 'end', 'condition', 'fork', 'join', 'delay', 'subflow', 'checkpoint', 'fail']);
export const INPUT_NODE_KINDS = new Set(['static-input', 'form-input', 'environment-input', 'dataset-input', 'dynamic-data']);
export const DATA_NODE_KINDS = new Set([...INPUT_NODE_KINDS, 'response-extractor', 'merge', 'secret-reference']);
export const BINDING_CHANNELS = ['runtime', 'body', 'query', 'path', 'header'];
export const LEGACY_BINDING_CHANNELS = [];
export const ALL_BINDING_CHANNELS = [...BINDING_CHANNELS];
export const FLOW_DATA_CASES_KEY = 'x-bruno-flow-cases';
export const FLOW_OUTPUT_SOURCE_KEY = 'x-bruno-flow-source';
export const FLOW_OUTPUT_MIME = 'application/x-bruno-flow-output';
export const FLOW_OUTPUT_TEXT_PREFIX = 'bruno-flow-output:';

const randomToken = () => {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID().replaceAll('-', '');
  }
  if (globalThis.crypto?.getRandomValues) {
    const bytes = new Uint32Array(4);
    globalThis.crypto.getRandomValues(bytes);
    return [...bytes].map((value) => value.toString(36)).join('');
  }
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
};

export const createEntityId = (prefix) => `${prefix}_${randomToken().slice(0, 32)}`;
const createUid = createEntityId;

export const toSemanticKey = (value, fallback = 'node') => {
  const normalized = String(value || '')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^[0-9]/, '_$&')
    .slice(0, 100);
  return normalized || fallback;
};

export const uniqueSemanticKey = (flow, desired, excludedNodeId = null) => {
  const base = toSemanticKey(desired);
  const used = new Set(flow.nodes.filter((node) => node.id !== excludedNodeId).map((node) => node.semanticKey));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
};

export const createAuthoringFlow = ({ uid, name, workspaceUid, now = new Date() }) => {
  const flow = createFlowDefinition({ uid, name, workspaceUid, now });
  const start = {
    id: createUid('node'),
    semanticKey: 'start',
    name: 'Start',
    kind: 'start',
    position: { x: 120, y: 240 },
    config: {}
  };
  const end = {
    id: createUid('node'),
    semanticKey: 'end',
    name: 'End',
    kind: 'end',
    position: { x: 760, y: 240 },
    config: {}
  };
  return {
    ...flow,
    nodes: [start, end]
  };
};

export const requestTypeToFlowKind = (type) => {
  if (type === 'graphql-request') return 'graphql';
  if (type === 'ws-request') return 'websocket';
  if (type === 'grpc-request') return 'grpc-unary';
  if (type === 'sse-request') return 'sse';
  return 'http';
};

export const createRequestNodeFromAsset = (flow, asset, position) => {
  const name = asset.name || 'Request';
  return {
    id: createUid('node'),
    semanticKey: uniqueSemanticKey(flow, name, null),
    name,
    kind: requestTypeToFlowKind(asset.type),
    position,
    requestRef: {
      collectionPath: asset.collectionPath,
      itemPathname: asset.itemPathname,
      ...(asset.itemUid ? { expectedItemUid: asset.itemUid } : {}),
      ...(asset.method ? { expectedMethod: asset.method } : {})
    },
    config: {
      asset: {
        collectionUid: asset.collectionUid,
        collectionName: asset.collectionName,
        itemUid: asset.itemUid,
        itemName: asset.name,
        requestShape: asset.requestShape || null
      },
      bindings: {
        runtime: {}
      }
    }
  };
};

export const createControlNode = (flow, kind, position, options = {}) => {
  const labels = {
    condition: 'Condition',
    fork: 'Fork',
    join: 'Join',
    delay: 'Delay',
    subflow: 'Subflow',
    checkpoint: 'Checkpoint',
    fail: 'Fail'
  };
  const name = options.name || labels[kind] || 'Control';
  const policy = kind === 'subflow'
    ? { sideEffect: 'once', resume: 'reuse' }
    : { sideEffect: 'none', resume: 'reuse' };
  return {
    id: createUid('node'),
    semanticKey: uniqueSemanticKey(flow, name),
    name,
    kind,
    position,
    config: {
      ...(kind === 'condition' ? { expression: options.expression || 'inputs.enabled === true' } : {}),
      ...(kind === 'fork' ? { joinNodeId: options.joinNodeId || '', branchCount: options.branchCount || 2 } : {}),
      ...(kind === 'join' ? { mode: options.mode || 'all', quorum: options.quorum || 2, merge: options.merge || 'last-branch-wins' } : {}),
      ...(kind === 'delay' ? { milliseconds: options.milliseconds || 0 } : {}),
      ...(kind === 'subflow' ? {
        relativePath: options.relativePath || '',
        flowUid: options.flowUid || '',
        datasetMode: options.datasetMode || 'single',
        datasetPath: options.datasetPath || '',
        maxItems: options.maxItems || 20,
        concurrency: options.concurrency || 4,
        inputSchema: options.inputSchema || { type: 'object', properties: {} },
        outputSchema: options.outputSchema || { type: 'object', properties: {} }
      } : {}),
      ...(kind === 'checkpoint' ? { mode: options.mode || 'pause' } : {}),
      ...(kind === 'fail' ? { message: options.message || 'Flow failed', code: options.code || 'FLOW_FAILED' } : {})
    },
    policy
  };
};

export const createInputNode = (flow, kind, position, options = {}) => {
  const labels = {
    'static-input': 'Static input',
    'form-input': 'Form input',
    'environment-input': 'Environment input',
    'dataset-input': 'Dataset input',
    'dynamic-data': 'Dynamic data',
    'response-extractor': 'Response extractor',
    'merge': 'Merge data',
    'secret-reference': 'Secret reference'
  };
  const name = options.name || labels[kind] || 'Input';
  return {
    id: createUid('node'),
    semanticKey: uniqueSemanticKey(flow, name),
    name,
    kind,
    position,
    config: {
      outputPath: options.outputPath || 'value',
      ...(kind === 'static-input' ? { value: options.value ?? '', secret: Boolean(options.secret) } : {}),
      ...(kind === 'environment-input' || kind === 'secret-reference' ? { variable: options.variable || '', secret: kind === 'secret-reference' || Boolean(options.secret) } : {}),
      ...(kind === 'dataset-input' ? { datasetPath: options.datasetPath || '', secret: Boolean(options.secret) } : {}),
      ...(kind === 'dynamic-data' ? {
        options: options.options || [
          { id: createUid('option'), label: 'Happy path', value: {} },
          { id: createUid('option'), label: 'Alternative', value: {} }
        ],
        selectedOptionId: options.selectedOptionId || '',
        secret: Boolean(options.secret)
      } : {}),
      ...(kind === 'form-input' ? {
        fieldName: options.fieldName || toSemanticKey(name),
        inputType: options.inputType || 'string',
        required: Boolean(options.required),
        secret: Boolean(options.secret)
      } : {}),
      ...(kind === 'response-extractor' ? {
        sourceNodeId: options.sourceNodeId || '',
        sourcePath: options.sourcePath || 'response.body',
        path: options.path || '',
        secret: Boolean(options.secret)
      } : {}),
      ...(kind === 'merge' ? { strategy: options.strategy || 'last-write-wins' } : {})
    }
  };
};

const inputSchemaDefinition = (node) => ({
  type: node.config?.inputType || 'string',
  title: node.name || node.semanticKey,
  ...(node.config?.secret ? { writeOnly: true } : {})
});

export const getFlowDataCases = (flow) => {
  const cases = flow?.inputSchema?.[FLOW_DATA_CASES_KEY];
  return Array.isArray(cases) ? cases.filter((dataCase) => dataCase?.id && dataCase?.name) : [];
};

export const upsertFlowDataCase = (flow, dataCase) => {
  const currentSchema = flow.inputSchema || { type: 'object', properties: {} };
  const cases = getFlowDataCases(flow);
  const id = dataCase.id || createUid('case');
  const nextCase = {
    id,
    name: String(dataCase.name || `Case ${cases.length + 1}`),
    values: { ...(dataCase.values || {}) }
  };
  const index = cases.findIndex((candidate) => candidate.id === id);
  const nextCases = [...cases];
  if (index >= 0) nextCases[index] = nextCase;
  else nextCases.push(nextCase);
  return {
    ...flow,
    inputSchema: {
      ...currentSchema,
      type: 'object',
      properties: { ...(currentSchema.properties || {}) },
      [FLOW_DATA_CASES_KEY]: nextCases
    }
  };
};

export const removeFlowDataCase = (flow, caseId) => {
  const currentSchema = flow.inputSchema || {};
  return {
    ...flow,
    inputSchema: {
      ...currentSchema,
      [FLOW_DATA_CASES_KEY]: getFlowDataCases(flow).filter((dataCase) => dataCase.id !== caseId)
    }
  };
};

export const getFlowOutputDefinitions = (flow) => {
  const schema = flow?.outputSchema || {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.entries(schema.properties || {}).map(([name, definition]) => ({
    name,
    type: definition?.type || 'string',
    title: definition?.title || name,
    description: definition?.description || '',
    required: required.has(name),
    secret: Boolean(definition?.writeOnly),
    sourceNodeId: definition?.[FLOW_OUTPUT_SOURCE_KEY]?.nodeId || '',
    sourcePath: definition?.[FLOW_OUTPUT_SOURCE_KEY]?.path || 'response.body'
  }));
};

export const upsertFlowOutput = (flow, output, previousName = null) => {
  const name = String(output?.name || '').trim();
  if (!name) return flow;
  const currentSchema = flow.outputSchema || {};
  const properties = { ...(currentSchema.properties || {}) };
  if (previousName && previousName !== name) delete properties[previousName];
  properties[name] = {
    ...(properties[name] || {}),
    type: output.type || 'string',
    title: output.title || name,
    ...(output.description ? { description: output.description } : {}),
    ...(output.secret ? { writeOnly: true } : {}),
    [FLOW_OUTPUT_SOURCE_KEY]: {
      nodeId: output.sourceNodeId || '',
      path: output.sourcePath || 'response.body'
    }
  };
  if (!output.secret) delete properties[name].writeOnly;
  const required = new Set(Array.isArray(currentSchema.required) ? currentSchema.required : []);
  if (previousName && previousName !== name) required.delete(previousName);
  if (output.required) required.add(name);
  else required.delete(name);
  return {
    ...flow,
    outputSchema: {
      ...currentSchema,
      type: 'object',
      properties,
      required: [...required]
    }
  };
};

export const removeFlowOutput = (flow, name) => {
  const currentSchema = flow.outputSchema || {};
  return {
    ...flow,
    outputSchema: {
      ...currentSchema,
      properties: Object.fromEntries(Object.entries(currentSchema.properties || {}).filter(([candidate]) => candidate !== name)),
      required: (currentSchema.required || []).filter((candidate) => candidate !== name)
    }
  };
};

export const ensureFormInputSchema = (flow, node, previousFieldName = null) => {
  if (node.kind !== 'form-input') return flow;
  const fieldName = String(node.config?.fieldName || node.semanticKey).trim();
  if (!fieldName) return flow;
  const currentSchema = flow.inputSchema || {};
  const properties = { ...(currentSchema.properties || {}) };
  if (previousFieldName && previousFieldName !== fieldName) delete properties[previousFieldName];
  properties[fieldName] = {
    ...(properties[fieldName] || {}),
    ...inputSchemaDefinition(node)
  };
  const required = new Set(Array.isArray(currentSchema.required) ? currentSchema.required : []);
  if (previousFieldName && previousFieldName !== fieldName) required.delete(previousFieldName);
  if (node.config?.required) required.add(fieldName);
  else required.delete(fieldName);
  return {
    ...flow,
    inputSchema: {
      ...currentSchema,
      type: 'object',
      properties,
      ...(required.size > 0 ? { required: [...required] } : { required: [] })
    }
  };
};

export const updateFormInputNode = (flow, nodeId, updates) => {
  const previous = flow.nodes.find((node) => node.id === nodeId);
  if (!previous || previous.kind !== 'form-input') return flow;
  const { name, semanticKey, ...configUpdates } = updates;
  const next = updateNode(flow, nodeId, (node) => ({
    ...node,
    ...(name !== undefined ? { name } : {}),
    ...(semanticKey !== undefined ? { semanticKey } : {}),
    config: { ...node.config, ...configUpdates }
  }));
  const updated = next.nodes.find((node) => node.id === nodeId);
  return updated ? ensureFormInputSchema(next, updated, previous.config?.fieldName) : next;
};

export const addNode = (flow, node) => {
  const next = { ...flow, nodes: [...flow.nodes, node] };
  return node.kind === 'form-input' ? ensureFormInputSchema(next, node) : next;
};

export const updateNode = (flow, nodeId, updates) => {
  let changed = false;
  const nodes = flow.nodes.map((node) => {
    if (node.id !== nodeId) return node;
    changed = true;
    const next = typeof updates === 'function' ? updates(node) : { ...node, ...updates };
    if (next.semanticKey !== node.semanticKey) {
      next.semanticKey = uniqueSemanticKey(flow, next.semanticKey, nodeId);
    }
    return next;
  });
  return changed ? { ...flow, nodes } : flow;
};

export const updateFrame = (flow, frameId, updates) => {
  let changed = false;
  const frames = flow.frames.map((frame) => {
    if (frame.id !== frameId) return frame;
    changed = true;
    return typeof updates === 'function' ? updates(frame) : { ...frame, ...updates };
  });
  return changed ? { ...flow, frames } : flow;
};

export const createFrame = (flow, options = {}) => ({
  ...flow,
  frames: [...flow.frames, {
    id: createUid('frame'),
    name: options.name || `Frame ${flow.frames.length + 1}`,
    position: options.position || { x: 160, y: 120 },
    size: options.size || { width: 520, height: 320 },
    metadata: {}
  }]
});

export const groupNodesInFrame = (flow, nodeIds) => {
  const selected = flow.nodes.filter((node) => nodeIds.includes(node.id) && !node.frameId);
  if (selected.length === 0) return flow;
  const minX = Math.min(...selected.map((node) => node.position.x));
  const minY = Math.min(...selected.map((node) => node.position.y));
  const maxX = Math.max(...selected.map((node) => node.position.x + (node.size?.width || 190)));
  const maxY = Math.max(...selected.map((node) => node.position.y + (node.size?.height || 90)));
  const frame = {
    id: createUid('frame'),
    name: `Group ${flow.frames.length + 1}`,
    position: { x: minX - 40, y: minY - 60 },
    size: { width: Math.max(320, maxX - minX + 80), height: Math.max(220, maxY - minY + 100) },
    metadata: {}
  };
  const selectedIds = new Set(selected.map((node) => node.id));
  const nodes = flow.nodes.map((node) => {
    if (!selectedIds.has(node.id)) return node;
    return {
      ...node,
      frameId: frame.id,
      position: {
        x: node.position.x - frame.position.x,
        y: node.position.y - frame.position.y
      }
    };
  });
  return { ...flow, frames: [...flow.frames, frame], nodes };
};

const removeEdgesForNodes = (flow, removedNodeIds) => ({
  controlEdges: flow.controlEdges.filter((edge) => !removedNodeIds.has(edge.sourceNodeId) && !removedNodeIds.has(edge.targetNodeId)),
  dataEdges: flow.dataEdges.filter((edge) => !removedNodeIds.has(edge.source.nodeId) && !removedNodeIds.has(edge.target.nodeId))
});

const cloneSerializable = (value) => {
  if (globalThis.structuredClone) return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

const uniqueFieldName = (flow, desired) => {
  const base = toSemanticKey(desired || 'input');
  const used = new Set(Object.keys(flow.inputSchema?.properties || {}));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
};

export const createFlowClipboard = (flow, selection) => {
  const selectedFrameIds = new Set(selection.frameIds || []);
  const selectedNodeIds = new Set(selection.nodeIds || []);
  flow.nodes.forEach((node) => {
    if (selectedFrameIds.has(node.frameId)) selectedNodeIds.add(node.id);
  });
  const nodes = flow.nodes.filter((node) => selectedNodeIds.has(node.id) && !['start', 'end'].includes(node.kind));
  nodes.forEach((node) => {
    if (node.frameId) selectedFrameIds.add(node.frameId);
  });
  const nodeIds = new Set(nodes.map((node) => node.id));
  const frames = flow.frames.filter((frame) => selectedFrameIds.has(frame.id));
  const frameIds = new Set(frames.map((frame) => frame.id));
  return {
    nodes: cloneSerializable(nodes),
    frames: cloneSerializable(frames),
    controlEdges: cloneSerializable(flow.controlEdges.filter((edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId))),
    dataEdges: cloneSerializable(flow.dataEdges.filter((edge) => nodeIds.has(edge.source.nodeId) && nodeIds.has(edge.target.nodeId))),
    inputProperties: Object.fromEntries(nodes
      .filter((node) => node.kind === 'form-input' && node.config?.fieldName)
      .map((node) => [node.config.fieldName, cloneSerializable(flow.inputSchema?.properties?.[node.config.fieldName] || {})])),
    selectedNodeIds: [...nodeIds],
    selectedFrameIds: [...frameIds]
  };
};

const remapNodeReferences = (value, nodeIdMap) => {
  if (Array.isArray(value)) return value.map((entry) => remapNodeReferences(entry, nodeIdMap));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => {
    if (key.endsWith('NodeId') && typeof entry === 'string') return [key, nodeIdMap.get(entry) || ''];
    return [key, remapNodeReferences(entry, nodeIdMap)];
  }));
};

export const pasteFlowClipboard = (flow, clipboard, offset = { x: 40, y: 40 }) => {
  if (!clipboard?.nodes?.length && !clipboard?.frames?.length) return { flow, selection: null };
  const nodeIdMap = new Map((clipboard.nodes || []).map((node) => [node.id, createUid('node')]));
  const frameIdMap = new Map((clipboard.frames || []).map((frame) => [frame.id, createUid('frame')]));
  let next = flow;
  const properties = { ...(next.inputSchema?.properties || {}) };
  const required = new Set(next.inputSchema?.required || []);
  const frames = (clipboard.frames || []).map((frame) => ({
    ...cloneSerializable(frame),
    id: frameIdMap.get(frame.id),
    position: { x: frame.position.x + offset.x, y: frame.position.y + offset.y },
    ...(frame.parentFrameId ? { parentFrameId: frameIdMap.get(frame.parentFrameId) } : {})
  }));
  const nodes = (clipboard.nodes || []).map((node) => {
    const id = nodeIdMap.get(node.id);
    const copied = {
      ...cloneSerializable(node),
      id,
      semanticKey: uniqueSemanticKey(next, `${node.semanticKey || node.name}_copy`),
      position: node.frameId && frameIdMap.has(node.frameId)
        ? { ...node.position }
        : { x: node.position.x + offset.x, y: node.position.y + offset.y },
      ...(node.frameId && frameIdMap.has(node.frameId) ? { frameId: frameIdMap.get(node.frameId) } : { frameId: undefined }),
      config: remapNodeReferences(cloneSerializable(node.config || {}), nodeIdMap)
    };
    if (copied.kind === 'form-input') {
      const previousField = node.config?.fieldName || copied.semanticKey;
      const fieldName = uniqueFieldName({ ...next, inputSchema: { ...next.inputSchema, properties } }, `${previousField}_copy`);
      copied.config = { ...copied.config, fieldName };
      properties[fieldName] = cloneSerializable(clipboard.inputProperties?.[previousField] || { type: copied.config.inputType || 'string', title: copied.name });
      if (copied.config.required) required.add(fieldName);
    }
    next = { ...next, nodes: [...next.nodes, copied] };
    return copied;
  });
  const controlEdges = (clipboard.controlEdges || []).map((edge) => ({
    ...cloneSerializable(edge),
    id: createUid('control'),
    sourceNodeId: nodeIdMap.get(edge.sourceNodeId),
    targetNodeId: nodeIdMap.get(edge.targetNodeId)
  }));
  const dataEdges = (clipboard.dataEdges || []).map((edge) => ({
    ...cloneSerializable(edge),
    id: createUid('data'),
    source: { ...edge.source, nodeId: nodeIdMap.get(edge.source.nodeId) },
    target: { ...edge.target, nodeId: nodeIdMap.get(edge.target.nodeId) }
  }));
  next = {
    ...next,
    frames: [...next.frames, ...frames],
    controlEdges: [...next.controlEdges, ...controlEdges],
    dataEdges: [...next.dataEdges, ...dataEdges],
    inputSchema: {
      ...(next.inputSchema || { type: 'object' }),
      type: 'object',
      properties,
      required: [...required]
    }
  };
  return {
    flow: next,
    selection: {
      nodeIds: nodes.map((node) => node.id),
      frameIds: frames.map((frame) => frame.id),
      controlEdgeIds: [],
      dataEdgeIds: []
    }
  };
};

export const autoLayoutFlow = (flow) => {
  const layoutNodes = flow.nodes.filter((node) => !node.frameId);
  if (layoutNodes.length < 2) return flow;
  const ids = new Set(layoutNodes.map((node) => node.id));
  const incoming = new Map(layoutNodes.map((node) => [node.id, 0]));
  const outgoing = new Map(layoutNodes.map((node) => [node.id, []]));
  flow.controlEdges.forEach((edge) => {
    if (!ids.has(edge.sourceNodeId) || !ids.has(edge.targetNodeId)) return;
    outgoing.get(edge.sourceNodeId).push(edge.targetNodeId);
    incoming.set(edge.targetNodeId, incoming.get(edge.targetNodeId) + 1);
  });
  const levels = new Map();
  const queue = layoutNodes
    .filter((node) => incoming.get(node.id) === 0)
    .sort((left, right) => (left.kind === 'start' ? -1 : right.kind === 'start' ? 1 : left.semanticKey.localeCompare(right.semanticKey)))
    .map((node) => node.id);
  queue.forEach((id) => levels.set(id, 0));
  while (queue.length > 0) {
    const id = queue.shift();
    const level = levels.get(id) || 0;
    outgoing.get(id).forEach((targetId) => {
      levels.set(targetId, Math.max(levels.get(targetId) || 0, level + 1));
      incoming.set(targetId, incoming.get(targetId) - 1);
      if (incoming.get(targetId) === 0) queue.push(targetId);
    });
  }
  let fallbackLevel = Math.max(0, ...levels.values()) + 1;
  layoutNodes.forEach((node) => {
    if (!levels.has(node.id)) levels.set(node.id, fallbackLevel++);
  });
  const grouped = new Map();
  layoutNodes.forEach((node) => {
    const level = levels.get(node.id);
    grouped.set(level, [...(grouped.get(level) || []), node]);
  });
  const positions = new Map();
  [...grouped.entries()].sort(([left], [right]) => left - right).forEach(([level, nodesAtLevel]) => {
    nodesAtLevel.sort((left, right) => (left.kind === 'start' ? -1 : right.kind === 'end' ? -1 : left.semanticKey.localeCompare(right.semanticKey)));
    nodesAtLevel.forEach((node, index) => positions.set(node.id, { x: 120 + level * 260, y: 100 + index * 140 }));
  });
  return {
    ...flow,
    nodes: flow.nodes.map((node) => positions.has(node.id) ? { ...node, position: positions.get(node.id) } : node)
  };
};

export const deleteEntities = (flow, selection) => {
  const removedNodeIds = new Set(selection.nodeIds || []);
  const removedFormFields = flow.nodes
    .filter((node) => removedNodeIds.has(node.id) && node.kind === 'form-input')
    .map((node) => node.config?.fieldName)
    .filter(Boolean);
  const removedFrameIds = new Set(selection.frameIds || []);
  const removedControlEdgeIds = new Set(selection.controlEdgeIds || []);
  const removedDataEdgeIds = new Set(selection.dataEdgeIds || []);
  const edges = removeEdgesForNodes(flow, removedNodeIds);
  const inputSchema = flow.inputSchema
    ? {
        ...flow.inputSchema,
        properties: Object.fromEntries(Object.entries(flow.inputSchema.properties || {}).filter(([name]) => !removedFormFields.includes(name))),
        required: (flow.inputSchema.required || []).filter((name) => !removedFormFields.includes(name))
      }
    : undefined;
  return {
    ...flow,
    nodes: flow.nodes
      .filter((node) => !removedNodeIds.has(node.id))
      .map((node) => removedFrameIds.has(node.frameId) ? { ...node, frameId: undefined } : node),
    frames: flow.frames
      .filter((frame) => !removedFrameIds.has(frame.id))
      .map((frame) => removedFrameIds.has(frame.parentFrameId) ? { ...frame, parentFrameId: undefined } : frame),
    controlEdges: edges.controlEdges.filter((edge) => !removedControlEdgeIds.has(edge.id)),
    dataEdges: edges.dataEdges.filter((edge) => !removedDataEdgeIds.has(edge.id)),
    ...(inputSchema ? { inputSchema } : {})
  };
};

export const addControlEdge = (flow, connection) => {
  if (!connection.source || !connection.target || connection.source === connection.target) return flow;
  const duplicate = flow.controlEdges.some((edge) => edge.sourceNodeId === connection.source && edge.targetNodeId === connection.target);
  if (duplicate) return flow;
  return {
    ...flow,
    controlEdges: [...flow.controlEdges, {
      id: createUid('control'),
      sourceNodeId: connection.source,
      targetNodeId: connection.target,
      ...(connection.sourceHandle ? { sourcePort: connection.sourceHandle } : {}),
      ...(connection.targetHandle ? { targetPort: connection.targetHandle } : {})
    }]
  };
};

export const bindingTargetPath = (channel, key) => channel === 'runtime' ? `runtime.${key}` : `request.${channel}.${key}`;

export const getNodeRequestOverride = (node, channel, key) => node.config?.requestOverrides?.[channel]?.[key];

export const setNodeRequestOverride = (flow, { targetNodeId, channel, key, value }) => {
  if (!BINDING_CHANNELS.includes(channel) || !key) return flow;
  const withoutBinding = removeNodeBinding(flow, { targetNodeId, channel, key });
  return updateNode(withoutBinding, targetNodeId, (node) => ({
    ...node,
    config: {
      ...node.config,
      requestOverrides: {
        ...(node.config?.requestOverrides || {}),
        [channel]: {
          ...(node.config?.requestOverrides?.[channel] || {}),
          [key]: value
        }
      }
    }
  }));
};

export const removeNodeRequestOverride = (flow, { targetNodeId, channel, key }) => updateNode(flow, targetNodeId, (node) => {
  const channelOverrides = { ...(node.config?.requestOverrides?.[channel] || {}) };
  delete channelOverrides[key];
  return {
    ...node,
    config: {
      ...node.config,
      requestOverrides: {
        ...(node.config?.requestOverrides || {}),
        [channel]: channelOverrides
      }
    }
  };
});

export const setDataMapping = (flow, { targetNodeId, targetPath, sourceNodeId, sourcePath = 'value', required = false }) => {
  if (!targetNodeId || !targetPath || !sourceNodeId || sourceNodeId === targetNodeId) return flow;
  const existing = flow.dataEdges.find((edge) => edge.target.nodeId === targetNodeId && edge.target.path === targetPath);
  const edge = {
    id: existing?.id || createUid('data'),
    source: { nodeId: sourceNodeId, path: sourcePath },
    target: { nodeId: targetNodeId, path: targetPath },
    required
  };
  return {
    ...flow,
    dataEdges: [...flow.dataEdges.filter((candidate) => candidate.id !== edge.id && !(candidate.target.nodeId === targetNodeId && candidate.target.path === targetPath)), edge]
  };
};

export const removeDataMapping = (flow, { targetNodeId, targetPath }) => ({
  ...flow,
  dataEdges: flow.dataEdges.filter((edge) => !(edge.target.nodeId === targetNodeId && edge.target.path === targetPath))
});

export const setNodeBinding = (flow, { targetNodeId, channel, key, sourceNodeId, sourcePath = 'value', required = false }) => {
  if (!BINDING_CHANNELS.includes(channel) || !key || !sourceNodeId || sourceNodeId === targetNodeId) return flow;
  const targetPath = bindingTargetPath(channel, key);
  const next = updateNode(flow, targetNodeId, (node) => {
    const bindings = node.config?.bindings || {};
    const channelOverrides = { ...(node.config?.requestOverrides?.[channel] || {}) };
    delete channelOverrides[key];
    return {
      ...node,
      config: {
        ...node.config,
        bindings: {
          ...bindings,
          [channel]: {
            ...(bindings[channel] || {}),
            [key]: { sourceNodeId, sourcePath, required }
          }
        },
        requestOverrides: {
          ...(node.config?.requestOverrides || {}),
          [channel]: channelOverrides
        }
      }
    };
  });
  return setDataMapping(next, { targetNodeId, targetPath, sourceNodeId, sourcePath, required });
};

export const removeNodeBinding = (flow, { targetNodeId, channel, key }) => {
  const targetPath = bindingTargetPath(channel, key);
  const next = updateNode(flow, targetNodeId, (node) => {
    const channelBindings = { ...(node.config?.bindings?.[channel] || {}) };
    delete channelBindings[key];
    return {
      ...node,
      config: {
        ...node.config,
        bindings: {
          ...(node.config?.bindings || {}),
          [channel]: channelBindings
        }
      }
    };
  });
  return {
    ...next,
    dataEdges: next.dataEdges.filter((edge) => !(edge.target.nodeId === targetNodeId && edge.target.path === targetPath))
  };
};

export const addDataEdge = (flow, connection) => {
  if (!connection.source || !connection.target || connection.source === connection.target) return flow;
  const sourceNode = flow.nodes.find((node) => node.id === connection.source);
  const targetNode = flow.nodes.find((node) => node.id === connection.target);
  if (!sourceNode || !targetNode || !DATA_NODE_KINDS.has(sourceNode.kind)) return flow;
  const sourcePath = sourceNode.config?.outputPath || 'value';
  const targetPath = 'runtime.value';
  const duplicate = flow.dataEdges.some((edge) => edge.source.nodeId === connection.source && edge.target.nodeId === connection.target && edge.target.path === targetPath);
  if (duplicate) return flow;
  return {
    ...flow,
    dataEdges: [...flow.dataEdges, {
      id: createUid('data'),
      source: { nodeId: connection.source, path: sourcePath },
      target: { nodeId: connection.target, path: targetPath },
      required: false
    }]
  };
};

export const addConnection = (flow, connection) => {
  const isData = String(connection.sourceHandle || '').startsWith('data') || String(connection.targetHandle || '').startsWith('data');
  return isData ? addDataEdge(flow, connection) : addControlEdge(flow, connection);
};

export const updateControlEdge = (flow, edgeId, updates) => ({
  ...flow,
  controlEdges: flow.controlEdges.map((edge) => edge.id === edgeId ? { ...edge, ...updates } : edge)
});

export const updateDataEdge = (flow, edgeId, updates) => ({
  ...flow,
  dataEdges: flow.dataEdges.map((edge) => edge.id === edgeId ? {
    ...edge,
    ...(updates.source ? { source: { ...edge.source, ...updates.source } } : {}),
    ...(updates.target ? { target: { ...edge.target, ...updates.target } } : {}),
    ...Object.fromEntries(Object.entries(updates).filter(([key]) => !['source', 'target'].includes(key)))
  } : edge)
});

export const countBindings = (node) => ALL_BINDING_CHANNELS.reduce((total, channel) => (
  total + Object.keys(node.config?.bindings?.[channel] || {}).length
), 0);

export const findEntity = (flow, selection) => {
  if (selection?.nodeIds?.length === 1) return { type: 'node', value: flow.nodes.find((node) => node.id === selection.nodeIds[0]) || null };
  if (selection?.frameIds?.length === 1) return { type: 'frame', value: flow.frames.find((frame) => frame.id === selection.frameIds[0]) || null };
  if (selection?.controlEdgeIds?.length === 1) return { type: 'control-edge', value: flow.controlEdges.find((edge) => edge.id === selection.controlEdgeIds[0]) || null };
  if (selection?.dataEdgeIds?.length === 1) return { type: 'data-edge', value: flow.dataEdges.find((edge) => edge.id === selection.dataEdgeIds[0]) || null };
  return { type: null, value: null };
};
