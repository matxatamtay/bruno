# Bruno Flow Studio Phase 7

## Local Coding Agent integration

Phase 7 connects Local Coding Agent to the Bruno MCP server implemented in Phase 6. The bridge is intentionally policy-preserving: it adds authentication, endpoint safety, friendly errors, dedicated wrappers, and approval binding, but does not create a second execution path.

Implementation repository:

```text
/home/rjhniv/lca/lca-custom-staging
```

Primary files:

- `server/bruno-desktop.mjs`
- `server/test-bruno-desktop.mjs`
- `server/server.mjs`
- `server/README.md`
- `.env.example`

## Environment

```env
BRUNO_DESKTOP_MCP_URL=http://127.0.0.1:3847/mcp
BRUNO_DESKTOP_AUTH_TOKEN=<token copied from Bruno Preferences>
BRUNO_DESKTOP_TIMEOUT_MS=120000
BRUNO_DESKTOP_ALLOW_REMOTE=0
```

The bridge rejects non-loopback endpoints unless `BRUNO_DESKTOP_ALLOW_REMOTE=1` is explicitly configured.

## Bridge responsibilities

`bruno-desktop.mjs` owns:

- endpoint normalization;
- loopback enforcement;
- bearer authentication;
- bounded request timeout;
- MCP client connect and close lifecycle;
- tool discovery;
- direct dedicated tool calls;
- read-only generic forwarding;
- friendly offline, authentication, and permission errors;
- explicit patch-apply approval validation;
- no argument or token logging.

When Bruno is stopped, status returns actionable instructions to open Bruno, enable MCP, and configure the token instead of exposing a low-level `ECONNREFUSED` error.

## LCA tools

### Read and discovery

- `bruno_status`
- `bruno_list_tools`
- `bruno_list_workspaces`
- `bruno_list_flows`
- `bruno_get_flow`
- `bruno_search_requests`
- `bruno_get_request`
- `bruno_get_run`
- `bruno_get_run_events`

### Preview

- `bruno_prepare_request`
- `bruno_prepare_flow_run`
- `bruno_preview_resolved_request`
- `bruno_preview_flow_patch`

### Execution

- `bruno_run_request`
- `bruno_run_flow`
- `bruno_cancel_run`

### Write

- `bruno_apply_flow_patch`

## Generic passthrough policy

`bruno_call_tool` first lists the live upstream Bruno tools and forwards only a tool with:

```text
readOnlyHint: true
destructiveHint: false
```

There is no generic mutation or execution passthrough. `bruno_run_flow`, `bruno_run_request`, `bruno_cancel_run`, and `bruno_apply_flow_patch` require dedicated wrappers and remain subject to Local Coding Agent policy.

Under `AGENT_POLICY=strict`:

- Bruno reads remain available;
- request execution is blocked;
- flow execution is blocked;
- cancellation and patch apply are blocked.

Under `AGENT_POLICY=balanced`, these operations require the existing Local Coding Agent exact-action approval mechanism.

## Flow patch approval

The bridge adds a second approval boundary on top of Bruno's revision guard.

Preview sequence:

1. LCA calls `bruno_preview_flow_patch`.
2. Bruno validates the current revision, operations, graph, and side-effect summary.
3. LCA creates a short-lived capability bound to workspace, flow, expected revision, and exact operations.
4. The capability appears only in MCP `_meta`, not in model-visible content.

Apply sequence:

1. caller supplies the capability and `approved: true`;
2. LCA verifies the exact binding and consumes the capability once;
3. LCA sends Bruno the upstream preview ID, expected revision, and exact operations;
4. LCA never forwards its private capability to Bruno;
5. Bruno performs its own one-time preview and persistence revision checks.

Changing an operation, flow, workspace, or expected revision after preview fails closed.

## Mock Bruno server

`server/test-bruno-desktop.mjs` starts an SDK-based mock Bruno Streamable HTTP server with bearer authentication and annotated read, execution, cancellation, and patch tools. It then tests both:

- the direct `bruno-desktop.mjs` bridge;
- the tools exposed through the real Local Coding Agent `server.mjs` process.

## Verification

- Bruno bridge integration: 35 passed, 0 failed.
- Existing DBeaver bridge regression: 46 passed, 0 failed.
- Local Coding Agent core integration with a live server process: 30 passed, 0 failed.
- LCA hardening suite: 30 passed, 0 failed.
- LCA security suite: 7 passed, 0 failed.
- `node --check` for bridge, server, and integration test: passing.
- `git diff --check`: passing.
- Direct scans found no Bruno auth-token logging or generic mutation passthrough.
- Heuristic review: no P1 or P2 findings. The review tool reports a P3 size notice for the large server registration block; the dedicated bridge and integration test are separate files.

## Phase 7 gate result

- LCA reads a Bruno request.
- LCA previews a flow run.
- LCA starts a flow run.
- LCA cancels a flow run.
- LCA previews and applies a revision-safe flow patch with exact approval binding.
- Generic passthrough cannot bypass execution or mutation policy.
- Existing DBeaver and core Local Coding Agent behavior remains green.
