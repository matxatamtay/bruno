import { useEffect, useRef } from 'react';

const useIntelligenceEvents = (collection, features, callback) => {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;
  const featureKey = [...(features || [])].sort().join(',');

  useEffect(() => {
    if (!window.ipcRenderer?.on) return undefined;
    const accepted = new Set(featureKey.split(',').filter(Boolean));
    const removeListener = window.ipcRenderer.on('main:api-intelligence-updated', (event) => {
      const sameCollection = !event?.collection
        || (collection?.uid && event.collection.uid === collection.uid)
        || (collection?.pathname && event.collection.pathname === collection.pathname);
      if (!sameCollection || (accepted.size && !accepted.has(event.feature))) return;
      callbackRef.current?.(event);
    });
    return () => removeListener?.();
  }, [collection?.uid, collection?.pathname, featureKey]);
};

export default useIntelligenceEvents;
