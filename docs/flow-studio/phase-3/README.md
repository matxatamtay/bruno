# Flow Studio Phase 3: Canvas authoring

## Editor boundary

Phase 3 adds a first-class `workspaceFlowStudio` tab to each workspace. The tab is restored through the existing workspace snapshot system and renders a three-pane editor:

```text
Flow catalog and assets | React Flow canvas | Inspector
```

The persisted `FlowDefinition` remains the source of truth. React Flow nodes and edges are cached projections; React Flow selection, measured dimensions, and transient drag state are not written directly into the domain model.

## Authoring model

The editor supports:

- Creating and opening flow files through the Phase 2 persistence IPC.
- Dragging HTTP, GraphQL, WebSocket, gRPC, and SSE request assets from multiple loaded workspace collections.
- Static, form, environment, and dataset input nodes.
- Separate control and data handles and custom edge renderers.
- Frames, grouping selected nodes, resizing frames, and safe frame deletion.
- Inspector editing for nodes, frames, control edges, and data edges.
- Body, query, and header bindings. Each binding is represented both in request node configuration and by a matching data edge.
- Undo, redo, search, selection deletion, and keyboard save.

## Persistence lifecycle

A new flow is created through `renderer:flow-create`. Existing flows load through `renderer:flow-read` and save through `renderer:flow-save` with the current `expectedRevision`.

While a graph is dirty, the editor writes a recovery draft after a short idle delay. A successful file save advances the saved history checkpoint and discards the matching draft. A stale revision raises a visible conflict state; Bruno does not overwrite the externally modified file.

Viewport is persisted with the graph after a real user viewport movement. The initial React Flow fit operation is ignored so merely opening a flow does not mark it dirty.

## Incremental validation

`IncrementalFlowValidator` keeps the previous result and accepts dirty entity sets:

- Local inspector and position changes validate only affected entities.
- Semantic key changes refresh uniqueness checks.
- Structural graph changes refresh references, uniqueness, and compiler topology diagnostics.
- Temporary invalid authoring states remain editable; compiler diagnostics are best-effort until schema validity is restored.
- Save always performs a full validation before calling persistence.

## Performance budget

The basic Phase 3 budget is:

- Project 500 custom nodes and 499 control edges in under 250 ms in the Jest performance fixture.
- When one of 500 nodes changes, retain projection object identity for the other 499 nodes and every unchanged edge.
- Use `onlyRenderVisibleElements` in the production React Flow canvas.
- Keep validation incremental for non-structural edits.

The existing Phase 0 React Flow browser-layout spike remains the renderer-level proof that 500 custom nodes can mount and that one runtime update does not rerender unrelated nodes. Flow Studio is loaded through a lazy workspace-tab boundary so React Flow and authoring code are not synchronously imported by the normal request tab path.

## Gates

- Create a flow through UI: covered by `FlowStudioWorkspace.spec.jsx`.
- Drag requests from multiple collections: covered by asset collection and drag payload tests.
- Create body/query/header bindings: covered through the real Inspector controls and domain round-trip tests.
- Restart without losing graph: covered by save, unmount, fresh Redux store, catalog reopen, and read-back integration test.
- 500-node basic performance: covered by projection duration and referential-cache tests, plus the Phase 0 React Flow mount test.

## Main files

```text
packages/bruno-app/src/flow-studio/editor/
  FlowStudioWorkspace.jsx
  model.js
  history.js
  validation.js
  graph-projection.js
  assets.js
  useFlowEditor.js
  components/
    AssetsPanel.jsx
    FlowCanvas.jsx
    FlowNodes.jsx
    FlowEdges.jsx
    Inspector.jsx
    Toolbar.jsx
```

## Verification

- Phase 3 and workspace snapshot regression group: 9 suites, 40 tests passing.
- Full Bruno app suite: 98 suites, 1,443 tests passing.
- Flow core suite: 2 suites, 12 tests passing.
- Electron CI suite: 54 suites, 719 tests passing, 1 skipped.
- Bruno app production build: passing with the Flow Studio workspace loaded through `React.lazy`.
- Full repository ESLint errors-only gate: passing.
- `git diff --check`: passing.
- Phase 3 source security scan: 21 files scanned, no findings.
- Heuristic review: no P1 or P2 findings.
