# ADR 0001: Bruno Automation Platform boundaries

- Status: accepted for Phase 0
- Date: 2026-07-20
- Owners: Bruno Flow Studio

## Context

Bruno currently executes HTTP and GraphQL requests from logic nested inside Electron network IPC. Flow Studio, the existing renderer, future headless callers, and Bruno MCP must not grow separate execution implementations.

The renderer also currently receives a generic `ipcRenderer` facade. That is existing behavior, not the target security posture for privileged Flow Studio and MCP operations.

## Decision

### One execution core, multiple adapters

All request entry points call `RequestExecutionService`.

```text
Renderer adapter ─┐
Flow runtime ─────┼─> RequestExecutionService ─> current Bruno request lifecycle
MCP adapter ──────┘
```

Entry-point adapters may validate their transport schema, authorize the caller, invoke the service, and project a safe result. They must not resolve environments, execute scripts, or perform network calls themselves.

### Electron main process is the trust boundary

The main process owns collection reads, environment and secret resolution, request execution, scripts, cookies, certificates, proxy configuration, flow persistence, redaction, audit, and MCP hosting.

Renderer state is limited to graph authoring state and redacted run projections. Flow Studio privileged APIs will be exposed through channel-specific preload methods rather than adding new generic IPC access.

### Control flow and data flow are separate domains

Flow schema v1 stores `controlEdges` and `dataEdges` separately. Their validation, runtime events, and visual semantics remain independent.

### Domain schema does not depend on React Flow

`@xyflow/react` is the Phase 0 graph engine, wrapped by Flow Studio components. Persisted nodes, edges, frames, viewport, and runtime events use Bruno-owned types.

### Runtime projection is event-driven

The main process emits idempotent event deltas. A node component subscribes only to its own runtime projection. Graph structure is not rewritten for status animation.

## Consequences

- The legacy renderer keeps its response shape through a temporary IPC adapter.
- Phase 0 introduces the service seam without moving the entire request lifecycle in one risky patch.
- Phase 1 will normalize `ExecutionResult`, wire cancellation end to end, and remove renderer-specific event sends from the execution core.
- Existing generic preload exposure is recorded as technical debt and must not be copied into new Flow Studio or MCP APIs.

## Rejected alternatives

- Separate execution implementations for renderer, flow runtime, and MCP: rejected because behavior, auth, cookies, scripts, and security controls would drift.
- Store React Flow objects directly in flow files: rejected because UI library upgrades would become schema migrations.
- Put node runtime status into the graph nodes array: rejected because high-frequency events would cause broad graph reconciliation.
