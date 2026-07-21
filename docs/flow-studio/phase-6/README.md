# Bruno Flow Studio Phase 6

## Bruno MCP

Phase 6 exposes the existing Bruno Automation Platform through an authenticated Streamable HTTP MCP server. MCP remains an adapter around the main-process execution, persistence, and flow-runtime services. It does not reimplement request execution or trust renderer-owned request definitions.

## Endpoint and lifecycle

Default endpoint:

```text
http://127.0.0.1:3847/mcp
```

Health endpoint:

```text
http://127.0.0.1:3847/healthz
```

The server:

- runs inside the Electron main process;
- is disabled by default;
- binds to loopback by default;
- starts and stops with Bruno;
- restarts after MCP preference changes;
- rejects non-loopback Host headers while remote access is disabled;
- accepts HTTP POST only for MCP;
- limits request bodies to 1 MiB.

Remote binding requires both an advanced preference and a confirmation warning in the renderer. It is not enabled silently.

## Authentication and token lifecycle

Authentication uses:

```text
Authorization: Bearer <token>
```

The token is 32 random bytes encoded as base64url. It is encrypted using Bruno's local encryption service before being written to AppData. The token file is written atomically with mode `0600`.

Token controls:

- generate on first enable;
- rotate from Preferences;
- revoke the old token immediately without waiting for a server restart;
- disconnect clients by rotating the token;
- expose only creation time, rotation time, and a short fingerprint during normal status calls;
- reveal the replacement token only after an explicit rotate or disconnect action.

## Permission profiles

| Profile | Capabilities |
|---|---|
| Read Only | status, workspace/request/flow reads, validation, previews, run reads, patch preview |
| Runner | Read Only plus request and flow execution and cancellation |
| Editor | Runner plus revision-safe flow patch apply |
| Full Control | Editor plus administrative scope |

Permission checks run inside every tool handler. Tool annotations remain accurate for read-only, destructive, and idempotent behavior.

## Workspace and network policy

MCP can access only workspaces configured in Preferences. Request and flow references are reloaded from disk under the allowed workspace root with lexical path, realpath, and symlink checks.

Execution requires an explicit host allowlist. Controls include:

- protocol allowlist for HTTP, HTTPS, WS, and WSS;
- cloud metadata host block;
- private and loopback destination block unless explicitly enabled;
- dynamic host block unless explicitly enabled;
- wildcard subdomain allowlist entries such as `*.example.test`.

A URL containing `{{variable}}` or `${VARIABLE}` is classified as dynamic before URL parsing and fails closed by default.

## Historical MCP tools

> Superseded by the collection-native [Bruno Desktop MCP](../../mcp/README.md). Flow Studio tools, permission profiles, network allowlists, approvals, redacted projections, and flow patch tools are no longer part of the live Bruno MCP surface.

### Discovery and reads

- `bruno_status`
- `bruno_list_workspaces`
- `bruno_list_flows`
- `bruno_get_flow`
- `bruno_list_requests`
- `bruno_search_requests`
- `bruno_get_request`
- `bruno_get_run`
- `bruno_get_run_events`

### Validation and preview

- `bruno_validate_flow`
- `bruno_get_flow_inputs`
- `bruno_prepare_flow_run`
- `bruno_get_side_effect_summary`
- `bruno_preview_resolved_request`
- `bruno_prepare_request`
- `bruno_preview_flow_patch`

### Execution

- `bruno_run_request`
- `bruno_run_flow`
- `bruno_cancel_run`

### Revision-safe editing

- `bruno_apply_flow_patch`

Patch apply requires:

1. current `expected_revision`;
2. a valid preview;
3. the exact previewed operations;
4. a one-time preview ID;
5. explicit `approved: true`.

Identity, schema version, workspace identity, and revision fields cannot be patched directly. Persistence still performs the final revision conflict check and atomic save.

## Resources

- `bruno://run/{runId}`
- `bruno://run/{runId}/events`
- `bruno://flow/{flowUid}`

Run resources are safe projections. Flow resources search multiple allowed workspaces only when the UID resolves uniquely; ambiguity fails closed and requires an explicit workspace UID.

The process-local MCP run repository is bounded to 500 records. It is not the persistent run-history repository planned for the hardening phase.

## Redaction and audit

Renderer and MCP responses use recursive structured redaction for:

- Authorization and proxy authorization;
- cookies;
- passwords and credentials;
- access and refresh tokens;
- API keys and client secrets;
- private keys;
- named header and variable entries;
- raw environment and raw response fields.

Audit records never store complete tool arguments. They store safe identifiers and structural summaries such as string length, array length, and operation shape. This prevents an arbitrary input value under a harmless-looking key from becoming an audit-log secret leak.

The audit log is JSONL in AppData with directory mode `0700` and file mode `0600`.

## Rate limiting

Two fixed-window limiters are used:

- remote-address limiter before authentication, preventing brute-force bypass by rotating bad tokens;
- authenticated client limiter after bearer validation.

Rate-limit responses use HTTP 429 and `Retry-After`.

## Preferences UI

The MCP Preferences tab supports:

- enable and disable;
- endpoint host and port;
- permission profile;
- workspace allowlist;
- network host allowlist;
- dynamic/private host policy;
- loopback versus advanced remote binding;
- audit enablement;
- calls per minute;
- live status and connected-client count;
- token rotation;
- client disconnect and token revocation.

## Verification

Verified gates:

- MCP-specific Electron tests: 3 suites, 21 tests passing.
- MCP Preferences UI: 3 tests passing.
- Flow Core regression: 4 suites, 38 tests passing.
- Flow Studio and Preferences regression: 13 suites, 48 tests passing.
- Electron Automation/MCP regression: 11 suites, 59 tests passing.
- Bruno App production build: passing.
- Targeted ESLint errors-only: passing.
- `git diff --check`: passing.
- Direct source scans found no runtime `eval`, `Function` constructor, generic mutation passthrough, token logging, or known test-secret strings in production MCP code.
- Heuristic review: no P1 or P2 findings.

Dependency audit status is deliberately not marked green:

```text
npm audit --omit=dev --workspace=packages/bruno-electron
low: 1
moderate: 14
high: 15
critical: 0
```

These findings are in the broader Bruno production dependency graph and require a separate dependency-upgrade pass. No critical finding was reported, but Phase 6 does not claim a clean dependency audit.

## Phase 6 gate result

- MCP SDK client can list and run a flow.
- Read Only cannot call execution or mutation tools.
- Nested request, preview, run-result, event, and audit secret-redaction tests pass.
- A stopped Bruno server produces a friendly bridge error in Phase 7.
- Loopback-only is the default and remote binding requires explicit opt-in plus confirmation.
