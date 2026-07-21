export const createRuntimeProjection = () => ({
  runId: null,
  flowUid: null,
  status: 'idle',
  nodes: {},
  controlEdges: {},
  dataEdges: {},
  events: [],
  seenEventIds: [],
  result: null,
  error: null
});

const terminalType = (type) => ['flow.run.completed', 'flow.run.failed', 'flow.run.cancelled', 'flow.run.paused'].includes(type);

const nodeStatusFromEvent = (event) => {
  if (event.type === 'flow.node.queued') return 'queued';
  if (event.type === 'flow.node.resolving-input') return 'resolving-input';
  if (event.type === 'flow.node.started') return 'running';
  if (event.type === 'flow.node.retrying') return 'retrying';
  if (event.type === 'flow.node.reused') return 'reused';
  if (event.type === 'flow.join.satisfied') return 'success';
  if (event.type === 'flow.node.completed') return event.payload?.status === 'skipped' ? 'skipped' : 'success';
  if (event.type === 'flow.node.failed') return 'failed';
  if (event.type === 'flow.node.skipped') return 'skipped';
  if (event.type === 'flow.node.cancelled') return 'cancelled';
  return null;
};

const runStatusFromEvent = (event) => {
  if (event.type === 'flow.run.queued') return 'queued';
  if (event.type === 'flow.run.started') return 'running';
  if (event.type === 'flow.run.completed') return 'success';
  if (event.type === 'flow.run.paused') return 'paused';
  if (event.type === 'flow.run.failed') return 'failed';
  if (event.type === 'flow.run.cancelled') return 'cancelled';
  return null;
};

export const runtimeProjectionReducer = (state, action) => {
  if (action.type === 'reset') {
    return {
      ...createRuntimeProjection(),
      runId: action.runId || null,
      flowUid: action.flowUid || null,
      status: action.runId ? 'queued' : 'idle'
    };
  }
  if (action.type === 'result') {
    if (state.runId && action.result?.runId && action.result.runId !== state.runId) return state;
    return {
      ...state,
      status: action.result?.status || state.status,
      result: action.result || null,
      error: action.result?.error || null
    };
  }
  if (action.type !== 'event') return state;
  const event = action.event;
  if (!event?.eventId || state.seenEventIds.includes(event.eventId)) return state;
  if (state.runId && event.runId !== state.runId) return state;
  if (state.flowUid && event.flowUid !== state.flowUid) return state;

  const next = {
    ...state,
    runId: event.runId,
    flowUid: event.flowUid,
    seenEventIds: [...state.seenEventIds, event.eventId].slice(-1000),
    events: [...state.events, event].slice(-500)
  };
  const runStatus = runStatusFromEvent(event);
  if (runStatus) next.status = runStatus;
  if (terminalType(event.type) && event.payload?.message) next.error = { message: event.payload.message, nodeId: event.payload.nodeId };

  if (event.nodeId) {
    const current = state.nodes[event.nodeId] || { status: 'idle' };
    const status = nodeStatusFromEvent(event);
    next.nodes = {
      ...state.nodes,
      [event.nodeId]: {
        ...current,
        ...(status ? { status } : {}),
        sequence: event.sequence,
        timestamp: event.timestamp,
        ...(event.type === 'flow.node.resolved-request' ? { preview: event.payload?.preview } : {}),
        ...(event.type === 'flow.node.completed' ? { result: event.payload?.result, preview: event.payload?.preview || current.preview } : {})
      }
    };
  }

  if (event.edgeId && ['flow.control-edge.activated', 'flow.failure-route.activated'].includes(event.type)) {
    next.controlEdges = {
      ...state.controlEdges,
      [event.edgeId]: {
        status: event.type === 'flow.failure-route.activated' ? 'failure' : 'activated',
        sequence: event.sequence,
        timestamp: event.timestamp,
        payload: event.payload
      }
    };
  }
  if (event.edgeId && event.type === 'flow.data-edge.resolved') {
    next.dataEdges = {
      ...state.dataEdges,
      [event.edgeId]: {
        status: 'resolved',
        sequence: event.sequence,
        timestamp: event.timestamp,
        payload: event.payload
      }
    };
  }
  return next;
};

export const getRuntimeForNode = (projection, nodeId) => projection?.nodes?.[nodeId] || null;
export const getRuntimeForControlEdge = (projection, edgeId) => projection?.controlEdges?.[edgeId] || null;
export const getRuntimeForDataEdge = (projection, edgeId) => projection?.dataEdges?.[edgeId] || null;
