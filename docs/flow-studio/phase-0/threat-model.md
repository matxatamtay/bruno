# Phase 0 threat model

## Assets

- Workspace and collection files
- Environment values, secrets, auth tokens, cookies, certificates, and proxy credentials
- Resolved requests and response bodies
- Flow definitions, run history, and audit events
- MCP authorization token and tool permissions

## Trust boundaries

1. Renderer to Electron main process
2. Local MCP client to Bruno MCP server
3. Bruno to remote network hosts
4. Flow files and collection files to runtime
5. Script sandbox to host process

## Threats and required controls

| Threat | Phase 0 decision | Production control owner |
|---|---|---|
| Malicious renderer invokes privileged IPC | New Flow/MCP APIs must validate sender and schema; no new generic invoke surface | Electron adapter |
| Unauthorized MCP request execution | Deny by default; scopes split into read, prepare, execute, and write | MCP policy layer |
| SSRF to metadata or local services | Host/protocol policy before DNS and after redirects; metadata IP denylist | Request policy |
| Secret leakage through result, events, logs, or MCP | Safe projections and structured redaction; never dump raw environments | Redaction service |
| Script escapes sandbox | QuickJS by default, no Node API/network/filesystem, bounded CPU/memory/output | Script runtime |
| Infinite flow, recursion, or fan-out | Limits on nodes, depth, attempts, fan-out, total requests, duration, and concurrency | Flow compiler/runtime |
| Retry repeats non-idempotent side effects | Idempotency policy and explicit confirmation for unsafe retries | Execution policy |
| Flow changes between preview and apply | Expected revision and semantic diff before atomic write | Flow store |
| Path traversal or symlink escape | Canonical path, realpath, workspace-root containment, extension allowlist | Filesystem adapter |
| Huge response or never-ending stream | Request/response size caps and stream duration limits | Protocol adapter |
| MCP binds beyond loopback | Loopback default; remote binding requires explicit opt-in and auth | MCP server |
| Runtime event spoofing or replay | Main-process event IDs, run correlation, idempotent reducer, bounded replay | Event bus |

## Security invariants

- A renderer payload never supplies resolved secrets to the execution core.
- Safe projections never contain known secret test fixtures.
- Every mutation tool carries an authorization annotation and an expected revision.
- A terminal execution event is emitted at most once.
- An aborted execution cannot transition back to running.
- New Flow Studio privileged channels are channel-specific and schema validated.

## Deferred threats

The following are not allowed in production v1 without separate review: arbitrary Node.js or shell execution, remote code plugins, distributed execution, cloud-hosted MCP, unbounded loops, and unattended scheduling while Bruno is closed.
