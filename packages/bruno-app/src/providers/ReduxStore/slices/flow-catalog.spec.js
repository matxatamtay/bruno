import reducer, {
  flowCatalogEventReceived,
  flowCatalogLoaded,
  flowConflictDetected,
  flowDraftRecoveryAvailable,
  selectWorkspaceFlows,
  setActiveFlow
} from './flow-catalog';
import { createFlowCatalogEventHandler } from './flow-catalog-events';

const validEntry = {
  uid: 'flow_checkout',
  name: 'Checkout',
  relativePath: 'checkout.flow.yml',
  pathname: '/workspace/flows/checkout.flow.yml',
  revision: `sha256:${'a'.repeat(64)}`,
  updatedAt: '2026-07-20T10:00:00.000Z',
  tags: [],
  status: 'valid'
};

describe('flow catalog Redux slice', () => {
  it('loads, sorts and selects a workspace catalog', () => {
    const state = reducer(undefined, flowCatalogLoaded({
      workspaceUid: 'workspace_local',
      entries: [
        { ...validEntry, uid: 'flow_z', relativePath: 'z.flow.yml' },
        validEntry
      ]
    }));

    expect(selectWorkspaceFlows({ flowCatalog: state }, 'workspace_local').map((entry) => entry.uid)).toEqual([
      'flow_checkout',
      'flow_z'
    ]);
  });

  it('projects watcher create, change, invalid and delete events', () => {
    let state = reducer(undefined, flowCatalogEventReceived({
      workspaceUid: 'workspace_local',
      event: { type: 'created', relativePath: validEntry.relativePath, entry: validEntry }
    }));

    state = reducer(state, flowCatalogEventReceived({
      workspaceUid: 'workspace_local',
      event: {
        type: 'changed',
        relativePath: validEntry.relativePath,
        entry: { ...validEntry, name: 'Checkout v2', revision: `sha256:${'b'.repeat(64)}` }
      }
    }));
    expect(state.byWorkspace.workspace_local.entities.flow_checkout.name).toBe('Checkout v2');

    state = reducer(state, flowCatalogEventReceived({
      workspaceUid: 'workspace_local',
      event: {
        type: 'invalid',
        relativePath: validEntry.relativePath,
        entry: {
          uid: null,
          name: validEntry.relativePath,
          relativePath: validEntry.relativePath,
          pathname: validEntry.pathname,
          revision: null,
          updatedAt: null,
          tags: [],
          status: 'invalid',
          error: 'bad yaml'
        }
      }
    }));
    expect(state.byWorkspace.workspace_local.entities['invalid:checkout.flow.yml'].status).toBe('invalid');
    expect(state.byWorkspace.workspace_local.entities.flow_checkout).toBeUndefined();

    state = reducer(state, flowCatalogEventReceived({
      workspaceUid: 'workspace_local',
      event: {
        type: 'deleted',
        relativePath: validEntry.relativePath,
        previous: { ...validEntry, uid: null }
      }
    }));
    expect(state.byWorkspace.workspace_local.ids).toEqual([]);
  });

  it('stores active flow, conflict and draft recovery badges separately from flow files', () => {
    let state = reducer(undefined, setActiveFlow({ workspaceUid: 'workspace_local', flowUid: 'flow_checkout' }));
    state = reducer(state, flowConflictDetected({
      workspaceUid: 'workspace_local',
      flowUid: 'flow_checkout',
      conflict: { expectedRevision: 'old', actualRevision: 'external' }
    }));
    state = reducer(state, flowDraftRecoveryAvailable({
      workspaceUid: 'workspace_local',
      flowUid: 'flow_checkout',
      recovery: { draftUid: 'flow_checkout', hasConflict: true }
    }));

    expect(state.activeFlowUidByWorkspace.workspace_local).toBe('flow_checkout');
    expect(state.byWorkspace.workspace_local.conflicts.flow_checkout.actualRevision).toBe('external');
    expect(state.byWorkspace.workspace_local.drafts.flow_checkout.hasConflict).toBe(true);
  });

  it('adapts a generic persistence event source without depending on Electron', () => {
    const dispatch = jest.fn();
    const handler = createFlowCatalogEventHandler({ dispatch, workspaceUid: 'workspace_local' });
    const event = { type: 'created', relativePath: validEntry.relativePath, entry: validEntry };

    handler(event);

    expect(dispatch).toHaveBeenCalledWith(flowCatalogEventReceived({ workspaceUid: 'workspace_local', event }));
  });
});
