# Flow Studio Phase 1: Shared execution core

Status: implemented

## Scope completed

- `RequestExecutionService` is the shared entry point for renderer, collection runner, headless callers, and future Flow/MCP adapters.
- `ExecutionResult` is normalized for HTTP and GraphQL with safe request/response projections, assertions, tests, timeline, variable changes, warnings, duration, error, and control metadata.
- `AbortSignal` is linked to Bruno's existing per-request `AbortController` and cancel-token registry.
- Runtime delays and active network calls use the same cancellation signal.
- HTTP and GraphQL share one protocol adapter.
- Event context separates execution lifecycle from renderer transport while preserving legacy IPC events.
- The existing single-request UI uses `executeLegacy`, preserving its exact response shape without paying normalized-projection overhead.
- The collection/folder runner calls the same execution service and translates events back to its legacy Redux contract.
- The duplicated runner network lifecycle was removed.

## Gate evidence

- Full `bruno-electron` Jest suite passes: 52 suites, 711 tests passed, 1 skipped.
- Full `bruno-app` Jest suite and production web build pass.
- Headless service integration executes a real local HTTP request.
- In-flight and pre-start cancellation tests pass.
- Structured redaction tests cover Authorization, password, and runtime token values.
- A structural regression test enforces one standalone HTTP/GraphQL network lifecycle in `ipc/network/index.js`.
- Targeted ESLint and `git diff --check` pass.

## Deferred

- gRPC and WebSocket adapters remain separate protocol work.
- SSE completion currently runs post-response scripts asynchronously after stream close, preserving existing behavior.
- MCP authorization and transport are later phases; they will call this service rather than introduce network logic.
