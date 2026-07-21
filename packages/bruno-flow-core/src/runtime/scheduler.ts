import { compileFlow } from '../compiler';
import type { FlowControlEdge, FlowDataEdge, FlowDefinition, FlowNode, FlowRetryPolicy } from '../types';
import { evaluateFlowCondition, type FlowConditionContext } from './condition';
import { resolveFlowInputs, resolveInputNode, type FlowInputContext } from './input';
import {
  checkpointJournalMap,
  journalMapToRecord,
  safeProjectJournal,
  type FlowCheckpointState,
  type FlowJournalEntry,
  type FlowResumePolicy,
  type FlowSideEffectClass
} from './journal';
import { applyBindingTransform, extractResponseValue, resolveRequestBindings, type ResolvedRequestPreview } from './request';
import {
  appendProvenance,
  createRuntimeValue,
  getPathValue,
  mergeRuntimeValues,
  resolveOutputValue,
  safeProjectOutputs,
  safeProjectRuntimeValue,
  safeProjectUnknown,
  type FlowNodeOutput,
  type FlowRuntimeOutputs,
  type FlowRuntimeValue
} from './value';

export type FlowRunStatus = 'queued' | 'running' | 'paused' | 'success' | 'failed' | 'cancelled';
export type FlowNodeRunStatus = 'idle' | 'queued' | 'resolving-input' | 'running' | 'retrying' | 'waiting' | 'reused' | 'success' | 'failed' | 'skipped' | 'cancelled';

export const FLOW_INTERNAL_OUTPUTS = Symbol('bruno.flow.internal-outputs');

export interface FlowRunEvent {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
  timestamp: string;
  source: 'flow-runtime';
  type: string;
  runId: string;
  flowUid: string;
  nodeId?: string;
  edgeId?: string;
  payload: Record<string, unknown>;
}

export interface FlowRequestAsset {
  collection: Record<string, unknown>;
  item: Record<string, unknown>;
  environmentContext?: unknown;
  runtimeVariables?: Record<string, unknown>;
}

export interface FlowRequestExecution {
  result: Record<string, unknown>;
  legacyResult?: Record<string, unknown>;
}

export interface DeterministicSchedulerOptions {
  idFactory?: () => string;
  now?: () => Date;
  emitEvent?: (event: FlowRunEvent) => void;
  resolveRequest: (node: FlowNode) => Promise<FlowRequestAsset> | FlowRequestAsset;
  executeRequest: (input: {
    node: FlowNode;
    asset: FlowRequestAsset;
    item: Record<string, unknown>;
    preview: ResolvedRequestPreview;
    runtimeVariables: Record<string, unknown>;
    signal?: AbortSignal;
    runId: string;
  }) => Promise<FlowRequestExecution>;
  resolveSubflow?: (node: FlowNode, parentFlow: FlowDefinition) => Promise<FlowDefinition> | FlowDefinition;
  saveCheckpoint?: (checkpoint: FlowCheckpointState) => Promise<{ checkpointId?: string } | void> | { checkpointId?: string } | void;
}

export type SequentialSchedulerOptions = DeterministicSchedulerOptions;

export interface FlowRunResult {
  runId: string;
  flowUid: string;
  status: FlowRunStatus;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  nodeOrder: string[];
  branchOrder: string[];
  results: Record<string, Record<string, unknown>>;
  previews: Record<string, ResolvedRequestPreview>;
  outputs: Record<string, Record<string, unknown>>;
  journal: Record<string, unknown>;
  events: FlowRunEvent[];
  checkpointId?: string;
  error?: { message: string; nodeId?: string };
  [FLOW_INTERNAL_OUTPUTS]?: FlowRuntimeOutputs;
}

interface RunState {
  flow: FlowDefinition;
  inputs: Record<string, unknown>;
  environmentValues: FlowInputContext['environmentValues'];
  dataset?: unknown;
  signal?: AbortSignal;
  runId: string;
  outputs: FlowRuntimeOutputs;
  results: Record<string, Record<string, unknown>>;
  previews: Record<string, ResolvedRequestPreview>;
  nodeOrder: string[];
  scope: string[];
  flowStack: string[];
}

interface NodeOutcome {
  status: 'success' | 'failed';
  error?: Error;
}

interface PathOutcome extends NodeOutcome {
  reachedStop?: boolean;
}

interface BranchOutcome extends PathOutcome {
  branchId: string;
  branchIndex: number;
  edge: FlowControlEdge;
  state: RunState;
}

const REQUEST_KINDS = new Set(['http', 'graphql', 'websocket', 'grpc-unary', 'sse']);
const INPUT_KINDS = new Set(['static-input', 'form-input', 'environment-input', 'dataset-input', 'dynamic-data', 'secret-reference']);
const DATA_KINDS = new Set([...INPUT_KINDS, 'response-extractor', 'merge']);
const HARD_DATASET_LIMIT = 100;
const HARD_SUBFLOW_DEPTH = 8;

export const getInternalFlowOutputs = (result: FlowRunResult): FlowRuntimeOutputs | undefined => result[FLOW_INTERNAL_OUTPUTS];

class FlowPausedError extends Error {
  checkpointId: string;

  constructor(checkpointId: string) {
    super(`Flow paused at checkpoint ${checkpointId}`);
    this.name = 'FlowPausedError';
    this.checkpointId = checkpointId;
  }
}

const asRecord = (value: unknown): Record<string, unknown> => (
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
);

const clone = <T>(value: T): T => {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

const sortedControlEdges = (edges: FlowControlEdge[]): FlowControlEdge[] => [...edges].sort((left, right) => (
  String(left.sourcePort || '').localeCompare(String(right.sourcePort || ''))
  || String(left.label || '').localeCompare(String(right.label || ''))
  || left.id.localeCompare(right.id)
));

type FlowNodeError = Error & { nodeId?: string; code?: string; status?: string };

const withNodeId = (error: Error, nodeId: string): FlowNodeError => {
  const tagged = error as FlowNodeError;
  if (!tagged.nodeId) tagged.nodeId = nodeId;
  return tagged;
};

const abortError = (message = 'Flow run cancelled'): Error => {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
};

const abortableDelay = async (milliseconds: number, signal?: AbortSignal): Promise<void> => {
  if (milliseconds <= 0) return;
  if (signal?.aborted) throw abortError();
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      reject(abortError());
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', abort, { once: true });
  });
};

const backoffForAttempt = (policy: FlowRetryPolicy, attempt: number): number => {
  const base = Math.max(0, Number(policy.backoffMs || 0));
  if (policy.strategy === 'linear') return base * attempt;
  if (policy.strategy === 'exponential') return base * (2 ** Math.max(0, attempt - 1));
  return base;
};

const requestResponseOutput = (node: FlowNode, execution: FlowRequestExecution): FlowNodeOutput => {
  const legacy = execution.legacyResult || {};
  const response = {
    status: legacy.status ?? (execution.result.response as Record<string, unknown> | undefined)?.status,
    headers: legacy.headers ?? (execution.result.response as Record<string, unknown> | undefined)?.headers,
    body: legacy.data ?? (execution.result.response as Record<string, unknown> | undefined)?.body
  };
  const provenance = [{ kind: 'response' as const, nodeId: node.id, path: 'response' }];
  return {
    'response': createRuntimeValue(response, { provenance }),
    'response.status': createRuntimeValue(response.status, { provenance }),
    'response.headers': createRuntimeValue(response.headers, { provenance }),
    'response.body': createRuntimeValue(response.body, { provenance }),
    'result': createRuntimeValue(execution.result, { provenance })
  };
};

const executionKeyFor = (state: RunState, node: FlowNode): string => [
  state.flow.uid,
  state.scope.length > 0 ? state.scope.join('/') : 'root',
  node.id
].join(':');

const sideEffectForNode = (node: FlowNode): FlowSideEffectClass => {
  const configured = String(asRecord(node.policy).sideEffect || '');
  if (['none', 'read-only', 'idempotent', 'once'].includes(configured)) return configured as FlowSideEffectClass;
  if (REQUEST_KINDS.has(node.kind) || node.kind === 'subflow') return 'once';
  return 'none';
};

const resumePolicyForNode = (node: FlowNode): FlowResumePolicy => {
  const configured = String(asRecord(node.policy).resume || 'reuse');
  return ['reuse', 'rerun', 'forbid'].includes(configured) ? configured as FlowResumePolicy : 'reuse';
};

const retryPolicyForNode = (flow: FlowDefinition, node: FlowNode): FlowRetryPolicy => {
  const policy = asRecord(node.policy);
  const configured = asRecord(policy.retry);
  const defaults = flow.defaults.retry || { maxAttempts: 1 };
  return {
    maxAttempts: Math.max(1, Math.min(20, Number(configured.maxAttempts ?? defaults.maxAttempts ?? 1))),
    backoffMs: Math.max(0, Number(configured.backoffMs ?? defaults.backoffMs ?? 0)),
    strategy: (configured.strategy || defaults.strategy || 'fixed') as FlowRetryPolicy['strategy']
  };
};

const rawOutputProjection = (outputs: FlowRuntimeOutputs): { value: Record<string, unknown>; secret: boolean } => {
  let secret = false;
  const value = Object.fromEntries([...outputs.entries()].map(([nodeId, output]) => [
    nodeId,
    Object.fromEntries(Object.entries(output).map(([path, runtimeValue]) => {
      secret ||= runtimeValue.secret;
      return [path, runtimeValue.value];
    }))
  ]));
  return { value, secret };
};

const contractedOutputProjection = (flow: FlowDefinition, outputs: FlowRuntimeOutputs): { value: Record<string, unknown>; secret: boolean } => {
  const endNode = flow.nodes.find((node) => node.kind === 'end');
  const contracted = endNode ? outputs.get(endNode.id) : null;
  if (!contracted || Object.keys(contracted).length === 0) return rawOutputProjection(outputs);
  let secret = false;
  const value = Object.fromEntries(Object.entries(contracted).map(([name, runtimeValue]) => {
    secret ||= runtimeValue.secret;
    return [name, runtimeValue.value];
  }));
  return { value, secret };
};

const safeProjectResults = (
  results: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> => safeProjectUnknown(results) as Record<string, Record<string, unknown>>;

const mapWithConcurrency = async <T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>,
  onError?: (error: unknown) => void
): Promise<R[]> => {
  const results = new Array<R>(values.length);
  let cursor = 0;
  let firstError: unknown;
  const worker = async (): Promise<void> => {
    while (cursor < values.length && !firstError) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await operation(values[index], index);
      } catch (error) {
        if (!firstError) {
          firstError = error;
          onError?.(error);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(values.length, Math.max(1, concurrency)) }, () => worker()));
  if (firstError) throw firstError;
  return results;
};

export class DeterministicFlowScheduler {
  private readonly idFactory: () => string;
  private readonly now: () => Date;
  private readonly externalEmit: (event: FlowRunEvent) => void;
  private readonly resolveRequestAsset: DeterministicSchedulerOptions['resolveRequest'];
  private readonly executeRequestAsset: DeterministicSchedulerOptions['executeRequest'];
  private readonly resolveSubflowDefinition?: DeterministicSchedulerOptions['resolveSubflow'];
  private readonly persistCheckpoint?: DeterministicSchedulerOptions['saveCheckpoint'];

  constructor(options: DeterministicSchedulerOptions) {
    this.idFactory = options.idFactory || (() => `flow_${Math.random().toString(36).slice(2)}`);
    this.now = options.now || (() => new Date());
    this.externalEmit = options.emitEvent || (() => {});
    this.resolveRequestAsset = options.resolveRequest;
    this.executeRequestAsset = options.executeRequest;
    this.resolveSubflowDefinition = options.resolveSubflow;
    this.persistCheckpoint = options.saveCheckpoint;
  }

  async run({
    flow,
    inputs = {},
    environmentValues = {},
    dataset,
    signal,
    runId = this.idFactory(),
    resumeState,
    _flowStack = [],
    _scope = []
  }: {
    flow: FlowDefinition;
    inputs?: Record<string, unknown>;
    environmentValues?: FlowInputContext['environmentValues'];
    dataset?: unknown;
    signal?: AbortSignal;
    runId?: string;
    resumeState?: FlowCheckpointState | null;
    _flowStack?: string[];
    _scope?: string[];
  }): Promise<FlowRunResult> {
    const compiled = compileFlow(flow);
    const started = this.now();
    const events: FlowRunEvent[] = [];
    const branchOrder: string[] = [];
    const resolvedDataEdgeIds = new Set<string>();
    const journal = new Map<string, FlowJournalEntry>();
    const resumeJournal = checkpointJournalMap(resumeState);
    const currentFlowStack = [..._flowStack, flow.uid];
    let sequence = 0;
    let activeNodeId: string | undefined;
    let lastCheckpointId: string | undefined;

    const configuredSubflowDepth = Math.max(1, Math.min(HARD_SUBFLOW_DEPTH, Number(flow.defaults.subflowDepth || HARD_SUBFLOW_DEPTH)));
    if (_flowStack.includes(flow.uid)) throw new Error(`Subflow cycle detected at ${flow.uid}`);
    if (currentFlowStack.length > configuredSubflowDepth) throw new Error(`Subflow depth exceeds ${configuredSubflowDepth}`);
    if (resumeState && (resumeState.rootFlowUid !== flow.uid || resumeState.rootRevision !== flow.revision)) {
      throw new Error('Checkpoint does not match the current flow revision');
    }

    const emit = (type: string, payload: Record<string, unknown> = {}, metadata: { nodeId?: string; edgeId?: string } = {}): void => {
      const event: FlowRunEvent = {
        schemaVersion: 1,
        eventId: this.idFactory(),
        sequence: ++sequence,
        timestamp: this.now().toISOString(),
        source: 'flow-runtime',
        type,
        runId,
        flowUid: flow.uid,
        ...metadata,
        payload: safeProjectUnknown(payload) as Record<string, unknown>
      };
      events.push(event);
      this.externalEmit(event);
    };

    const assertNotCancelled = (): void => {
      if (signal?.aborted) throw abortError();
    };

    const rootState: RunState = {
      flow,
      inputs,
      environmentValues,
      dataset,
      signal,
      runId,
      outputs: new Map(),
      results: {},
      previews: {},
      nodeOrder: [],
      scope: [..._scope],
      flowStack: currentFlowStack
    };

    const conditionContext = (state: RunState, error?: Error): FlowConditionContext => ({
      flow: state.flow,
      inputs: state.inputs,
      dataset: state.dataset,
      outputs: state.outputs,
      results: state.results,
      error: error ? {
        message: error.message,
        code: String((error as Error & { code?: string }).code || ''),
        status: String((error as Error & { status?: string }).status || '')
      } : null
    });

    const resolveDataEdge = (edge: FlowDataEdge, state: RunState): FlowRuntimeValue | undefined => {
      const source = resolveOutputValue(state.outputs, edge.source.nodeId, edge.source.path);
      if (!source) return undefined;
      const value = appendProvenance(applyBindingTransform(source, edge.transform), {
        kind: 'binding',
        nodeId: edge.target.nodeId,
        sourceNodeId: edge.source.nodeId,
        edgeId: edge.id,
        path: edge.target.path
      });
      if (!resolvedDataEdgeIds.has(edge.id)) {
        resolvedDataEdgeIds.add(edge.id);
        emit('flow.data-edge.resolved', {
          status: 'resolved',
          sourceNodeId: edge.source.nodeId,
          sourcePath: edge.source.path,
          targetNodeId: edge.target.nodeId,
          targetPath: edge.target.path,
          value: safeProjectRuntimeValue(value),
          secret: value.secret,
          provenance: value.provenance
        }, { nodeId: edge.target.nodeId, edgeId: edge.id });
      }
      return value;
    };

    let executeNode: (
      node: FlowNode,
      state: RunState,
      options?: { recordOrder?: boolean; dataStack?: Set<string> }
    ) => Promise<NodeOutcome>;

    const resolveDataNode = async (nodeId: string, state: RunState, stack = new Set<string>()): Promise<FlowNodeOutput> => {
      const existing = state.outputs.get(nodeId);
      if (existing) return existing;
      if (stack.has(nodeId)) throw new Error(`Data dependency cycle at ${nodeId}`);
      const node = state.flow.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) throw new Error(`Data node ${nodeId} does not exist`);
      if (REQUEST_KINDS.has(node.kind)) throw new Error(`Request node ${node.id} has not executed yet`);
      const outcome = await executeNode(node, state, { recordOrder: false, dataStack: new Set(stack).add(nodeId) });
      if (outcome.status === 'failed') throw outcome.error || new Error(`Data node ${node.id} failed`);
      return state.outputs.get(nodeId) || {};
    };

    const restoreJournalEntry = (entry: FlowJournalEntry, state: RunState): void => {
      if (entry.output) state.outputs.set(entry.nodeId, clone(entry.output));
      if (entry.result) state.results[entry.nodeId] = clone(entry.result);
      if (entry.preview) state.previews[entry.nodeId] = clone(entry.preview);
      journal.set(entry.executionKey, clone(entry));
    };

    const saveCheckpoint = async (node: FlowNode, state: RunState): Promise<string> => {
      if (!this.persistCheckpoint) throw new Error('Checkpoint persistence is not configured');
      if (state.flowStack.length > 1) throw new Error('Checkpoints must be placed in the parent flow, not inside a subflow');
      if (state.scope.some((part) => part.startsWith('fork:'))) {
        throw new Error('Pause checkpoints are only allowed outside active fork branches');
      }
      const checkpointId = this.idFactory();
      const checkpoint: FlowCheckpointState = {
        schemaVersion: 1,
        checkpointId,
        runId,
        rootFlowUid: flow.uid,
        rootRevision: flow.revision,
        nodeId: node.id,
        createdAt: this.now().toISOString(),
        journal: journalMapToRecord(journal)
      };
      const persisted = await this.persistCheckpoint?.(checkpoint);
      const resolvedCheckpointId = persisted?.checkpointId || checkpointId;
      lastCheckpointId = resolvedCheckpointId;
      emit('flow.checkpoint.saved', {
        checkpointId: resolvedCheckpointId,
        nodeId: node.id,
        journalEntries: checkpoint.journal ? Object.keys(checkpoint.journal).length : 0,
        mode: String(node.config?.mode || 'pause')
      }, { nodeId: node.id });
      return resolvedCheckpointId;
    };

    const executeSubflow = async (node: FlowNode, state: RunState): Promise<FlowNodeOutput> => {
      if (!this.resolveSubflowDefinition) throw new Error(`Subflow resolver is not configured for ${node.id}`);
      const subflow = await this.resolveSubflowDefinition(node, state.flow);
      if (state.flowStack.includes(subflow.uid)) throw new Error(`Subflow cycle detected at ${subflow.uid}`);
      const incoming = state.flow.dataEdges.filter((edge) => edge.target.nodeId === node.id);
      for (const edge of incoming) await resolveDataNode(edge.source.nodeId, state);
      const subflowInputs: Record<string, unknown> = {};
      incoming.forEach((edge) => {
        if (!edge.target.path.startsWith('subflow.input.')) return;
        const value = resolveDataEdge(edge, state);
        if (value) subflowInputs[edge.target.path.slice('subflow.input.'.length)] = value.value;
      });
      const resolvedSubflowInputs = resolveFlowInputs(subflow.inputSchema, subflowInputs);
      if (resolvedSubflowInputs.issues.length > 0) {
        const details = resolvedSubflowInputs.issues.map((issue) => `${issue.path} ${issue.message}`).join(', ');
        throw new Error(`Subflow ${subflow.name || subflow.uid} input contract failed: ${details}`);
      }

      const runChild = async (childDataset: unknown, index?: number, childSignal = state.signal): Promise<FlowRunResult> => {
        const childScheduler = new DeterministicFlowScheduler({
          idFactory: this.idFactory,
          now: this.now,
          resolveRequest: this.resolveRequestAsset,
          executeRequest: this.executeRequestAsset,
          resolveSubflow: this.resolveSubflowDefinition,
          emitEvent: (event) => emit('flow.subflow.event', {
            subflowUid: subflow.uid,
            index: index ?? null,
            event
          }, { nodeId: node.id })
        });
        return childScheduler.run({
          flow: subflow,
          inputs: resolvedSubflowInputs.values,
          environmentValues: state.environmentValues,
          dataset: childDataset,
          signal: childSignal,
          runId: `${state.runId}:${node.id}:${index ?? 0}`,
          _flowStack: state.flowStack,
          _scope: [...state.scope, `subflow:${node.id}:${index ?? 0}`]
        });
      };

      const datasetMode = String(node.config?.datasetMode || 'single');
      if (datasetMode === 'for-each') {
        const datasetPath = String(node.config?.datasetPath || '');
        const rows = datasetPath ? getPathValue(state.dataset, datasetPath) : state.dataset;
        if (!Array.isArray(rows)) throw new Error(`Subflow ${node.id} dataset is not an array`);
        const maxItems = Math.max(1, Math.min(
          HARD_DATASET_LIMIT,
          Number(node.config?.maxItems ?? state.flow.defaults.datasetLimit ?? 20)
        ));
        if (rows.length > maxItems) throw new Error(`Subflow ${node.id} dataset has ${rows.length} rows; limit is ${maxItems}`);
        const concurrency = Math.max(1, Math.min(20, Number(node.config?.concurrency ?? state.flow.defaults.concurrency ?? 4)));
        const datasetController = new AbortController();
        const abortDataset = () => datasetController.abort(state.signal?.reason || abortError());
        if (state.signal?.aborted) abortDataset();
        else state.signal?.addEventListener('abort', abortDataset, { once: true });
        let childResults;
        try {
          childResults = await mapWithConcurrency(rows, concurrency, async (row, index) => {
            const result = await runChild(row, index, datasetController.signal);
            if (result.status !== 'success') {
              throw new Error(`Subflow ${node.id} dataset item ${index} failed: ${result.error?.message || result.status}`);
            }
            return result;
          }, (error) => datasetController.abort(error));
        } finally {
          state.signal?.removeEventListener('abort', abortDataset);
        }
        const raw = childResults.map((result) => contractedOutputProjection(subflow, getInternalFlowOutputs(result) || new Map()));
        return {
          result: createRuntimeValue(childResults.map((result) => ({
            runId: result.runId,
            status: result.status,
            outputs: result.outputs
          })), { provenance: [{ kind: 'response', nodeId: node.id, path: 'subflow.result' }] }),
          outputs: createRuntimeValue(raw.map((entry) => entry.value), {
            secret: raw.some((entry) => entry.secret),
            provenance: [{ kind: 'response', nodeId: node.id, path: 'subflow.outputs' }]
          })
        };
      }

      const childResult = await runChild(state.dataset);
      if (childResult.status !== 'success') throw new Error(`Subflow ${node.id} failed: ${childResult.error?.message || childResult.status}`);
      const raw = contractedOutputProjection(subflow, getInternalFlowOutputs(childResult) || new Map());
      return {
        result: createRuntimeValue({
          runId: childResult.runId,
          status: childResult.status,
          outputs: childResult.outputs
        }, { provenance: [{ kind: 'response', nodeId: node.id, path: 'subflow.result' }] }),
        outputs: createRuntimeValue(raw.value, {
          secret: raw.secret,
          provenance: [{ kind: 'response', nodeId: node.id, path: 'subflow.outputs' }]
        })
      };
    };

    const executeAttempt = async (node: FlowNode, state: RunState, dataStack = new Set<string>()): Promise<void> => {
      assertNotCancelled();
      if (REQUEST_KINDS.has(node.kind)) {
        emit('flow.node.resolving-input', { status: 'resolving-input' }, { nodeId: node.id });
        const incoming = state.flow.dataEdges.filter((edge) => edge.target.nodeId === node.id);
        for (const edge of incoming) await resolveDataNode(edge.source.nodeId, state);
        const asset = await this.resolveRequestAsset(node);
        const resolved = resolveRequestBindings({ flow: state.flow, node, item: asset.item, outputs: state.outputs });
        state.previews[node.id] = resolved.preview;
        resolved.bindings.forEach((binding) => {
          resolvedDataEdgeIds.add(binding.edgeId);
          emit('flow.data-edge.resolved', {
            status: 'resolved',
            sourceNodeId: binding.sourceNodeId,
            sourcePath: binding.sourcePath,
            targetPath: binding.targetPath,
            value: binding.value,
            secret: binding.secret,
            provenance: binding.provenance
          }, { nodeId: node.id, edgeId: binding.edgeId });
        });
        emit('flow.node.resolved-request', { preview: resolved.preview }, { nodeId: node.id });
        const execution = await this.executeRequestAsset({
          node,
          asset,
          item: resolved.item,
          preview: resolved.preview,
          runtimeVariables: resolved.runtimeVariables,
          signal: state.signal,
          runId: state.runId
        });
        state.results[node.id] = execution.result;
        state.outputs.set(node.id, requestResponseOutput(node, execution));
        const status = String(execution.result.status || 'success');
        if (status !== 'success' && status !== 'skipped') {
          const error = new Error(`Request ${node.name || node.semanticKey} ${status}`) as Error & { status?: string };
          error.status = status;
          throw error;
        }
        return;
      }

      if (INPUT_KINDS.has(node.kind)) {
        state.outputs.set(node.id, resolveInputNode(state.flow, node, {
          formValues: state.inputs,
          environmentValues: state.environmentValues,
          dataset: state.dataset
        }));
        return;
      }

      if (node.kind === 'response-extractor' || node.kind === 'merge') {
        emit('flow.node.resolving-input', { status: 'resolving-input', dataNode: true }, { nodeId: node.id });
        const incoming = state.flow.dataEdges.filter((edge) => edge.target.nodeId === node.id);
        for (const edge of incoming) await resolveDataNode(edge.source.nodeId, state, dataStack);
        const incomingValues = incoming.map((edge) => {
          const value = resolveDataEdge(edge, state);
          if (!value && edge.required !== false) throw new Error(`Data edge ${edge.id} has no value`);
          return value;
        });
        if (node.kind === 'response-extractor') {
          const value = extractResponseValue(node, state.outputs, incoming);
          const outputPath = String(node.config?.outputPath || 'value');
          state.outputs.set(node.id, { [outputPath]: value, ...(outputPath === 'value' ? {} : { value }) });
        } else {
          const values = incomingValues.filter(Boolean) as FlowRuntimeValue[];
          const merged = mergeRuntimeValues(values, {
            strategy: node.config?.strategy === 'first-write-wins' ? 'first-write-wins' : 'last-write-wins'
          });
          const outputPath = String(node.config?.outputPath || 'value');
          state.outputs.set(node.id, {
            [outputPath]: createRuntimeValue(merged.value, {
              secret: merged.secret,
              provenance: [...merged.provenance, { kind: 'merge', nodeId: node.id, detail: merged.conflicts.join(',') }]
            })
          });
        }
        return;
      }

      if (node.kind === 'end') {
        const outputSchema = asRecord(state.flow.outputSchema);
        const properties = asRecord(outputSchema.properties);
        const contracted: FlowNodeOutput = {};
        const requiredOutputs = new Set(Array.isArray(outputSchema.required) ? outputSchema.required.map(String) : []);
        for (const [name, definitionValue] of Object.entries(properties)) {
          const definition = asRecord(definitionValue);
          const source = asRecord(definition['x-bruno-flow-source']);
          const sourceNodeId = String(source.nodeId || '');
          const sourcePath = String(source.path || 'response.body');
          if (!sourceNodeId) continue;
          try {
            if (!state.outputs.has(sourceNodeId)) await resolveDataNode(sourceNodeId, state, dataStack);
          } catch (error) {
            if (requiredOutputs.has(name)) throw error;
            continue;
          }
          const value = resolveOutputValue(state.outputs, sourceNodeId, sourcePath);
          if (!value) {
            if (requiredOutputs.has(name)) {
              throw new Error(`Required flow output ${name} could not resolve ${sourceNodeId}.${sourcePath}`);
            }
            continue;
          }
          contracted[name] = appendProvenance(createRuntimeValue(value.value, {
            secret: value.secret || definition.writeOnly === true,
            provenance: value.provenance
          }), {
            kind: 'binding',
            nodeId: node.id,
            sourceNodeId,
            path: `output.${name}`
          });
        }
        const incoming = state.flow.dataEdges.filter((edge) => edge.target.nodeId === node.id && edge.target.path.startsWith('output.'));
        for (const edge of incoming) {
          await resolveDataNode(edge.source.nodeId, state, dataStack);
          const value = resolveDataEdge(edge, state);
          if (value) contracted[edge.target.path.slice('output.'.length)] = value;
        }
        state.outputs.set(node.id, contracted);
        return;
      }

      if (node.kind === 'subflow') {
        state.outputs.set(node.id, await executeSubflow(node, state));
        return;
      }

      if (node.kind === 'delay') {
        await abortableDelay(Math.max(0, Number(node.config?.milliseconds || node.config?.delayMs || 0)), state.signal);
        state.outputs.set(node.id, {});
        return;
      }

      if (node.kind === 'fail') {
        const error = new Error(String(node.config?.message || `Flow failed at ${node.name || node.semanticKey}`)) as Error & { code?: string };
        error.code = String(node.config?.code || 'FLOW_FAIL_NODE');
        throw error;
      }

      state.outputs.set(node.id, {});
    };

    executeNode = async (node, state, options = {}) => {
      const recordOrder = options.recordOrder !== false;
      const executionKey = executionKeyFor(state, node);
      const sideEffect = sideEffectForNode(node);
      const resumePolicy = resumePolicyForNode(node);
      activeNodeId = node.id;
      if (recordOrder) state.nodeOrder.push(node.id);

      const completedThisRun = journal.get(executionKey);
      if (completedThisRun?.status === 'success') {
        restoreJournalEntry(completedThisRun, state);
        emit('flow.node.reused', { status: 'reused', source: 'current-run', executionKey }, { nodeId: node.id });
        return { status: 'success' };
      }

      const previous = resumeJournal.get(executionKey);
      if (previous && previous.status !== 'success' && previous.sideEffect === 'once' && asRecord(node.policy).allowReplay !== true) {
        return {
          status: 'failed',
          error: new Error(`Resume cannot safely repeat uncertain once-only side effect at ${node.id}`)
        };
      }
      if (previous?.status === 'success') {
        if (previous.resumePolicy === 'forbid' || resumePolicy === 'forbid') {
          return { status: 'failed', error: new Error(`Resume is forbidden for node ${node.id}`) };
        }
        if (resumePolicy === 'reuse') {
          restoreJournalEntry(previous, state);
          emit('flow.node.reused', {
            status: 'reused',
            source: 'checkpoint',
            executionKey,
            sideEffect: previous.sideEffect
          }, { nodeId: node.id });
          return { status: 'success' };
        }
        const policy = asRecord(node.policy);
        if (previous.sideEffect === 'once' && policy.allowReplay !== true) {
          return { status: 'failed', error: new Error(`Resume would repeat once-only side effect at ${node.id}`) };
        }
      }

      emit('flow.node.queued', { status: 'queued', kind: node.kind, executionKey }, { nodeId: node.id });
      emit('flow.node.started', { status: 'running', kind: node.kind, executionKey }, { nodeId: node.id });
      const retry = retryPolicyForNode(state.flow, node);
      const policy = asRecord(node.policy);
      const maxAttempts = sideEffect === 'once' && policy.allowRetry !== true ? 1 : retry.maxAttempts;
      let lastError: Error | undefined;
      let attempts = 0;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        assertNotCancelled();
        attempts = attempt;
        emit('flow.node.attempt-started', { attempt, maxAttempts }, { nodeId: node.id });
        try {
          await executeAttempt(node, state, options.dataStack);
          const output = state.outputs.get(node.id);
          const entry: FlowJournalEntry = {
            executionKey,
            flowUid: state.flow.uid,
            flowRevision: state.flow.revision,
            nodeId: node.id,
            scope: [...state.scope],
            status: 'success',
            attempts,
            sideEffect,
            resumePolicy,
            completedAt: this.now().toISOString(),
            ...(output ? { output: clone(output) } : {}),
            ...(state.results[node.id] ? { result: clone(state.results[node.id]) } : {}),
            ...(state.previews[node.id] ? { preview: clone(state.previews[node.id]) } : {})
          };
          journal.set(executionKey, entry);
          emit('flow.node.completed', {
            status: 'success',
            attempt,
            outputPaths: Object.keys(output || {}),
            safeOutput: output ? Object.fromEntries(Object.entries(output).map(([path, value]) => [path, safeProjectRuntimeValue(value)])) : {},
            result: state.results[node.id],
            preview: state.previews[node.id]
          }, { nodeId: node.id });

          if (node.kind === 'checkpoint') {
            const checkpointId = await saveCheckpoint(node, state);
            if (String(node.config?.mode || 'pause') === 'pause') throw new FlowPausedError(checkpointId);
          }
          return { status: 'success' };
        } catch (error) {
          if (error instanceof FlowPausedError) throw error;
          lastError = withNodeId(error as Error, node.id);
          if (state.signal?.aborted || lastError.name === 'AbortError') {
            const entry: FlowJournalEntry = {
              executionKey,
              flowUid: state.flow.uid,
              flowRevision: state.flow.revision,
              nodeId: node.id,
              scope: [...state.scope],
              status: 'cancelled',
              attempts,
              sideEffect,
              resumePolicy,
              completedAt: this.now().toISOString(),
              error: { message: lastError.message }
            };
            journal.set(executionKey, entry);
            emit('flow.node.cancelled', { status: 'cancelled', attempt, message: lastError.message }, { nodeId: node.id });
            return { status: 'failed', error: lastError };
          }
          emit('flow.node.attempt-failed', { attempt, maxAttempts, message: lastError.message }, { nodeId: node.id });
          if (attempt < maxAttempts) {
            const backoffMs = backoffForAttempt(retry, attempt);
            emit('flow.node.retrying', { status: 'retrying', nextAttempt: attempt + 1, backoffMs }, { nodeId: node.id });
            await abortableDelay(backoffMs, state.signal);
          }
        }
      }

      const failure = withNodeId(lastError || new Error(`Node ${node.id} failed`), node.id);
      journal.set(executionKey, {
        executionKey,
        flowUid: state.flow.uid,
        flowRevision: state.flow.revision,
        nodeId: node.id,
        scope: [...state.scope],
        status: 'failed',
        attempts,
        sideEffect,
        resumePolicy,
        completedAt: this.now().toISOString(),
        error: {
          message: failure.message,
          code: String((failure as Error & { code?: string }).code || '') || undefined
        }
      });
      emit('flow.node.failed', { status: 'failed', attempts, message: failure.message }, { nodeId: node.id });
      return { status: 'failed', error: failure };
    };

    const matchingEdges = (
      node: FlowNode,
      state: RunState,
      route: 'success' | 'failure',
      error?: Error
    ): FlowControlEdge[] => {
      const outgoing = sortedControlEdges(state.flow.controlEdges.filter((edge) => edge.sourceNodeId === node.id));
      const candidates = outgoing.filter((edge) => route === 'failure'
        ? edge.sourcePort === 'failure'
        : edge.sourcePort !== 'failure');
      const context = conditionContext(state, error);

      if (route === 'success' && node.kind === 'condition' && node.config?.expression) {
        const matchedPort = evaluateFlowCondition(String(node.config.expression), context) ? 'true' : 'false';
        const byPort = candidates.filter((edge) => edge.sourcePort === matchedPort);
        if (byPort.length > 0) return byPort.filter((edge) => !edge.condition || evaluateFlowCondition(edge.condition, context));
        return candidates.filter((edge) => (!edge.sourcePort || edge.sourcePort === 'default') && (!edge.condition || evaluateFlowCondition(edge.condition, context)));
      }

      const conditional = candidates.filter((edge) => edge.condition && evaluateFlowCondition(edge.condition, context));
      if (node.kind === 'fork') {
        return candidates.filter((edge) => !edge.condition || evaluateFlowCondition(edge.condition, context));
      }
      if (conditional.length > 0) return conditional;
      return candidates.filter((edge) => !edge.condition || edge.sourcePort === 'default');
    };

    const activateEdge = (edge: FlowControlEdge, type = 'flow.control-edge.activated', extra: Record<string, unknown> = {}): void => {
      emit(type, {
        status: 'activated',
        sourceNodeId: edge.sourceNodeId,
        targetNodeId: edge.targetNodeId,
        sourcePort: edge.sourcePort || null,
        label: edge.label || null,
        ...extra
      }, { edgeId: edge.id });
    };

    const cloneBranchState = (state: RunState, scopePart: string, branchSignal = state.signal): RunState => ({
      ...state,
      signal: branchSignal,
      outputs: new Map(state.outputs),
      results: { ...state.results },
      previews: { ...state.previews },
      nodeOrder: [],
      scope: [...state.scope, scopePart]
    });

    const mergeBranch = (parent: RunState, branch: RunState, base: RunState, strategy: string, appendOrder = true): void => {
      branch.outputs.forEach((output, nodeId) => {
        if (base.outputs.get(nodeId) === output) return;
        if (parent.outputs.has(nodeId) && parent.outputs.get(nodeId) !== base.outputs.get(nodeId)) {
          if (strategy === 'error-on-conflict') throw new Error(`Join output conflict at node ${nodeId}`);
          if (strategy === 'first-branch-wins') return;
        }
        parent.outputs.set(nodeId, output);
      });
      Object.entries(branch.results).forEach(([nodeId, result]) => {
        if (base.results[nodeId] === result) return;
        if (parent.results[nodeId] && parent.results[nodeId] !== base.results[nodeId] && strategy === 'first-branch-wins') return;
        if (parent.results[nodeId] && parent.results[nodeId] !== base.results[nodeId] && strategy === 'error-on-conflict') {
          throw new Error(`Join result conflict at node ${nodeId}`);
        }
        parent.results[nodeId] = result;
      });
      Object.entries(branch.previews).forEach(([nodeId, preview]) => {
        if (base.previews[nodeId] !== preview) parent.previews[nodeId] = preview;
      });
      if (appendOrder) parent.nodeOrder.push(...branch.nodeOrder);
    };

    let executePath: (
      nodeId: string,
      state: RunState,
      stopNodeId?: string,
      visited?: Set<string>
    ) => Promise<PathOutcome>;

    const executeFork = async (node: FlowNode, state: RunState): Promise<{ status: 'success' | 'failed'; nextNodeId?: string; error?: Error }> => {
      const joinNodeId = String(node.config?.joinNodeId || '');
      const joinNode = state.flow.nodes.find((candidate) => candidate.id === joinNodeId);
      if (!joinNode || joinNode.kind !== 'join') return { status: 'failed', error: new Error(`Fork ${node.id} requires a joinNodeId`) };
      const edges = matchingEdges(node, state, 'success');
      if (edges.length === 0) return { status: 'failed', error: new Error(`Fork ${node.id} has no active branches`) };
      const joinMode = String(joinNode.config?.mode || 'all');
      const configuredQuorum = Number(joinNode.config?.quorum ?? Math.ceil(edges.length / 2));
      if (joinMode === 'quorum' && (
        !Number.isInteger(configuredQuorum)
        || configuredQuorum < 1
        || configuredQuorum > edges.length
      )) {
        return {
          status: 'failed',
          error: new Error(`Join ${joinNode.id} quorum ${configuredQuorum} must be between 1 and ${edges.length}`)
        };
      }
      const quorum = joinMode === 'quorum' ? configuredQuorum : 1;
      const base = cloneBranchState(state, 'fork-base');
      const branchIsAbortSafe = (entryNodeId: string): boolean => {
        const pending = [entryNodeId];
        const visited = new Set<string>();
        while (pending.length > 0) {
          const current = pending.shift();
          if (!current || current === joinNodeId || visited.has(current)) continue;
          visited.add(current);
          const currentNode = state.flow.nodes.find((candidate) => candidate.id === current);
          if (!currentNode) continue;
          if (sideEffectForNode(currentNode) === 'once') return false;
          state.flow.controlEdges
            .filter((edge) => edge.sourceNodeId === current)
            .forEach((edge) => pending.push(edge.targetNodeId));
        }
        return true;
      };
      const branches = edges.map((edge, branchIndex) => {
        const branchId = `${node.id}:${branchIndex}:${edge.id}`;
        const controller = new AbortController();
        const abortFromParent = () => controller.abort(state.signal?.reason || abortError());
        if (state.signal?.aborted) abortFromParent();
        else state.signal?.addEventListener('abort', abortFromParent, { once: true });
        branchOrder.push(branchId);
        activateEdge(edge, 'flow.control-edge.activated', { branchId, branchIndex });
        emit('flow.branch.started', { branchId, branchIndex, forkNodeId: node.id, joinNodeId }, { edgeId: edge.id });
        const branchState = cloneBranchState(state, `fork:${node.id}:${branchIndex}`, controller.signal);
        return {
          edge,
          branchId,
          branchIndex,
          state: branchState,
          controller,
          abortSafe: branchIsAbortSafe(edge.targetNodeId),
          unlink: () => state.signal?.removeEventListener('abort', abortFromParent)
        };
      });

      const runBranch = async (branch: typeof branches[number]): Promise<BranchOutcome> => {
        try {
          const outcome = await executePath(branch.edge.targetNodeId, branch.state, joinNodeId, new Set());
          const status = outcome.status === 'success' && outcome.reachedStop ? 'success' : 'failed';
          const error = status === 'success' ? undefined : outcome.error || new Error(`Branch ${branch.branchId} did not reach join ${joinNodeId}`);
          emit(status === 'success' ? 'flow.branch.completed' : 'flow.branch.failed', {
            branchId: branch.branchId,
            branchIndex: branch.branchIndex,
            status,
            message: error?.message || null
          }, { edgeId: branch.edge.id });
          return { ...branch, status, error, reachedStop: outcome.reachedStop };
        } catch (error) {
          if (error instanceof FlowPausedError) throw error;
          const cancelled = branch.state.signal?.aborted;
          emit(cancelled ? 'flow.branch.cancelled' : 'flow.branch.failed', {
            branchId: branch.branchId,
            branchIndex: branch.branchIndex,
            status: cancelled ? 'cancelled' : 'failed',
            message: (error as Error).message
          }, { edgeId: branch.edge.id });
          return { ...branch, status: 'failed', error: error as Error };
        } finally {
          branch.unlink();
        }
      };

      const settled: Array<BranchOutcome | undefined> = new Array(branches.length);
      let deterministicSelection: BranchOutcome[] | null | undefined;
      let resolveDecision: ((selection: BranchOutcome[] | null) => void) | undefined;
      const decision = new Promise<BranchOutcome[] | null>((resolve) => { resolveDecision = resolve; });
      const maybeDecide = (): void => {
        if (deterministicSelection !== undefined) return;
        const successful = settled.filter((outcome): outcome is BranchOutcome => outcome?.status === 'success');
        const threshold = joinMode === 'quorum' ? quorum : 1;
        if (successful.length >= threshold) {
          const selected = successful.slice(0, threshold);
          const cutoff = selected.at(-1)?.branchIndex ?? -1;
          const prefixSettled = settled.slice(0, cutoff + 1).every(Boolean);
          if (prefixSettled) {
            deterministicSelection = selected;
            branches.forEach((branch) => {
              if (branch.branchIndex > cutoff && !settled[branch.branchIndex] && branch.abortSafe) {
                branch.controller.abort(abortError(`Join ${joinNode.id} was satisfied`));
              }
            });
            resolveDecision?.(selected);
            return;
          }
        }
        const pending = branches.length - settled.filter(Boolean).length;
        if (successful.length + pending < threshold || pending === 0) {
          deterministicSelection = null;
          resolveDecision?.(null);
        }
      };

      const branchPromises = branches.map((branch) => runBranch(branch).then((outcome) => {
        settled[branch.branchIndex] = outcome;
        if (joinMode === 'any' || joinMode === 'quorum') maybeDecide();
        return outcome;
      }));
      let earlySelection: BranchOutcome[] | null = null;
      if (joinMode === 'any' || joinMode === 'quorum') earlySelection = await decision;
      const outcomes = await Promise.all(branchPromises);
      assertNotCancelled();

      const successes = outcomes.filter((outcome) => outcome.status === 'success');
      const failures = outcomes.filter((outcome) => outcome.status === 'failed');
      let selected: BranchOutcome[] = [];
      if (joinMode === 'all') {
        if (failures.length > 0) return { status: 'failed', error: failures[0].error || new Error(`Join ${joinNode.id} failed`) };
        selected = successes;
      } else if (joinMode === 'all-settled') {
        selected = successes;
      } else if (joinMode === 'any') {
        if (!earlySelection?.length) return { status: 'failed', error: failures[0]?.error || new Error(`Join ${joinNode.id} has no successful branch`) };
        selected = earlySelection;
      } else if (joinMode === 'quorum') {
        if (!earlySelection || earlySelection.length < quorum) return { status: 'failed', error: new Error(`Join ${joinNode.id} reached ${successes.length}/${quorum} quorum`) };
        selected = earlySelection;
      } else {
        return { status: 'failed', error: new Error(`Unsupported join mode: ${joinMode}`) };
      }

      const mergeStrategy = String(joinNode.config?.merge || 'last-branch-wins');
      if (joinMode === 'all-settled') {
        outcomes.forEach((branch) => mergeBranch(state, branch.state, base, mergeStrategy, false));
        outcomes.forEach((branch) => state.nodeOrder.push(...branch.state.nodeOrder));
      } else {
        selected.forEach((branch) => mergeBranch(state, branch.state, base, mergeStrategy));
      }
      emit('flow.join.satisfied', {
        joinNodeId,
        forkNodeId: node.id,
        mode: joinMode,
        selectedBranches: selected.map((branch) => branch.branchId),
        settledBranches: outcomes.map((branch) => ({
          branchId: branch.branchId,
          status: branch.state.signal?.aborted && !state.signal?.aborted ? 'cancelled' : branch.status,
          message: branch.error?.message || null
        }))
      }, { nodeId: joinNodeId });
      return { status: 'success', nextNodeId: joinNodeId };
    };

    executePath = async (nodeId, state, stopNodeId, visited = new Set()) => {
      let currentNodeId: string | undefined = nodeId;
      while (currentNodeId) {
        assertNotCancelled();
        if (currentNodeId === stopNodeId) return { status: 'success', reachedStop: true };
        if (visited.has(currentNodeId)) return { status: 'failed', error: new Error(`Control cycle at ${currentNodeId}`) };
        visited.add(currentNodeId);
        const node = state.flow.nodes.find((candidate) => candidate.id === currentNodeId);
        if (!node) return { status: 'failed', error: new Error(`Control node ${currentNodeId} is missing`) };
        const outcome = await executeNode(node, state);
        if (outcome.status === 'failed') {
          if (state.signal?.aborted || outcome.error?.name === 'AbortError') throw outcome.error || abortError();
          const failureEdges = matchingEdges(node, state, 'failure', outcome.error);
          if (failureEdges.length === 0) return outcome;
          if (failureEdges.length > 1) {
            return {
              status: 'failed',
              error: withNodeId(new Error(`Node ${node.id} has multiple matching failure routes`), node.id)
            };
          }
          const edge = failureEdges[0];
          activateEdge(edge, 'flow.failure-route.activated', { message: outcome.error?.message || null });
          currentNodeId = edge.targetNodeId;
          continue;
        }

        if (node.kind === 'fork') {
          const fork = await executeFork(node, state);
          if (fork.status === 'failed') return { status: 'failed', error: fork.error };
          currentNodeId = fork.nextNodeId;
          continue;
        }

        const successEdges = matchingEdges(node, state, 'success');
        if (successEdges.length === 0) return { status: 'success' };
        if (successEdges.length > 1) {
          return { status: 'failed', error: new Error(`Node ${node.id} has multiple success routes; use a fork node`) };
        }
        const edge = successEdges[0];
        activateEdge(edge);
        currentNodeId = edge.targetNodeId;
      }
      return { status: 'success' };
    };

    emit('flow.run.queued', { status: 'queued', resume: Boolean(resumeState) });
    emit('flow.run.started', {
      status: 'running',
      revision: flow.revision,
      resumeCheckpointId: resumeState?.checkpointId || null
    });

    try {
      const compilerErrors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
      if (compilerErrors.length > 0) {
        throw new Error(`Flow compilation failed: ${compilerErrors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('; ')}`);
      }
      if (compiled.diagnostics.some((diagnostic) => diagnostic.code === 'FLOW_CONTROL_CYCLE')) {
        throw new Error('Control cycles require an explicit bounded loop policy');
      }
      const entryNodeId = compiled.entryNodeIds[0];
      if (!entryNodeId) throw new Error('Flow has no entry node');
      const outcome = await executePath(entryNodeId, rootState);
      if (outcome.status === 'failed') throw outcome.error || new Error('Flow failed');
      const completed = this.now();
      emit('flow.run.completed', { status: 'success', nodeOrder: rootState.nodeOrder, branchOrder });
      const result: FlowRunResult = {
        runId,
        flowUid: flow.uid,
        status: 'success',
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
        durationMs: Math.max(0, completed.getTime() - started.getTime()),
        nodeOrder: rootState.nodeOrder,
        branchOrder,
        results: safeProjectResults(rootState.results),
        previews: rootState.previews,
        outputs: safeProjectOutputs(rootState.outputs),
        journal: safeProjectJournal(journal),
        events
      };
      Object.defineProperty(result, FLOW_INTERNAL_OUTPUTS, { value: rootState.outputs, enumerable: false });
      return result;
    } catch (error) {
      const paused = error instanceof FlowPausedError;
      const runtimeError = error as FlowNodeError;
      const failedNodeId = runtimeError.nodeId || activeNodeId;
      const cancelled = !paused && (signal?.aborted || runtimeError.name === 'AbortError');
      const completed = this.now();
      const status: FlowRunStatus = paused ? 'paused' : (cancelled ? 'cancelled' : 'failed');
      emit(paused ? 'flow.run.paused' : (cancelled ? 'flow.run.cancelled' : 'flow.run.failed'), {
        status,
        message: runtimeError.message,
        nodeId: failedNodeId || null,
        checkpointId: paused ? error.checkpointId : null
      });
      const result: FlowRunResult = {
        runId,
        flowUid: flow.uid,
        status,
        startedAt: started.toISOString(),
        completedAt: completed.toISOString(),
        durationMs: Math.max(0, completed.getTime() - started.getTime()),
        nodeOrder: rootState.nodeOrder,
        branchOrder,
        results: safeProjectResults(rootState.results),
        previews: rootState.previews,
        outputs: safeProjectOutputs(rootState.outputs),
        journal: safeProjectJournal(journal),
        events,
        ...(lastCheckpointId ? { checkpointId: lastCheckpointId } : {}),
        ...(paused ? {} : { error: { message: runtimeError.message, nodeId: failedNodeId } })
      };
      Object.defineProperty(result, FLOW_INTERNAL_OUTPUTS, { value: rootState.outputs, enumerable: false });
      return result;
    }
  }
}

export class SequentialFlowScheduler extends DeterministicFlowScheduler {}
