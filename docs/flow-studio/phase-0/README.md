# Flow Studio Phase 0

Status: architecture spike

This directory is the decision record and executable proof for Phase 0 of the Bruno Automation Platform.

## Deliverables

- [ADR 0001](./adr/0001-automation-platform-boundaries.md)
- [Threat model](./threat-model.md)
- [Flow schema v1](./flow-schema-v1.md)
- [JSON Schema](./schema/flow-schema-v1.schema.json)
- [Event contract](./event-contract.md)
- [RequestExecutionService contract](./request-execution-service.md)
- [MCP scope matrix](./mcp-scope-matrix.md)
- [Spike report](./spike-report.md)

## Phase 0 gates

1. A request can be invoked through `RequestExecutionService` without a renderer call.
2. A React Flow canvas can render 500 request nodes, a custom control edge, and a custom frame.
3. Updating one node runtime projection does not replace the graph or notify unrelated nodes.

Phase 0 is intentionally a seam-finding exercise. Persistence, canonical serialization, complete result normalization, cancellation plumbing, MCP transport, and production UI integration remain later-phase work.
