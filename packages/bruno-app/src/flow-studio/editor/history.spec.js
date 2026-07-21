import { createAuthoringFlow, updateNode } from './model';
import { createEditorTimeline, editorTimelineReducer, isTimelineDirty } from './history';

const flow = createAuthoringFlow({
  uid: 'flow_history',
  name: 'History flow',
  workspaceUid: 'workspace_local',
  now: new Date('2026-07-20T00:00:00.000Z')
});

describe('Flow Studio history timeline', () => {
  it('supports undo and redo while tracking the saved checkpoint', () => {
    let state = editorTimelineReducer(createEditorTimeline(), {
      type: 'load',
      flow,
      baseRevision: flow.revision
    });
    expect(isTimelineDirty(state)).toBe(false);

    const renamed = updateNode(flow, flow.nodes[0].id, { name: 'Begin' });
    state = editorTimelineReducer(state, { type: 'commit', flow: renamed });
    expect(isTimelineDirty(state)).toBe(true);
    expect(state.present.nodes[0].name).toBe('Begin');

    state = editorTimelineReducer(state, { type: 'undo' });
    expect(state.present.nodes[0].name).toBe('Start');
    expect(isTimelineDirty(state)).toBe(false);

    state = editorTimelineReducer(state, { type: 'redo' });
    expect(state.present.nodes[0].name).toBe('Begin');
    expect(isTimelineDirty(state)).toBe(true);
  });

  it('marks viewport-only replacements as dirty and resets after a saved record', () => {
    let state = editorTimelineReducer(createEditorTimeline(), { type: 'load', flow });
    const movedViewport = { ...flow, viewport: { x: 10, y: 20, zoom: 0.9 } };
    state = editorTimelineReducer(state, { type: 'replace', flow: movedViewport });
    expect(isTimelineDirty(state)).toBe(true);

    const saved = { ...movedViewport, revision: `sha256:${'a'.repeat(64)}` };
    state = editorTimelineReducer(state, { type: 'saved', flow: saved });
    expect(isTimelineDirty(state)).toBe(false);
    expect(state.baseRevision).toBe(saved.revision);
  });
});
