# Runtime event contract v1

## Envelope

```ts
type AutomationEvent<TType extends string, TPayload> = {
  schemaVersion: 1;
  eventId: string;
  sequence: number;
  timestamp: string;
  workspaceUid: string;
  correlationId: string;
  source: 'renderer' | 'flow-runtime' | 'mcp' | 'lca-bridge' | 'system';
  type: TType;
  runId?: string;
  flowUid?: string;
  nodeId?: string;
  attemptId?: string;
  parentRunId?: string;
  payload: TPayload;
};
```

## Event families

- `request.execution.started`
- `request.execution.completed`
- `request.execution.failed`
- `request.execution.cancelled`
- `flow.run.queued`
- `flow.run.started`
- `flow.run.completed`
- `flow.run.failed`
- `flow.run.cancelled`
- `flow.node.queued`
- `flow.node.resolving-input`
- `flow.node.started`
- `flow.node.waiting`
- `flow.node.retrying`
- `flow.node.completed`
- `flow.node.failed`
- `flow.node.skipped`
- `flow.node.cancelled`
- `flow.control-edge.activated`
- `flow.data-edge.resolved`

## Ordering and replay

- `eventId` is globally unique and makes reducer application idempotent.
- `sequence` is monotonic within a run.
- A subscriber that detects a gap requests `getRunProjection(runId, afterEventId)`.
- A terminal event is emitted once. Later duplicate terminal events are ignored and audited.
- Event payloads are safe projections. Raw Authorization, Cookie, secret environments, MCP tokens, and unredacted bodies are forbidden.

## Renderer projection rule

Graph structure and runtime projection are separate. Runtime events update a per-node store keyed by `nodeId`; they do not rebuild the persisted `nodes` array. This is the basis of the Phase 0 single-node rerender proof.
