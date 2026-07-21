# Phase 0 spike report

## Gate status

| Gate | Evidence | Status |
|---|---|---|
| Request executes outside renderer entry point | Direct local HTTP execution through `RequestExecutionService`; concrete Bruno service registered for main-process callers | Pass |
| Custom node, edge, and frame work | `Phase0FlowCanvas` renders a 500-node fixture, frame, and custom SVG control edge | Pass |
| One node event does not rerender the graph | Per-node `useSyncExternalStore` subscriptions; render-count assertion changes only `node-250` | Pass |

## Verification

- Electron service tests: 6 passing across the execution service and main-process registry.
- React Flow spike tests: 3 passing.
- Targeted ESLint: passing.
- Bruno web production build: passing.
- Storybook production build with the 500-node story: passing; existing asset-size warnings remain.
- Flow schema strict Ajv compile and minimal fixture validation: passing.

## Known gaps carried into Phase 1

- The current request lifecycle still emits several renderer-specific events directly.
- Caller `AbortSignal` is validated at the service boundary but is not yet connected to the internal request abort controller.
- `legacyResult` is not the final safe `ExecutionResult` envelope.
- New channel-specific preload APIs and sender validation are not part of this spike.
