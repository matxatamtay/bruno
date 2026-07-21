import { createRuntimeProjection, runtimeProjectionReducer } from './runtime-projection';

const event = (overrides = {}) => ({
  schemaVersion: 1,
  eventId: 'event_1',
  sequence: 1,
  timestamp: '2026-07-20T00:00:00.000Z',
  source: 'flow-runtime',
  type: 'flow.run.started',
  runId: 'run_1',
  flowUid: 'flow_1',
  payload: {},
  ...overrides
});

describe('Flow runtime projection', () => {
  it('deduplicates events and ignores another run or flow', () => {
    let state = runtimeProjectionReducer(createRuntimeProjection(), { type: 'reset', runId: 'run_1', flowUid: 'flow_1' });
    state = runtimeProjectionReducer(state, { type: 'event', event: event() });
    const afterDuplicate = runtimeProjectionReducer(state, { type: 'event', event: event() });
    const afterOtherRun = runtimeProjectionReducer(state, {
      type: 'event',
      event: event({ eventId: 'event_2', runId: 'run_other' })
    });

    expect(state.status).toBe('running');
    expect(afterDuplicate).toBe(state);
    expect(afterOtherRun).toBe(state);
  });

  it('updates only the addressed node and edges while preserving other entity references', () => {
    const base = {
      ...createRuntimeProjection(),
      runId: 'run_1',
      flowUid: 'flow_1',
      nodes: { node_a: { status: 'success' }, node_b: { status: 'idle' } },
      controlEdges: { control_old: { status: 'activated' } },
      dataEdges: { data_old: { status: 'resolved' } }
    };
    const nodeA = base.nodes.node_a;
    const nodeB = base.nodes.node_b;
    let state = runtimeProjectionReducer(base, {
      type: 'event',
      event: event({ eventId: 'event_node', type: 'flow.node.started', nodeId: 'node_b' })
    });

    expect(state.nodes.node_a).toBe(nodeA);
    expect(state.nodes.node_b).not.toBe(nodeB);
    expect(state.nodes.node_b.status).toBe('running');
    const nodesAfter = state.nodes;

    state = runtimeProjectionReducer(state, {
      type: 'event',
      event: event({
        eventId: 'event_control', sequence: 2, type: 'flow.control-edge.activated', edgeId: 'control_new',
        payload: { sourceNodeId: 'node_a', targetNodeId: 'node_b' }
      })
    });
    expect(state.nodes).toBe(nodesAfter);
    expect(state.controlEdges.control_new.status).toBe('activated');
    expect(state.controlEdges.control_old).toBe(base.controlEdges.control_old);

    state = runtimeProjectionReducer(state, {
      type: 'event',
      event: event({
        eventId: 'event_data', sequence: 3, type: 'flow.data-edge.resolved', edgeId: 'data_new',
        payload: { secret: true, value: '[REDACTED]' }
      })
    });
    expect(state.dataEdges.data_new.payload.value).toBe('[REDACTED]');
    expect(state.dataEdges.data_old).toBe(base.dataEdges.data_old);
  });

  it('projects retry, reuse, failure routes and paused runs', () => {
    let state = runtimeProjectionReducer(createRuntimeProjection(), { type: 'reset', runId: 'run_1', flowUid: 'flow_1' });
    state = runtimeProjectionReducer(state, {
      type: 'event',
      event: event({ eventId: 'retry', type: 'flow.node.retrying', nodeId: 'request_a', payload: { nextAttempt: 2 } })
    });
    expect(state.nodes.request_a.status).toBe('retrying');
    state = runtimeProjectionReducer(state, {
      type: 'event',
      event: event({ eventId: 'reused', sequence: 2, type: 'flow.node.reused', nodeId: 'request_b' })
    });
    expect(state.nodes.request_b.status).toBe('reused');
    state = runtimeProjectionReducer(state, {
      type: 'event',
      event: event({ eventId: 'failure-edge', sequence: 3, type: 'flow.failure-route.activated', edgeId: 'failure_1' })
    });
    expect(state.controlEdges.failure_1.status).toBe('failure');
    state = runtimeProjectionReducer(state, {
      type: 'event',
      event: event({ eventId: 'paused', sequence: 4, type: 'flow.run.paused', payload: { checkpointId: 'checkpoint_1' } })
    });
    expect(state.status).toBe('paused');
  });

  it('stores resolved previews and terminal run results', () => {
    let state = runtimeProjectionReducer(createRuntimeProjection(), { type: 'reset', runId: 'run_1', flowUid: 'flow_1' });
    state = runtimeProjectionReducer(state, {
      type: 'event',
      event: event({
        eventId: 'event_preview', type: 'flow.node.resolved-request', nodeId: 'node_request',
        payload: { preview: { headers: { Authorization: '[REDACTED]' } } }
      })
    });
    state = runtimeProjectionReducer(state, {
      type: 'result',
      result: { runId: 'run_1', status: 'success', outputs: {} }
    });

    expect(state.nodes.node_request.preview.headers.Authorization).toBe('[REDACTED]');
    expect(state.status).toBe('success');
    expect(state.result.outputs).toEqual({});
  });
});
