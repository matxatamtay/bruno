import {
  compileFlow,
  DeterministicFlowScheduler,
  evaluateFlowCondition,
  type FlowCheckpointState,
  type FlowDefinition,
  type FlowNode
} from '../src';

const metadata = {
  createdAt: '2026-07-20T00:00:00.000Z',
  updatedAt: '2026-07-20T00:00:00.000Z'
};

const requestNode = (id: string, x: number, policy: Record<string, unknown> = {}): FlowNode => ({
  id,
  semanticKey: id,
  name: id,
  kind: 'http',
  position: { x, y: 100 },
  requestRef: {
    collectionPath: 'collections/api',
    itemPathname: `${id}.bru`,
    expectedMethod: 'POST'
  },
  config: {},
  policy
});

const requestAsset = (node: FlowNode) => ({
  collection: { uid: 'collection_api', pathname: '/workspace/collections/api' },
  item: {
    uid: node.id,
    name: node.id,
    type: 'http-request',
    request: { method: 'POST', url: `https://api.test/${node.id}`, params: [], headers: [], body: { mode: 'json', json: '{}' } }
  }
});

const forkFlow = (mode: 'all' | 'any' | 'quorum' | 'all-settled' = 'all', branchCount = 2): FlowDefinition => {
  const requests = Array.from({ length: branchCount }, (_, index) => requestNode(`request_${String.fromCharCode(97 + index)}`, 350, {
    sideEffect: 'read-only',
    resume: 'reuse'
  }));
  return {
    schemaVersion: 1,
    uid: `flow_fork_${mode}_${branchCount}`,
    name: 'Fork flow',
    revision: `rev:fork-${mode}-${branchCount}`,
    workspace: { uid: 'workspace_local' },
    defaults: { concurrency: 4 },
    nodes: [
      { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 100 }, config: {} },
      { id: 'fork', semanticKey: 'fork', kind: 'fork', position: { x: 180, y: 100 }, config: { joinNodeId: 'join' } },
      ...requests,
      { id: 'join', semanticKey: 'join', kind: 'join', position: { x: 550, y: 100 }, config: { mode, quorum: 2, merge: 'last-branch-wins' } },
      { id: 'end', semanticKey: 'end', kind: 'end', position: { x: 750, y: 100 }, config: {} }
    ],
    controlEdges: [
      { id: 'control_start_fork', sourceNodeId: 'start', targetNodeId: 'fork' },
      ...requests.flatMap((request, index) => [
        { id: `branch_${String.fromCharCode(97 + index)}`, sourceNodeId: 'fork', sourcePort: `branch-${index}`, targetNodeId: request.id },
        { id: `control_${request.id}_join`, sourceNodeId: request.id, targetNodeId: 'join' }
      ]),
      { id: 'control_join_end', sourceNodeId: 'join', targetNodeId: 'end' }
    ],
    dataEdges: [],
    frames: [],
    metadata
  };
};

const schedulerFor = (executeRequest: ConstructorParameters<typeof DeterministicFlowScheduler>[0]['executeRequest'], options: Partial<ConstructorParameters<typeof DeterministicFlowScheduler>[0]> = {}) => new DeterministicFlowScheduler({
  resolveRequest: requestAsset,
  executeRequest,
  ...options
});

const successExecution = (nodeId: string) => ({
  result: { executionId: `execution_${nodeId}`, status: 'success', response: { status: 200, body: { nodeId } } },
  legacyResult: { status: 200, data: { nodeId }, headers: {} }
});

const failedExecution = (nodeId: string) => ({
  result: { executionId: `execution_${nodeId}`, status: 'failed', error: { message: `${nodeId} failed` } },
  legacyResult: { statusText: 'FAILED', error: `${nodeId} failed` }
});

describe('Phase 5 deterministic control runtime', () => {
  it('evaluates restricted condition expressions and selects true/false routes', async () => {
    const flow: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_condition',
      name: 'Condition flow',
      revision: 'rev:condition',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      inputSchema: { type: 'object', properties: { enabled: { type: 'boolean' } } },
      nodes: [
        { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'condition', semanticKey: 'condition', kind: 'condition', position: { x: 150, y: 0 }, config: { expression: 'inputs.enabled === true' } },
        { id: 'end_true', semanticKey: 'end_true', kind: 'end', position: { x: 350, y: -80 }, config: {} },
        { id: 'end_false', semanticKey: 'end_false', kind: 'end', position: { x: 350, y: 80 }, config: {} }
      ],
      controlEdges: [
        { id: 'start_condition', sourceNodeId: 'start', targetNodeId: 'condition' },
        { id: 'condition_true', sourceNodeId: 'condition', sourcePort: 'true', targetNodeId: 'end_true' },
        { id: 'condition_false', sourceNodeId: 'condition', sourcePort: 'false', targetNodeId: 'end_false' }
      ],
      dataEdges: [],
      frames: [],
      metadata
    };
    const scheduler = schedulerFor(async ({ node }) => successExecution(node.id));
    const yes = await scheduler.run({ flow, inputs: { enabled: true }, runId: 'run_condition_true' });
    const no = await scheduler.run({ flow, inputs: { enabled: false }, runId: 'run_condition_false' });

    expect(yes.nodeOrder).toEqual(['start', 'condition', 'end_true']);
    expect(no.nodeOrder).toEqual(['start', 'condition', 'end_false']);
    expect(evaluateFlowCondition('inputs.enabled === true && !error.message', {
      flow,
      inputs: { enabled: true },
      outputs: new Map(),
      error: null
    })).toBe(true);
  });

  it('fails compiler-invalid flows before executing request adapters', async () => {
    const flow: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_invalid_condition',
      name: 'Invalid condition',
      revision: 'rev:invalid-condition',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      nodes: [
        { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'condition', semanticKey: 'condition', kind: 'condition', position: { x: 150, y: 0 }, config: { expression: 'inputs.enabled === true' } },
        requestNode('request_never', 300)
      ],
      controlEdges: [
        { id: 'start_condition', sourceNodeId: 'start', targetNodeId: 'condition' }
      ],
      dataEdges: [],
      frames: [],
      metadata
    };
    let executions = 0;
    const scheduler = schedulerFor(async ({ node }) => {
      executions += 1;
      return successExecution(node.id);
    });
    const result = await scheduler.run({ flow, runId: 'run_invalid_condition' });

    expect(result.status).toBe('failed');
    expect(result.error?.message).toContain('FLOW_CONDITION_ROUTE_REQUIRED');
    expect(executions).toBe(0);
    expect(result.nodeOrder).toEqual([]);
  });

  it('rejects quorum values larger than the compiled branch set', async () => {
    const flow = forkFlow('quorum', 2);
    const join = flow.nodes.find((node) => node.id === 'join')!;
    join.config.quorum = 3;

    expect(compileFlow(flow).diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'FLOW_JOIN_QUORUM_OUT_OF_RANGE', nodeId: 'join', severity: 'error' })
    ]));

    const scheduler = schedulerFor(async ({ node }) => successExecution(node.id));
    const result = await scheduler.run({ flow, runId: 'run_invalid_quorum' });
    expect(result.status).toBe('failed');
    expect(result.error?.message).toContain('must be between 1 and 2');
  });

  it('fails deterministically when multiple failure routes match', async () => {
    const flow: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_ambiguous_failure',
      name: 'Ambiguous failure route',
      revision: 'rev:ambiguous-failure',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      nodes: [
        { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        requestNode('request_fail', 150),
        { id: 'failure_a', semanticKey: 'failure_a', kind: 'delay', position: { x: 350, y: -50 }, config: { milliseconds: 0 } },
        { id: 'failure_b', semanticKey: 'failure_b', kind: 'delay', position: { x: 350, y: 50 }, config: { milliseconds: 0 } }
      ],
      controlEdges: [
        { id: 'start_request', sourceNodeId: 'start', targetNodeId: 'request_fail' },
        { id: 'failure_route_a', sourceNodeId: 'request_fail', sourcePort: 'failure', targetNodeId: 'failure_a', condition: 'error.status === "failed"' },
        { id: 'failure_route_b', sourceNodeId: 'request_fail', sourcePort: 'failure', targetNodeId: 'failure_b', condition: 'error.message contains "failed"' }
      ],
      dataEdges: [],
      frames: [],
      metadata
    };
    const scheduler = schedulerFor(async ({ node }) => failedExecution(node.id));
    const result = await scheduler.run({ flow, runId: 'run_ambiguous_failure' });

    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({
      nodeId: 'request_fail',
      message: expect.stringContaining('multiple matching failure routes')
    });
    expect(result.nodeOrder).toEqual(['start', 'request_fail']);
  });

  it('does not auto-abort a branch whose failure path contains once-only work', async () => {
    const flow: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_failure_side_effect_scan',
      name: 'Failure side-effect scan',
      revision: 'rev:failure-side-effect-scan',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      nodes: [
        { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'fork', semanticKey: 'fork', kind: 'fork', position: { x: 120, y: 0 }, config: { joinNodeId: 'join' } },
        requestNode('request_a', 260, { sideEffect: 'read-only', resume: 'reuse' }),
        requestNode('request_b', 260, { sideEffect: 'read-only', resume: 'reuse' }),
        requestNode('request_once', 420, { sideEffect: 'once', resume: 'reuse' }),
        { id: 'join', semanticKey: 'join', kind: 'join', position: { x: 600, y: 0 }, config: { mode: 'any' } },
        { id: 'end', semanticKey: 'end', kind: 'end', position: { x: 760, y: 0 }, config: {} }
      ],
      controlEdges: [
        { id: 'start_fork', sourceNodeId: 'start', targetNodeId: 'fork' },
        { id: 'fork_a', sourceNodeId: 'fork', sourcePort: 'branch-0', targetNodeId: 'request_a' },
        { id: 'fork_b', sourceNodeId: 'fork', sourcePort: 'branch-1', targetNodeId: 'request_b' },
        { id: 'a_join', sourceNodeId: 'request_a', targetNodeId: 'join' },
        { id: 'b_join', sourceNodeId: 'request_b', targetNodeId: 'join' },
        { id: 'b_failure_once', sourceNodeId: 'request_b', sourcePort: 'failure', targetNodeId: 'request_once' },
        { id: 'once_join', sourceNodeId: 'request_once', targetNodeId: 'join' },
        { id: 'join_end', sourceNodeId: 'join', targetNodeId: 'end' }
      ],
      dataEdges: [],
      frames: [],
      metadata
    };
    let requestBAborted = false;
    let onceExecutions = 0;
    const scheduler = schedulerFor(({ node, signal }) => {
      if (node.id === 'request_a') {
        return new Promise((resolve) => setTimeout(() => resolve(successExecution(node.id)), 2));
      }
      if (node.id === 'request_b') {
        return new Promise((resolve) => {
          const timer = setTimeout(() => resolve(failedExecution(node.id)), 8);
          signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            requestBAborted = true;
            resolve({
              result: { executionId: 'request_b_cancelled', status: 'cancelled' },
              legacyResult: { isCancel: true, error: 'REQUEST_CANCELLED' }
            });
          }, { once: true });
        });
      }
      onceExecutions += 1;
      return Promise.resolve(successExecution(node.id));
    });

    const result = await scheduler.run({ flow, runId: 'run_failure_side_effect_scan' });
    expect(result.status).toBe('success');
    expect(requestBAborted).toBe(false);
    expect(onceExecutions).toBe(1);
  });

  it('safe-projects request results before returning them to the renderer caller', async () => {
    const scheduler = schedulerFor(async ({ node }) => ({
      result: {
        executionId: `execution_${node.id}`,
        status: 'success',
        response: { status: 200, body: { token: `raw-${node.id}-secret`, visible: 'ok' } }
      },
      legacyResult: { status: 200, data: { token: `raw-${node.id}-secret`, visible: 'ok' }, headers: {} }
    }));
    const result = await scheduler.run({ flow: forkFlow('all'), runId: 'run_safe_results' });

    expect(JSON.stringify(result)).not.toContain('raw-request_a-secret');
    expect(JSON.stringify(result)).not.toContain('raw-request_b-secret');
    expect(result.results.request_a).toMatchObject({
      response: { body: { token: '[REDACTED]', visible: 'ok' } }
    });
  });

  it('executes fork branches in parallel but commits node and branch order deterministically', async () => {
    const runWithDelays = async (delays: Record<string, number>) => {
      let active = 0;
      let maxActive = 0;
      const scheduler = schedulerFor(async ({ node }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, delays[node.id]));
        active -= 1;
        return successExecution(node.id);
      });
      const result = await scheduler.run({ flow: forkFlow('all'), runId: `run_${delays.request_a}_${delays.request_b}` });
      return { result, maxActive };
    };

    const first = await runWithDelays({ request_a: 25, request_b: 2 });
    const second = await runWithDelays({ request_a: 2, request_b: 25 });

    expect(first.maxActive).toBe(2);
    expect(second.maxActive).toBe(2);
    expect(first.result.status).toBe('success');
    expect(first.result.nodeOrder).toEqual(['start', 'fork', 'request_a', 'request_b', 'join', 'end']);
    expect(second.result.nodeOrder).toEqual(first.result.nodeOrder);
    expect(second.result.branchOrder).toEqual(first.result.branchOrder);
    expect(Object.keys(second.result.results)).toEqual(Object.keys(first.result.results));
  });

  it.each([
    ['all', ['request_b'], 'failed'],
    ['all-settled', ['request_b'], 'success'],
    ['any', ['request_a'], 'success'],
    ['quorum', ['request_c'], 'success'],
    ['quorum', ['request_b', 'request_c'], 'failed']
  ] as const)('implements %s join semantics with failures %j', async (mode, failedNodes, expectedStatus) => {
    const branchCount = mode === 'quorum' ? 3 : 2;
    const scheduler = schedulerFor(async ({ node }) => failedNodes.includes(node.id as never)
      ? failedExecution(node.id)
      : successExecution(node.id));
    const result = await scheduler.run({ flow: forkFlow(mode, branchCount), runId: `run_join_${mode}_${failedNodes.join('_')}` });

    expect(result.status).toBe(expectedStatus);
    const joinEvent = result.events.find((event) => event.type === 'flow.join.satisfied');
    if (expectedStatus === 'success') expect(joinEvent).toBeDefined();
    else expect(joinEvent).toBeUndefined();
  });

  it('keeps all-settled branch order stable even when a middle branch fails', async () => {
    const scheduler = schedulerFor(async ({ node }) => node.id === 'request_b'
      ? failedExecution(node.id)
      : successExecution(node.id));
    const result = await scheduler.run({ flow: forkFlow('all-settled', 3), runId: 'run_all_settled_order' });

    expect(result.status).toBe('success');
    expect(result.nodeOrder).toEqual(['start', 'fork', 'request_a', 'request_b', 'request_c', 'join', 'end']);
    expect(result.events.find((event) => event.type === 'flow.join.satisfied')?.payload).toMatchObject({ mode: 'all-settled' });
  });

  it('aborts deterministic any-join losers and waits for their cleanup', async () => {
    const flow = forkFlow('any');
    let active = 0;
    let loserAborted = false;
    const scheduler = schedulerFor(({ node, signal }) => {
      active += 1;
      if (node.id === 'request_a') {
        return new Promise((resolve) => setTimeout(() => {
          active -= 1;
          resolve(successExecution(node.id));
        }, 2));
      }
      return new Promise((resolve) => {
        signal?.addEventListener('abort', () => setTimeout(() => {
          loserAborted = true;
          active -= 1;
          resolve({
            result: { executionId: 'cancel_loser', status: 'cancelled' },
            legacyResult: { isCancel: true, error: 'REQUEST_CANCELLED' }
          });
        }, 5), { once: true });
      });
    });

    const result = await scheduler.run({ flow, runId: 'run_any_abort_loser' });
    expect(result.status).toBe('success');
    expect(result.nodeOrder).toEqual(['start', 'fork', 'request_a', 'join', 'end']);
    expect(loserAborted).toBe(true);
    expect(active).toBe(0);
    expect(result.events.find((event) => event.type === 'flow.branch.cancelled')).toBeDefined();
  });

  it('retries idempotent work and activates a failure route only after attempts are exhausted', async () => {
    const flow: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_retry_failure',
      name: 'Retry failure route',
      revision: 'rev:retry-failure',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      nodes: [
        { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        requestNode('request_retry', 150, {
          sideEffect: 'idempotent',
          allowRetry: true,
          retry: { maxAttempts: 3, backoffMs: 1, strategy: 'fixed' }
        }),
        { id: 'recovered', semanticKey: 'recovered', kind: 'delay', position: { x: 350, y: 100 }, config: { milliseconds: 0 } },
        { id: 'end', semanticKey: 'end', kind: 'end', position: { x: 550, y: 0 }, config: {} }
      ],
      controlEdges: [
        { id: 'start_request', sourceNodeId: 'start', targetNodeId: 'request_retry' },
        { id: 'request_success', sourceNodeId: 'request_retry', targetNodeId: 'end' },
        { id: 'request_failure', sourceNodeId: 'request_retry', sourcePort: 'failure', targetNodeId: 'recovered' },
        { id: 'recovered_end', sourceNodeId: 'recovered', targetNodeId: 'end' }
      ],
      dataEdges: [],
      frames: [],
      metadata
    };
    let attempts = 0;
    const retryThenSuccess = schedulerFor(async ({ node }) => {
      attempts += 1;
      return attempts < 3 ? failedExecution(node.id) : successExecution(node.id);
    });
    const success = await retryThenSuccess.run({ flow, runId: 'run_retry_success' });
    expect(success.status).toBe('success');
    expect(attempts).toBe(3);
    expect(success.events.filter((event) => event.type === 'flow.node.retrying')).toHaveLength(2);
    expect(success.events.some((event) => event.type === 'flow.failure-route.activated')).toBe(false);

    attempts = 0;
    const alwaysFail = schedulerFor(async ({ node }) => {
      attempts += 1;
      return failedExecution(node.id);
    });
    const recovered = await alwaysFail.run({ flow, runId: 'run_retry_failure' });
    expect(recovered.status).toBe('success');
    expect(attempts).toBe(3);
    expect(recovered.nodeOrder).toEqual(['start', 'request_retry', 'recovered', 'end']);
    expect(recovered.events.find((event) => event.type === 'flow.failure-route.activated')?.edgeId).toBe('request_failure');
  });

  it('waits for every aborted branch so cancellation leaves no orphan request', async () => {
    const controller = new AbortController();
    let active = 0;
    let started = 0;
    let resolveStarted: (() => void) | undefined;
    const bothStarted = new Promise<void>((resolve) => { resolveStarted = resolve; });
    const scheduler = schedulerFor(({ node, signal }) => new Promise((resolve) => {
      active += 1;
      started += 1;
      if (started === 2) resolveStarted?.();
      signal?.addEventListener('abort', () => {
        setTimeout(() => {
          active -= 1;
          resolve({
            result: { executionId: `cancel_${node.id}`, status: 'cancelled' },
            legacyResult: { isCancel: true, error: 'REQUEST_CANCELLED' }
          });
        }, node.id === 'request_a' ? 8 : 2);
      }, { once: true });
    }));
    const running = scheduler.run({ flow: forkFlow('all'), signal: controller.signal, runId: 'run_cancel_parallel' });
    await bothStarted;
    controller.abort();
    const result = await running;

    expect(result.status).toBe('cancelled');
    expect(active).toBe(0);
    expect(started).toBe(2);
  });

  it('pauses at a checkpoint and resumes without repeating once-only side effects', async () => {
    const flow: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_checkpoint_resume',
      name: 'Checkpoint resume',
      revision: 'rev:checkpoint-resume',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      nodes: [
        { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        requestNode('request_before', 150),
        { id: 'checkpoint', semanticKey: 'checkpoint', kind: 'checkpoint', position: { x: 300, y: 0 }, config: { mode: 'pause' } },
        requestNode('request_after', 450),
        { id: 'end', semanticKey: 'end', kind: 'end', position: { x: 650, y: 0 }, config: {} }
      ],
      controlEdges: [
        { id: 'start_before', sourceNodeId: 'start', targetNodeId: 'request_before' },
        { id: 'before_checkpoint', sourceNodeId: 'request_before', targetNodeId: 'checkpoint' },
        { id: 'checkpoint_after', sourceNodeId: 'checkpoint', targetNodeId: 'request_after' },
        { id: 'after_end', sourceNodeId: 'request_after', targetNodeId: 'end' }
      ],
      dataEdges: [],
      frames: [],
      metadata
    };
    const counts = { request_before: 0, request_after: 0 };
    let checkpoint: FlowCheckpointState | undefined;
    const scheduler = schedulerFor(async ({ node }) => {
      counts[node.id as keyof typeof counts] += 1;
      return successExecution(node.id);
    }, {
      saveCheckpoint: (state) => {
        checkpoint = state;
        return { checkpointId: 'checkpoint_saved' };
      }
    });

    const first = await scheduler.run({ flow, runId: 'run_before_checkpoint' });
    expect(first.status).toBe('paused');
    expect(first.checkpointId).toBe('checkpoint_saved');
    expect(counts).toEqual({ request_before: 1, request_after: 0 });
    expect(checkpoint).toBeDefined();

    const resumed = await scheduler.run({
      flow,
      runId: 'run_resumed',
      resumeState: checkpoint
    });
    expect(resumed.status).toBe('success');
    expect(counts).toEqual({ request_before: 1, request_after: 1 });
    expect(resumed.events.find((event) => event.type === 'flow.node.reused' && event.nodeId === 'request_before')).toBeDefined();
  });

  it('fails closed on resume after an uncertain cancelled once-only side effect', async () => {
    const flow: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_uncertain_resume',
      name: 'Uncertain resume',
      revision: 'rev:uncertain-resume',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      nodes: [
        { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        requestNode('request_once', 150),
        { id: 'end', semanticKey: 'end', kind: 'end', position: { x: 300, y: 0 }, config: {} }
      ],
      controlEdges: [
        { id: 'start_once', sourceNodeId: 'start', targetNodeId: 'request_once' },
        { id: 'once_end', sourceNodeId: 'request_once', targetNodeId: 'end' }
      ],
      dataEdges: [],
      frames: [],
      metadata
    };
    const executionKey = `${flow.uid}:root:request_once`;
    const checkpoint: FlowCheckpointState = {
      schemaVersion: 1,
      checkpointId: 'uncertain_checkpoint',
      runId: 'cancelled_run',
      rootFlowUid: flow.uid,
      rootRevision: flow.revision,
      nodeId: 'request_once',
      createdAt: metadata.createdAt,
      journal: {
        [executionKey]: {
          executionKey,
          flowUid: flow.uid,
          flowRevision: flow.revision,
          nodeId: 'request_once',
          scope: [],
          status: 'cancelled',
          attempts: 1,
          sideEffect: 'once',
          resumePolicy: 'reuse',
          completedAt: metadata.createdAt,
          error: { message: 'connection cancelled after send' }
        }
      }
    };
    let executions = 0;
    const scheduler = schedulerFor(async ({ node }) => {
      executions += 1;
      return successExecution(node.id);
    });
    const result = await scheduler.run({ flow, resumeState: checkpoint, runId: 'resume_uncertain' });

    expect(result.status).toBe('failed');
    expect(result.error?.message).toContain('uncertain once-only side effect');
    expect(executions).toBe(0);
  });

  it('blocks resume when policy asks to rerun an unapproved once-only side effect', async () => {
    const flow = forkFlow('all');
    const request = flow.nodes.find((node) => node.id === 'request_a')!;
    request.policy = { sideEffect: 'once', resume: 'rerun' };
    const checkpoint: FlowCheckpointState = {
      schemaVersion: 1,
      checkpointId: 'unsafe_checkpoint',
      runId: 'old_run',
      rootFlowUid: flow.uid,
      rootRevision: flow.revision,
      nodeId: 'request_a',
      createdAt: metadata.createdAt,
      journal: {
        [`${flow.uid}:fork:fork:0:request_a`]: {
          executionKey: `${flow.uid}:fork:fork:0:request_a`,
          flowUid: flow.uid,
          flowRevision: flow.revision,
          nodeId: 'request_a',
          scope: ['fork:fork:0'],
          status: 'success',
          attempts: 1,
          sideEffect: 'once',
          resumePolicy: 'rerun',
          completedAt: metadata.createdAt,
          output: {}
        }
      }
    };
    let executions = 0;
    const scheduler = schedulerFor(async ({ node }) => {
      executions += 1;
      return successExecution(node.id);
    });
    const result = await scheduler.run({ flow, resumeState: checkpoint, runId: 'unsafe_resume' });

    expect(result.status).toBe('failed');
    expect(result.error?.message).toContain('once-only side effect');
    expect(executions).toBeGreaterThanOrEqual(1);
    expect(executions).toBeLessThan(2);
  });

  it('executes bounded dataset subflows and rejects datasets above the configured limit', async () => {
    const child: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_child',
      name: 'Child',
      revision: 'rev:child',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      nodes: [
        { id: 'child_start', semanticKey: 'child_start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'child_delay', semanticKey: 'child_delay', kind: 'delay', position: { x: 150, y: 0 }, config: { milliseconds: 1 } },
        { id: 'child_end', semanticKey: 'child_end', kind: 'end', position: { x: 300, y: 0 }, config: {} }
      ],
      controlEdges: [
        { id: 'child_start_delay', sourceNodeId: 'child_start', targetNodeId: 'child_delay' },
        { id: 'child_delay_end', sourceNodeId: 'child_delay', targetNodeId: 'child_end' }
      ],
      dataEdges: [],
      frames: [],
      metadata
    };
    const parent: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_parent',
      name: 'Parent',
      revision: 'rev:parent',
      workspace: { uid: 'workspace_local' },
      defaults: { datasetLimit: 2 },
      nodes: [
        { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        {
          id: 'subflow', semanticKey: 'subflow', kind: 'subflow', position: { x: 150, y: 0 },
          config: { relativePath: 'child.flow.yml', datasetMode: 'for-each', concurrency: 2 },
          policy: { sideEffect: 'none' }
        },
        { id: 'end', semanticKey: 'end', kind: 'end', position: { x: 300, y: 0 }, config: {} }
      ],
      controlEdges: [
        { id: 'start_subflow', sourceNodeId: 'start', targetNodeId: 'subflow' },
        { id: 'subflow_end', sourceNodeId: 'subflow', targetNodeId: 'end' }
      ],
      dataEdges: [],
      frames: [],
      metadata
    };
    const scheduler = schedulerFor(async ({ node }) => successExecution(node.id), {
      resolveSubflow: () => child
    });
    const success = await scheduler.run({ flow: parent, dataset: [{ id: 1 }, { id: 2 }], runId: 'dataset_ok' });
    expect(success.status).toBe('success');
    expect(success.events.filter((event) => event.type === 'flow.subflow.event').length).toBeGreaterThan(0);

    const rejected = await scheduler.run({ flow: parent, dataset: [{ id: 1 }, { id: 2 }, { id: 3 }], runId: 'dataset_too_large' });
    expect(rejected.status).toBe('failed');
    expect(rejected.error?.message).toContain('limit is 2');
  });

  it('aborts sibling dataset workers and waits until every child request settles', async () => {
    const child: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_child_requests',
      name: 'Child requests',
      revision: 'rev:child-requests',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      nodes: [
        { id: 'child_start', semanticKey: 'child_start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        requestNode('child_request', 160, { sideEffect: 'read-only', resume: 'reuse' }),
        { id: 'child_end', semanticKey: 'child_end', kind: 'end', position: { x: 320, y: 0 }, config: {} }
      ],
      controlEdges: [
        { id: 'child_start_request', sourceNodeId: 'child_start', targetNodeId: 'child_request' },
        { id: 'child_request_end', sourceNodeId: 'child_request', targetNodeId: 'child_end' }
      ],
      dataEdges: [],
      frames: [],
      metadata
    };
    const parent: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_parent_dataset_cancel',
      name: 'Parent dataset cancel',
      revision: 'rev:parent-dataset-cancel',
      workspace: { uid: 'workspace_local' },
      defaults: { datasetLimit: 2, concurrency: 2 },
      nodes: [
        { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        {
          id: 'subflow', semanticKey: 'subflow', kind: 'subflow', position: { x: 160, y: 0 },
          config: { relativePath: 'child.flow.yml', datasetMode: 'for-each' },
          policy: { sideEffect: 'none', resume: 'reuse' }
        },
        { id: 'end', semanticKey: 'end', kind: 'end', position: { x: 320, y: 0 }, config: {} }
      ],
      controlEdges: [
        { id: 'start_subflow', sourceNodeId: 'start', targetNodeId: 'subflow' },
        { id: 'subflow_end', sourceNodeId: 'subflow', targetNodeId: 'end' }
      ],
      dataEdges: [],
      frames: [],
      metadata
    };
    let calls = 0;
    let active = 0;
    let releaseStarted: (() => void) | undefined;
    const bothStarted = new Promise<void>((resolve) => { releaseStarted = resolve; });
    const scheduler = schedulerFor(({ node, signal }) => {
      calls += 1;
      const call = calls;
      active += 1;
      if (calls === 2) releaseStarted?.();
      if (call === 1) {
        return bothStarted.then(() => {
          active -= 1;
          return failedExecution(node.id);
        });
      }
      return new Promise((resolve) => {
        signal?.addEventListener('abort', () => setTimeout(() => {
          active -= 1;
          resolve({
            result: { executionId: 'dataset_cancelled', status: 'cancelled' },
            legacyResult: { isCancel: true, error: 'REQUEST_CANCELLED' }
          });
        }, 5), { once: true });
      });
    }, {
      resolveSubflow: () => child
    });

    const result = await scheduler.run({
      flow: parent,
      dataset: [{ id: 1 }, { id: 2 }],
      runId: 'dataset_structured_cancel'
    });
    expect(result.status).toBe('failed');
    expect(calls).toBe(2);
    expect(active).toBe(0);
    expect(result.error?.nodeId).toBe('subflow');
  });

  it('rejects a reusable subflow before execution when required contract inputs are missing', async () => {
    const child: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_child_required_input',
      name: 'Child requiring email',
      revision: 'rev:child-required-input',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      inputSchema: {
        type: 'object',
        properties: { email: { type: 'string' } },
        required: ['email']
      },
      nodes: [
        { id: 'child_start', semanticKey: 'child_start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'child_end', semanticKey: 'child_end', kind: 'end', position: { x: 240, y: 0 }, config: {} }
      ],
      controlEdges: [{ id: 'child_start_end', sourceNodeId: 'child_start', targetNodeId: 'child_end' }],
      dataEdges: [],
      frames: [],
      metadata
    };
    const parent: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_parent_missing_input',
      name: 'Parent missing child input',
      revision: 'rev:parent-missing-input',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      nodes: [
        { id: 'parent_start', semanticKey: 'parent_start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'subflow', semanticKey: 'subflow', kind: 'subflow', position: { x: 160, y: 0 }, config: { flowUid: child.uid }, policy: { sideEffect: 'none' } },
        { id: 'parent_end', semanticKey: 'parent_end', kind: 'end', position: { x: 320, y: 0 }, config: {} }
      ],
      controlEdges: [
        { id: 'parent_start_subflow', sourceNodeId: 'parent_start', targetNodeId: 'subflow' },
        { id: 'parent_subflow_end', sourceNodeId: 'subflow', targetNodeId: 'parent_end' }
      ],
      dataEdges: [],
      frames: [],
      metadata
    };
    const scheduler = schedulerFor(async ({ node }) => successExecution(node.id), { resolveSubflow: () => child });
    const result = await scheduler.run({ flow: parent, runId: 'missing_subflow_input' });
    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({ nodeId: 'subflow' });
    expect(result.error?.message).toContain('input contract failed');
    expect(result.error?.message).toContain('/email');
  });

  it('publishes only declared End-node outputs from reusable subflows', async () => {
    const child: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_child_contract',
      name: 'Child contract',
      revision: 'rev:child-contract',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      outputSchema: {
        type: 'object',
        properties: {
          userId: {
            'type': 'string',
            'x-bruno-flow-source': { nodeId: 'child_request', path: 'response.body.nodeId' }
          }
        },
        required: ['userId']
      },
      nodes: [
        { id: 'child_start', semanticKey: 'child_start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        requestNode('child_request', 160),
        { id: 'child_end', semanticKey: 'child_end', kind: 'end', position: { x: 320, y: 0 }, config: {} }
      ],
      controlEdges: [
        { id: 'child_start_request', sourceNodeId: 'child_start', targetNodeId: 'child_request' },
        { id: 'child_request_end', sourceNodeId: 'child_request', targetNodeId: 'child_end' }
      ],
      dataEdges: [],
      frames: [],
      metadata
    };
    const parent: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_parent_contract',
      name: 'Parent contract',
      revision: 'rev:parent-contract',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      nodes: [
        { id: 'parent_start', semanticKey: 'parent_start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'subflow', semanticKey: 'subflow', kind: 'subflow', position: { x: 160, y: 0 }, config: { flowUid: child.uid }, policy: { sideEffect: 'none' } },
        { id: 'parent_end', semanticKey: 'parent_end', kind: 'end', position: { x: 320, y: 0 }, config: {} }
      ],
      controlEdges: [
        { id: 'parent_start_subflow', sourceNodeId: 'parent_start', targetNodeId: 'subflow' },
        { id: 'parent_subflow_end', sourceNodeId: 'subflow', targetNodeId: 'parent_end' }
      ],
      dataEdges: [],
      frames: [],
      metadata
    };
    const scheduler = schedulerFor(async ({ node }) => successExecution(node.id), { resolveSubflow: () => child });
    const result = await scheduler.run({ flow: parent, runId: 'subflow_contract' });
    expect(result.status).toBe('success');
    const subflowOutputs = result.outputs.subflow.outputs as { value: Record<string, unknown> };
    expect(subflowOutputs).toMatchObject({ value: { userId: 'child_request' } });
    expect(subflowOutputs.value).not.toHaveProperty('child_request');
  });

  it('rejects recursive subflows before starting an unbounded child runtime', async () => {
    const flow: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_recursive',
      name: 'Recursive flow',
      revision: 'rev:recursive',
      workspace: { uid: 'workspace_local' },
      defaults: { subflowDepth: 4 },
      nodes: [
        { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        {
          id: 'subflow', semanticKey: 'subflow', kind: 'subflow', position: { x: 160, y: 0 },
          config: { flowUid: 'flow_recursive' }, policy: { sideEffect: 'none', resume: 'reuse' }
        },
        { id: 'end', semanticKey: 'end', kind: 'end', position: { x: 320, y: 0 }, config: {} }
      ],
      controlEdges: [
        { id: 'start_subflow', sourceNodeId: 'start', targetNodeId: 'subflow' },
        { id: 'subflow_end', sourceNodeId: 'subflow', targetNodeId: 'end' }
      ],
      dataEdges: [],
      frames: [],
      metadata
    };
    const scheduler = schedulerFor(async ({ node }) => successExecution(node.id), {
      resolveSubflow: () => flow
    });

    const result = await scheduler.run({ flow, runId: 'recursive_subflow' });
    expect(result.status).toBe('failed');
    expect(result.error).toMatchObject({
      nodeId: 'subflow',
      message: expect.stringContaining('Subflow cycle detected')
    });
  });
});
