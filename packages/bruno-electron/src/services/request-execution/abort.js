const linkAbortSignal = (sourceSignal, targetController) => {
  if (!sourceSignal) return () => {};

  const abortTarget = () => {
    if (!targetController.signal.aborted) {
      targetController.abort(sourceSignal.reason);
    }
  };

  if (sourceSignal.aborted) {
    abortTarget();
    return () => {};
  }

  sourceSignal.addEventListener('abort', abortTarget, { once: true });
  return () => sourceSignal.removeEventListener('abort', abortTarget);
};

const delayWithSignal = (durationMs, signal) => {
  if (!durationMs || Number.isNaN(durationMs) || durationMs <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || new Error('Request execution cancelled'));
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, durationMs);

    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('Request execution cancelled'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
};

const attachDeferredStreamCleanup = (stream, cleanup) => {
  let cleanupScheduled = false;
  const scheduleCleanup = () => {
    if (cleanupScheduled) return;
    cleanupScheduled = true;
    queueMicrotask(cleanup);
  };

  stream.once('close', scheduleCleanup);
  stream.once('error', scheduleCleanup);
  return scheduleCleanup;
};

module.exports = {
  linkAbortSignal,
  delayWithSignal,
  attachDeferredStreamCleanup
};
