import type {
  FlowControlEdge,
  FlowDataEdge,
  FlowDefinition,
  FlowDefinitionInput,
  FlowFrame,
  FlowNode,
  JsonObject,
  JsonValue
} from './types';
import { sha256Hex } from './hash';

const isPlainObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const compactObject = <T extends Record<string, unknown>>(value: T): T => {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
};

export const sortJsonValue = (value: unknown): JsonValue => {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort((left, right) => left.localeCompare(right))
        .map((key) => [key, sortJsonValue(value[key])])
    ) as JsonObject;
  }

  return value as JsonValue;
};

const canonicalizeNode = (node: FlowNode): FlowNode => compactObject({
  id: node.id,
  semanticKey: node.semanticKey,
  name: node.name,
  kind: node.kind,
  position: { x: node.position.x, y: node.position.y },
  size: node.size ? { width: node.size.width, height: node.size.height } : undefined,
  frameId: node.frameId,
  requestRef: node.requestRef ? compactObject({
    collectionPath: node.requestRef.collectionPath,
    itemPathname: node.requestRef.itemPathname,
    expectedItemUid: node.requestRef.expectedItemUid,
    expectedMethod: node.requestRef.expectedMethod,
    fingerprint: node.requestRef.fingerprint
  }) : undefined,
  config: sortJsonValue(node.config) as JsonObject,
  policy: node.policy ? sortJsonValue(node.policy) as JsonObject : undefined
}) as FlowNode;

const canonicalizeControlEdge = (edge: FlowControlEdge): FlowControlEdge => compactObject({
  id: edge.id,
  sourceNodeId: edge.sourceNodeId,
  sourcePort: edge.sourcePort,
  targetNodeId: edge.targetNodeId,
  targetPort: edge.targetPort,
  condition: edge.condition,
  label: edge.label
}) as FlowControlEdge;

const canonicalizeDataEdge = (edge: FlowDataEdge): FlowDataEdge => compactObject({
  id: edge.id,
  source: { nodeId: edge.source.nodeId, path: edge.source.path },
  target: { nodeId: edge.target.nodeId, path: edge.target.path },
  transform: edge.transform,
  required: edge.required
}) as FlowDataEdge;

const canonicalizeFrame = (frame: FlowFrame): FlowFrame => compactObject({
  id: frame.id,
  name: frame.name,
  position: { x: frame.position.x, y: frame.position.y },
  size: { width: frame.size.width, height: frame.size.height },
  parentFrameId: frame.parentFrameId,
  policy: frame.policy ? sortJsonValue(frame.policy) as JsonObject : undefined,
  metadata: frame.metadata ? sortJsonValue(frame.metadata) as JsonObject : undefined
}) as FlowFrame;

export const canonicalizeFlowWithoutRevision = (input: FlowDefinitionInput | FlowDefinition): Omit<FlowDefinition, 'revision'> => {
  const tags = input.metadata.tags ? [...input.metadata.tags].sort((left, right) => left.localeCompare(right)) : undefined;
  const capabilities = input.metadata.requires?.capabilities
    ? [...input.metadata.requires.capabilities].sort((left, right) => left.localeCompare(right))
    : undefined;

  return compactObject({
    schemaVersion: 1,
    uid: input.uid,
    name: input.name,
    description: input.description,
    workspace: { uid: input.workspace.uid },
    defaults: compactObject({
      environment: input.defaults.environment ? compactObject({
        workspaceEnvironmentUid: input.defaults.environment.workspaceEnvironmentUid,
        collectionEnvironmentUid: input.defaults.environment.collectionEnvironmentUid
      }) : undefined,
      timeoutMs: input.defaults.timeoutMs,
      retry: input.defaults.retry ? compactObject({
        maxAttempts: input.defaults.retry.maxAttempts,
        backoffMs: input.defaults.retry.backoffMs,
        strategy: input.defaults.retry.strategy
      }) : undefined,
      concurrency: input.defaults.concurrency,
      failureMode: input.defaults.failureMode,
      datasetLimit: input.defaults.datasetLimit,
      subflowDepth: input.defaults.subflowDepth
    }),
    inputSchema: input.inputSchema ? sortJsonValue(input.inputSchema) as JsonObject : undefined,
    outputSchema: input.outputSchema ? sortJsonValue(input.outputSchema) as JsonObject : undefined,
    nodes: input.nodes.map(canonicalizeNode),
    controlEdges: input.controlEdges.map(canonicalizeControlEdge),
    dataEdges: input.dataEdges.map(canonicalizeDataEdge),
    frames: input.frames.map(canonicalizeFrame),
    viewport: input.viewport ? { x: input.viewport.x, y: input.viewport.y, zoom: input.viewport.zoom } : undefined,
    metadata: compactObject({
      createdAt: input.metadata.createdAt,
      updatedAt: input.metadata.updatedAt,
      tags,
      requires: input.metadata.requires ? compactObject({
        bruno: input.metadata.requires.bruno,
        capabilities
      }) : undefined
    })
  }) as Omit<FlowDefinition, 'revision'>;
};

export const computeFlowRevision = (input: FlowDefinitionInput | FlowDefinition): string => {
  const canonical = canonicalizeFlowWithoutRevision(input);
  return `sha256:${sha256Hex(JSON.stringify(canonical))}`;
};

export const canonicalizeFlow = (input: FlowDefinitionInput | FlowDefinition): FlowDefinition => {
  const withoutRevision = canonicalizeFlowWithoutRevision(input);
  return {
    schemaVersion: 1,
    uid: withoutRevision.uid,
    name: withoutRevision.name,
    ...(withoutRevision.description !== undefined ? { description: withoutRevision.description } : {}),
    revision: computeFlowRevision(withoutRevision as FlowDefinitionInput),
    workspace: withoutRevision.workspace,
    defaults: withoutRevision.defaults,
    ...(withoutRevision.inputSchema !== undefined ? { inputSchema: withoutRevision.inputSchema } : {}),
    ...(withoutRevision.outputSchema !== undefined ? { outputSchema: withoutRevision.outputSchema } : {}),
    nodes: withoutRevision.nodes,
    controlEdges: withoutRevision.controlEdges,
    dataEdges: withoutRevision.dataEdges,
    frames: withoutRevision.frames,
    ...(withoutRevision.viewport !== undefined ? { viewport: withoutRevision.viewport } : {}),
    metadata: withoutRevision.metadata
  };
};
