# Flow Studio Phase 2: Flow core and persistence

## Package boundary

`packages/bruno-flow-core` publishes two surfaces:

- `@usebruno/flow-core`: schema, parser, deterministic serializer, migrations, revision hashing, factory, and compiler skeleton. It has no filesystem or Electron dependency.
- `@usebruno/flow-core/persistence`: `FlowStore`, atomic writes, optimistic revision checks, filesystem watcher, and draft recovery.

## Persistence layout

```text
workspace/
  flows/
    checkout.flow.yml
    shared/auth.flow.yml
  .bruno/
    flow-drafts/
      flow_checkout.draft.json
```

Drafts are intentionally outside `flows/` so catalog watchers and Git-facing flow definitions do not ingest transient recovery data.

## Revision rules

The serializer computes `sha256:<hex>` from the canonical document excluding the `revision` field itself. The parser always recomputes this value instead of trusting the stored field.

Therefore an external editor can change a flow without updating `revision`; the next save still sees the changed content revision and raises `FlowRevisionConflictError`. Save checks the revision once before serialization and again immediately before the atomic rename, so a detected conflict never replaces the target file.

## Atomic save

A save writes a uniquely named temporary file in the target directory, flushes it, runs a final revision and realpath boundary check, renames it over the destination, and flushes the containing directory where supported. A per-path async lock serializes writers within the Bruno process. Symlink and junction escapes outside `workspace/flows` are rejected.

## Compiler skeleton

The compiler validates a flow and builds a protocol-neutral IR containing entry nodes, deterministic node order, control/data adjacency, and diagnostics. It does not execute requests in Phase 2.

## Redux catalog

`flow-catalog` stores only catalog projections, active selection, conflict badges, and draft recovery badges. Flow definitions remain owned by `FlowStore`; runtime state is not written back into flow files.

## Gates

- CRUD flow without canvas: covered by `FlowStore` tests.
- Deterministic round-trip: `serialize(parse(serialize(flow)))` is byte-identical.
- External edit detection: covered by real chokidar create/change/invalid/recovery tests.
- Conflict does not overwrite file: covered by stale-revision and atomic pre-commit tests.

## Verification

- `@usebruno/flow-core`: 12 tests passing; CJS, ESM, root types, and persistence types build successfully.
- Electron CI suite: 54 suites passing, 719 tests passing, 1 skipped.
- Bruno app suite: 91 suites and 1,422 tests passing.
- Full repository ESLint with errors-only mode: passing.
- Bruno app production build: passing.
- Package root and `./persistence` exports: load successfully; `npm pack --dry-run` passes.
- Changed-source secret scans: no findings.
