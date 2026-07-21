export const HISTORY_LIMIT = 80;

export const createEditorTimeline = () => ({
  past: [],
  present: null,
  future: [],
  presentId: 0,
  savedId: null,
  baseRevision: null
});

export const editorTimelineReducer = (state, action) => {
  switch (action.type) {
    case 'load': {
      return {
        past: [],
        present: action.flow,
        future: [],
        presentId: 1,
        savedId: action.dirty ? null : 1,
        baseRevision: action.baseRevision || action.flow?.revision || null
      };
    }
    case 'commit': {
      if (!state.present || action.flow === state.present) return state;
      const nextId = state.presentId + 1;
      return {
        ...state,
        past: [...state.past, { flow: state.present, id: state.presentId }].slice(-HISTORY_LIMIT),
        present: action.flow,
        future: [],
        presentId: nextId
      };
    }
    case 'replace': {
      if (!state.present || action.flow === state.present) return state;
      return { ...state, present: action.flow, presentId: state.presentId + 1 };
    }
    case 'undo': {
      const previous = state.past[state.past.length - 1];
      if (!previous) return state;
      return {
        ...state,
        past: state.past.slice(0, -1),
        present: previous.flow,
        presentId: previous.id,
        future: [{ flow: state.present, id: state.presentId }, ...state.future]
      };
    }
    case 'redo': {
      const next = state.future[0];
      if (!next) return state;
      return {
        ...state,
        past: [...state.past, { flow: state.present, id: state.presentId }].slice(-HISTORY_LIMIT),
        present: next.flow,
        presentId: next.id,
        future: state.future.slice(1)
      };
    }
    case 'saved': {
      const nextId = state.presentId + 1;
      return {
        ...state,
        past: action.keepHistory === false
          ? []
          : [...state.past, { flow: state.present, id: state.presentId }].slice(-HISTORY_LIMIT),
        present: action.flow,
        future: [],
        presentId: nextId,
        savedId: nextId,
        baseRevision: action.flow.revision
      };
    }
    default:
      return state;
  }
};

export const isTimelineDirty = (timeline) => Boolean(timeline.present && timeline.presentId !== timeline.savedId);
