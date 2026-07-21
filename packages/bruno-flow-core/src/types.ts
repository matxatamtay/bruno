export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface FlowPosition {
  x: number;
  y: number;
}

export interface FlowSize {
  width: number;
  height: number;
}

export interface FlowRetryPolicy {
  maxAttempts: number;
  backoffMs?: number;
  strategy?: 'fixed' | 'linear' | 'exponential';
}

export interface FlowDefaults {
  environment?: {
    workspaceEnvironmentUid?: string;
    collectionEnvironmentUid?: string;
  };
  timeoutMs?: number;
  retry?: FlowRetryPolicy;
  concurrency?: number;
  failureMode?: 'fail-fast' | 'collect-errors' | 'best-effort';
  datasetLimit?: number;
  subflowDepth?: number;
}

export type FlowJoinMode = 'all' | 'any' | 'quorum' | 'all-settled';
export type FlowJoinMergePolicy = 'last-branch-wins' | 'first-branch-wins' | 'error-on-conflict';
export type FlowSideEffectPolicy = 'none' | 'read-only' | 'idempotent' | 'once';
export type FlowNodeResumePolicy = 'reuse' | 'rerun' | 'forbid';

export interface FlowNodePolicy {
  retry?: FlowRetryPolicy;
  sideEffect?: FlowSideEffectPolicy;
  resume?: FlowNodeResumePolicy;
  allowReplay?: boolean;
  allowRetry?: boolean;
}

export interface FlowRequestReference {
  collectionPath: string;
  itemPathname: string;
  expectedItemUid?: string;
  expectedMethod?: string;
  fingerprint?: string;
}

export type FlowNodeKind = 'start' | 'end' | 'condition' | 'fork' | 'join' | 'delay' | 'subflow' | 'checkpoint' | 'fail'
  | 'http' | 'graphql' | 'websocket' | 'grpc-unary' | 'sse'
  | 'static-input' | 'form-input' | 'environment-input' | 'dataset-input' | 'response-extractor'
  | 'transform' | 'generator' | 'secret-reference' | 'merge' | 'set-variables';

export interface FlowNode {
  id: string;
  semanticKey: string;
  name?: string;
  kind: FlowNodeKind;
  position: FlowPosition;
  size?: FlowSize;
  frameId?: string;
  requestRef?: FlowRequestReference;
  config: JsonObject;
  policy?: FlowNodePolicy;
}

export interface FlowControlEdge {
  id: string;
  sourceNodeId: string;
  sourcePort?: string;
  targetNodeId: string;
  targetPort?: string;
  condition?: string;
  label?: string;
}

export interface FlowDataEndpoint {
  nodeId: string;
  path: string;
}

export interface FlowDataEdge {
  id: string;
  source: FlowDataEndpoint;
  target: FlowDataEndpoint;
  transform?: string;
  required?: boolean;
}

export interface FlowFrame {
  id: string;
  name: string;
  position: FlowPosition;
  size: FlowSize;
  parentFrameId?: string;
  policy?: JsonObject;
  metadata?: JsonObject;
}

export interface FlowViewport {
  x: number;
  y: number;
  zoom: number;
}

export interface FlowMetadata {
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  requires?: {
    bruno?: string;
    capabilities?: string[];
  };
}

export interface FlowDefinitionV1 {
  schemaVersion: 1;
  uid: string;
  name: string;
  description?: string;
  revision: string;
  workspace: { uid: string };
  defaults: FlowDefaults;
  inputSchema?: JsonObject;
  outputSchema?: JsonObject;
  nodes: FlowNode[];
  controlEdges: FlowControlEdge[];
  dataEdges: FlowDataEdge[];
  frames: FlowFrame[];
  viewport?: FlowViewport;
  metadata: FlowMetadata;
}

export type FlowDefinition = FlowDefinitionV1;
export type FlowDefinitionInput = Omit<FlowDefinitionV1, 'revision'> & { revision?: string };

export interface FlowValidationIssue {
  path: string;
  message: string;
  keyword?: string;
}

export interface ParsedFlowDocument {
  flow: FlowDefinition;
  storedRevision: string | null;
  computedRevision: string;
  revisionMismatch: boolean;
  migratedFrom: number | null;
  warnings: string[];
}

export interface CompilerDiagnostic {
  severity: 'error' | 'warning';
  code: string;
  message: string;
  nodeId?: string;
  edgeId?: string;
}

export interface CompiledFlowNode {
  id: string;
  semanticKey: string;
  kind: FlowNodeKind;
  incomingControlEdgeIds: string[];
  outgoingControlEdgeIds: string[];
  incomingDataEdgeIds: string[];
  outgoingDataEdgeIds: string[];
}

export interface CompiledFlow {
  compilerVersion: 1;
  flowUid: string;
  revision: string;
  entryNodeIds: string[];
  nodeOrder: string[];
  nodes: Record<string, CompiledFlowNode>;
  diagnostics: CompilerDiagnostic[];
}
