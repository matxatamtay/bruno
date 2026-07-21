# Bruno MCP scope matrix

Deny is the default. Tool registration includes the required scope and whether interactive approval is required.

| Capability | Example tools/resources | Required scope | Approval | Phase |
|---|---|---|---|---|
| Health and discovery | `bruno_status`, `bruno_list_tools` | `bruno:status` | No | Developer-only |
| Workspace/collection read | `bruno_list_workspaces`, `bruno_search_requests`, `bruno_get_request` | `bruno:read` | No | Internal alpha |
| Flow read | `bruno_list_flows`, `bruno_get_flow`, `bruno://flow/{uid}` | `bruno:flow:read` | No | Internal alpha |
| Safe preparation | `bruno_prepare_request`, `bruno_prepare_flow_run` | `bruno:prepare` | No, but output is redacted | Private beta |
| Request execution | `bruno_run_request` | `bruno:execute:request` | Policy dependent | Private beta |
| Flow execution | `bruno_run_flow`, `bruno_cancel_run` | `bruno:execute:flow` | Policy dependent | Private beta |
| Run read/events | `bruno_get_run`, `bruno://run/{runId}/events` | `bruno:run:read` | No | Private beta |
| Patch preview | `bruno_preview_flow_patch` | `bruno:flow:write:preview` | No mutation | Public beta |
| Patch apply | `bruno_apply_flow_patch` | `bruno:flow:write` | Yes; expected revision required | Public beta |
| Secret management | none in v1 | none | Not exposed | Deferred |
| Arbitrary script/shell | none | none | Forbidden | Out of scope |

## Transport policy

- Bind to `127.0.0.1` by default.
- Require an auth token for execution or mutation.
- Remote binding requires an explicit opt-in and is disabled in the LCA bridge by default.
- Arguments and results pass through structured redaction.
- Read-only passthrough cannot invoke execution or mutation tools.
- Every write requires `expected_revision`, `operations`, and `dry_run` support.
