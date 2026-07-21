import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createEditorTimeline, editorTimelineReducer, isTimelineDirty } from './history';
import { IncrementalFlowValidator } from './validation';

export const useFlowEditor = () => {
  const [timeline, dispatchTimeline] = useReducer(editorTimelineReducer, undefined, createEditorTimeline);
  const validatorRef = useRef(new IncrementalFlowValidator());
  const [validation, setValidation] = useState({ issues: [], mode: 'full', validatedEntityCount: 0 });

  const load = useCallback((flow, options = {}) => {
    dispatchTimeline({
      type: 'load',
      flow,
      baseRevision: options.baseRevision || flow?.revision,
      dirty: Boolean(options.dirty)
    });
    setValidation(validatorRef.current.validateFull(flow));
  }, []);

  const commit = useCallback((flow, dirty = {}) => {
    dispatchTimeline({ type: 'commit', flow });
    setValidation(validatorRef.current.validate(flow, dirty));
  }, []);

  const replace = useCallback((flow, dirty = {}) => {
    dispatchTimeline({ type: 'replace', flow });
    setValidation(validatorRef.current.validate(flow, dirty));
  }, []);

  const undo = useCallback(() => {
    dispatchTimeline({ type: 'undo' });
  }, []);

  const redo = useCallback(() => {
    dispatchTimeline({ type: 'redo' });
  }, []);

  const markSaved = useCallback((flow, options = {}) => {
    dispatchTimeline({ type: 'saved', flow, keepHistory: options.keepHistory });
    setValidation(validatorRef.current.validateFull(flow));
  }, []);

  const fullValidate = useCallback(() => {
    const result = validatorRef.current.validateFull(timeline.present);
    setValidation(result);
    return result;
  }, [timeline.present]);

  useEffect(() => {
    if (timeline.present && validatorRef.current.lastFlow !== timeline.present) {
      setValidation(validatorRef.current.validateFull(timeline.present));
    }
  }, [timeline.present]);

  const dirty = isTimelineDirty(timeline);

  return useMemo(() => ({
    flow: timeline.present,
    baseRevision: timeline.baseRevision,
    canUndo: timeline.past.length > 0,
    canRedo: timeline.future.length > 0,
    dirty,
    validation,
    load,
    commit,
    replace,
    undo,
    redo,
    markSaved,
    fullValidate
  }), [timeline, dirty, validation, load, commit, replace, undo, redo, markSaved, fullValidate]);
};
