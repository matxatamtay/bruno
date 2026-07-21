# Flow schema v1

The runtime contract is published from `packages/bruno-flow-core/src/schema/flow-schema-v1.schema.json`. The documentation mirror at [`schema/flow-schema-v1.schema.json`](./schema/flow-schema-v1.schema.json) is protected by a byte-equivalence test.

## Core rules

- `schemaVersion` is exactly `1`.
- `uid` is stable across rename and move.
- `revision` is a content-derived revision such as `sha256:<hex>`.
- `node.id` is graph-instance identity.
- `node.semanticKey` is stable expression and MCP identity.
- Request nodes store references, not embedded Bruno requests.
- `controlEdges` and `dataEdges` are separate arrays with separate endpoint semantics.
- Frames are canvas entities and may apply inherited execution policy, but they are not automatically executable nodes.
- Runtime status, resolved secrets, response bodies, and run history are forbidden in a flow definition.

## File placement

```text
workspace/
  flows/
    checkout.flow.yml
    shared/authenticate.flow.yml
```

Flow graphs do not live inside `workspace.yml`. Independent files keep Git diffs readable, reduce watcher conflicts, and allow sharing a flow as a file.

## Revision and serialization

Phase 2 will define canonical YAML serialization. The serializer must use stable section ordering, avoid rewriting unrelated content, end with a newline, omit runtime state and secrets, and pass deterministic round-trip fixtures.
