# Flow Studio Phase 4: Data binding and sequential runtime

## Scope

Phase 4 turns the Phase 3 authoring graph into an executable sequential flow. The runtime is split into three layers:

1. `@usebruno/flow-core` owns runtime values, provenance, taint, merge rules, request binding, response extraction, safe projection, scheduling, and event contracts.
2. Electron owns request-file resolution, path authorization, cancellation, access to the shared `RequestExecutionService`, and the renderer event bridge.
3. Flow Studio owns run inputs, the run console, resolved-request previews, and live node/edge projections. It never receives raw secret-tainted runtime values.

The implementation continues the platform rule from Phase 0: one request execution core, many entry points. The sequential scheduler does not implement its own HTTP client.

## Input schema and input nodes

`FlowDefinition.inputSchema` is the persisted source for run-form fields. Phase 4 supports this JSON Schema subset:

- `type: object`
- `properties`
- property `type` for string, number, integer, boolean, object, array, or null
- `required`
- `default`
- `enum`
- `title` and `description` for authoring UI
- `writeOnly` for secret form fields

A Form Input node updates the corresponding schema property when its field name, type, required flag, display name, or secret flag changes. Deleting the node removes the property and required entry.

Runtime input nodes:

- Static Input
- Form Input
- Environment Input
- Dataset Input
- Secret Reference

Each output is a `FlowRuntimeValue` containing the raw in-process value, a secret taint bit, and ordered provenance entries.

## Data binding

Data edges targeting request paths inject values into cloned request definitions:

```text
request.query.<name>
request.header.<name>
request.body.<json.path>
```

Query and header values are upserted into Bruno request lists. Body values are merged into JSON body paths. Supported transforms are deliberately allowlisted:

- identity
- string
- number
- boolean
- json-stringify
- json-parse

Arbitrary expressions or JavaScript are not evaluated by the binding engine.

## Response extraction and merge

Response request nodes expose runtime outputs:

```text
response
response.status
response.headers
response.body
result
```

A Response Extractor selects a source request output and an optional nested path. Extracted values preserve response provenance, the incoming data-edge hop, and extractor provenance.

Merge nodes support deterministic deep-object merge with:

- `last-write-wins`, the default
- `first-write-wins`

The merge result records conflict paths, combines provenance in source order, and remains secret-tainted when any input is secret.

## Secret taint and safe projection

Raw values exist only inside the runtime process and the actual cloned request sent to `RequestExecutionService`. Renderer-facing data uses safe projections.

A value is treated as secret when:

- its input source is marked secret
- it comes from Secret Reference
- its environment entry is secret
- its binding or extraction path contains a sensitive key such as authorization, cookie, password, secret, token, API key, or client secret
- it is derived from another secret-tainted value
- it is merged with a secret-tainted value

Safe projection replaces an entirely tainted value with `[REDACTED]`. It also recursively redacts sensitive object keys as a second line of defense, including nested response objects that were not explicitly tainted. Safe projection handles circular objects and has a depth bound.

The following renderer-facing surfaces are safe-only:

- `flow.data-edge.resolved` event values
- `flow.node.resolved-request`
- run result outputs
- resolved request preview
- run console event payloads

## Sequential scheduler

The scheduler executes one control path at a time:

1. compile and validate the flow
2. select the first entry node
3. queue and start the node
4. lazily resolve required data dependencies
5. resolve request bindings
6. call the shared request execution service
7. expose response outputs for later extractors
8. activate the single outgoing control edge
9. continue until no outgoing edge remains

Phase 4 intentionally rejects:

- control cycles
- more than one outgoing control edge from an executed node
- data dependency cycles
- missing required bindings
- unsupported transforms

Branch conditions, fan-out, parallel scheduling, retry policies, and loop budgets belong to later runtime phases.

## Event contract

Run events use schema version 1 and carry a monotonic sequence within a run:

```text
flow.run.queued
flow.run.started
flow.run.completed
flow.run.failed
flow.run.cancelled

flow.node.queued
flow.node.started
flow.node.resolving-input
flow.node.resolved-request
flow.node.completed
flow.node.failed
flow.node.cancelled

flow.data-edge.resolved
flow.control-edge.activated
```

Every event includes `eventId`, `sequence`, `timestamp`, `runId`, and `flowUid`. Node and edge events include their entity identifier. The renderer projection deduplicates by event ID and ignores events belonging to another run or flow.

## Electron trust boundary

Before production execution, Electron:

- resolves the persisted collection and item paths from `requestRef`
- verifies that the catalog collection path matches the persisted reference
- rejects lexical path escapes
- resolves real paths and rejects symlink escapes
- reloads and parses the request file from disk
- passes the cloned, bound request to the shared `RequestExecutionService`
- links run cancellation to the request adapter through `AbortSignal`

The persisted `expectedItemUid` is only a relocation hint. Item pathname remains the durable reference across application restarts, where in-memory request UIDs can change.

Dynamic runtime variables remain session state supplied by the mounted renderer collection model. Request URL, body, headers, auth, and scripts are not trusted from that payload because Electron reloads the request file from disk. Moving all dynamic environment and runtime-variable resolution into a headless main-process store is deferred beyond Phase 4.

## Flow Studio runtime UI

The workspace editor now includes:

- schema-backed Run Inputs
- Run and Cancel controls
- bounded live Run Console
- selected-node Resolved Request Preview
- request preview provenance
- live node status chips
- animated control-edge gradients for activated control paths
- animated data-edge gradients only for values that actually propagated

Starting a new run resets the prior projection. Completed route highlighting remains visible for the current run until another run or flow is loaded.

## Gates

Phase 4 gate coverage proves:

- multiple requests run end-to-end in control order
- form, static, and environment inputs resolve
- response extraction feeds a later request
- merge output feeds a later request
- query, body, and header injection are correct
- provenance contains source node, internal data-edge hops, extractor, merge, and final binding
- raw environment and nested response secrets reach the real bound request but never appear in safe result, preview, output, or event projections
- cancellation reaches the shared request adapter
- request files are reloaded from disk and symlink escapes are rejected
- live projection changes only the addressed node or edge
- gradient overlays appear only on activated control edges and resolved data edges

## Verification

- `@usebruno/flow-core`: 3 suites, 16 tests passing.
- Bruno App: 101 suites, 1,455 tests passing.
- Electron CI: 56 suites, 728 tests passing, 1 skipped.
- Phase 4 core end-to-end gate: 4 tests passing.
- Flow Studio editor gate: 10 suites, 32 tests passing.
- Flow runtime Electron service and IPC gate: 3 suites, 12 tests passing.
- Bruno App production build: passing.
- Full repository ESLint with errors-only mode: passing.
- `git diff --check`: passing.
- Direct security scans of flow-core runtime, Flow Studio editor, Electron services, and flow-runtime IPC: no findings.
- Heuristic review: no P1 or P2 findings; one P3 notice for the existing large lockfile block.

## Known boundaries

- The scheduler is sequential and single-path by design.
- Preflight preview cannot resolve a Response Extractor whose source request has not run yet. After execution, live resolved previews are available.
- Run history is in-memory for the active editor session and is not persisted in Phase 4.
- Dynamic runtime-variable collision policy across multiple mounted collections is currently last mounted collection wins.
- Full main-process ownership of dynamic environment/runtime-variable state is deferred; disk request content is already main-process authoritative.
