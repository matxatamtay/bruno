# RequestExecutionService contract

## Target interface

```ts
interface RequestExecutionService {
  execute(input: RequestExecutionInput): Promise<RequestExecutionOutcome>;
}

type RequestExecutionInput = {
  workspaceContext?: { uid?: string; pathname?: string };
  collection: BrunoCollection;
  item: BrunoRequestItem;
  environmentContext?: BrunoEnvironment;
  runtimeVariables?: Record<string, unknown>;
  overrides?: RequestOverrides;
  executionContext?: {
    executionId?: string;
    source?: 'renderer' | 'flow-runtime' | 'mcp' | 'lca-bridge' | 'headless-test';
    runInBackground?: boolean;
    correlationId?: string;
  };
  signal?: AbortSignal;
};
```

## Phase 0 outcome

The Phase 0 implementation wraps the current Bruno `runRequest` lifecycle and returns metadata plus `legacyResult`. The existing IPC adapter projects `legacyResult` unchanged, preserving renderer behavior. The concrete main-process instance is registered in `automation-service-registry`, so future Flow Runtime and MCP adapters can obtain it without invoking a renderer channel.

```ts
type RequestExecutionOutcome = {
  executionId: string;
  protocol: 'http' | 'graphql' | 'grpc' | 'websocket' | 'unknown';
  status: 'success' | 'failed' | 'cancelled' | 'skipped';
  source: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  legacyResult: unknown;
};
```

Phase 1 replaces `legacyResult` with the standard safe `ExecutionResult` envelope and wires caller cancellation into the underlying Bruno abort controller.

## Responsibilities

The service boundary ultimately owns request cloning, variable and environment resolution, overrides, auth, scripts, network execution, streams, assertions, tests, timeline, cookies, certificates, proxy, redaction, cancellation, metrics, and event emission.

Protocol adapters execute protocol mechanics only. They do not resolve environment or business policy.
