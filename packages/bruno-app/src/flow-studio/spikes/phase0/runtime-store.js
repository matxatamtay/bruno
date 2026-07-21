import { useSyncExternalStore } from 'react';

const EMPTY_RUNTIME_STATE = Object.freeze({ status: 'idle', revision: 0 });
const createIdleState = () => ({ ...EMPTY_RUNTIME_STATE });

export const createNodeRuntimeStore = (nodeIds = []) => {
  const states = new Map(nodeIds.map((nodeId) => [nodeId, createIdleState()]));
  const listeners = new Map();

  const getSnapshot = (nodeId) => states.get(nodeId) || EMPTY_RUNTIME_STATE;

  const subscribe = (nodeId, listener) => {
    let nodeListeners = listeners.get(nodeId);
    if (!nodeListeners) {
      nodeListeners = new Set();
      listeners.set(nodeId, nodeListeners);
    }

    nodeListeners.add(listener);
    return () => {
      nodeListeners.delete(listener);
      if (!nodeListeners.size) {
        listeners.delete(nodeId);
      }
    };
  };

  const updateNode = (nodeId, patch) => {
    const previous = getSnapshot(nodeId);
    const next = Object.freeze({
      ...previous,
      ...patch,
      revision: previous.revision + 1
    });

    states.set(nodeId, next);
    listeners.get(nodeId)?.forEach((listener) => listener());
    return next;
  };

  return {
    getSnapshot,
    subscribe,
    updateNode,
    listenerCount: (nodeId) => listeners.get(nodeId)?.size || 0
  };
};

export const useNodeRuntimeState = (store, nodeId) => useSyncExternalStore(
  (listener) => store.subscribe(nodeId, listener),
  () => store.getSnapshot(nodeId),
  () => store.getSnapshot(nodeId)
);
