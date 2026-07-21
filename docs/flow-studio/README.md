# Bruno Flow Studio

Flow Studio is a collection-scoped automation suite for connecting existing Bruno requests. It is not a second request client and does not own a separate variable or environment model.

## Product boundary

- Flow Studio opens as a collection-scoped singleton beside Intelligence Suite.
- A flow can reference requests from its current collection only.
- New flows expose HTTP and GraphQL requests because those protocols currently share Bruno's renderer-neutral request execution lifecycle.
- The request editor remains the only place to edit URL, auth, headers, query parameters, body, scripts, tests, assertions and request settings.
- Flow Studio provides ordering, control flow, response extraction and runtime-variable mapping.

## Canonical request execution

Every request node keeps a reference to a real Bruno request. At execution time Bruno receives the current collection, request item, active environment, global environment, runtime variables and workspace context through `RequestExecutionService`.

The request then follows the same lifecycle as the normal Send action, including:

- collection, folder and request variables;
- active collection environment and active global environment;
- collection `.env` and process environment values;
- prompt variables;
- inherited auth and OAuth credentials;
- pre-request and post-response scripts;
- tests and assertions;
- cookies;
- client certificates, proxy and network settings;
- unsaved request drafts from the renderer;
- cancellation and structured execution results.

Flow Studio does not clone request configuration into the flow file.

## Connecting APIs

Data from an earlier response is passed to a later request as a Bruno runtime variable.

Example:

1. `Create customer` returns `response.body.customer.id`.
2. A Response value node extracts that path.
3. The value is mapped to runtime variable `customerId` on `Update customer`.
4. The real Bruno request continues to use `{{customerId}}` in its URL, query, header or body.

This keeps the request reusable from normal Send, Runner, MCP and Flow Studio without maintaining two versions of the request.

## Environment behavior

Flow Studio uses the collection's normal Environment Selector. Changing the selected environment changes subsequent flow runs exactly as it changes normal request execution.

There are no new Environment variable or Secret reference assets in the current authoring UI. Legacy saved flows containing those nodes or direct body, query and header bindings remain readable for compatibility, but new mappings use `runtime.<variableName>`.

## Storage

Flow files are stored under the current collection's `flows/` directory. Request references use paths relative to that collection and are validated against the real collection path before execution.

The request file on disk remains the identity and path-confinement trust anchor. The current renderer item is used for execution so unsaved request drafts behave like normal Send.

## Safety and redaction

Runtime-variable mappings carry provenance and secret taint. Secret values remain available internally for request execution while previews, events and persisted run projections use redacted values.

## Compatibility

- Legacy workspace-scoped Flow Studio tabs are ignored during snapshot restoration.
- Existing flow files with direct `request.body`, `request.query` or `request.header` bindings continue to run.
- Existing environment input nodes continue to resolve for old flows, but the new asset panel no longer creates them.
- gRPC, WebSocket and SSE requests are not shown in the new asset panel until they are routed through the same shared request lifecycle as normal Send.
