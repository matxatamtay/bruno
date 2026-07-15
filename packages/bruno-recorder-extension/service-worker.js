const DEBUGGER_VERSION = '1.3';
const MAX_REQUEST_BODY_CHARS = 512 * 1024;
const MAX_RESPONSE_BODY_BYTES = 2 * 1024 * 1024;
const TEXT_MIME = /json|text|xml|javascript|graphql|x-www-form-urlencoded|html|css/i;

const state = {
  token: '',
  port: 6174,
  sessionId: null,
  activeTabId: null,
  queue: [],
  flushTimer: null,
  responses: new Map(),
  requests: new Map(),
  pendingScreenshotActionId: null,
  screenshotTimer: null,
  lastScreenshotAt: 0
};

const debuggerTarget = () => ({ tabId: state.activeTabId });
const bridgeUrl = (pathname) => `http://127.0.0.1:${state.port}${pathname}`;

const callChrome = (fn, ...args) => new Promise((resolve, reject) => {
  fn(...args, (result) => {
    const error = chrome.runtime.lastError;
    if (error) reject(new Error(error.message));
    else resolve(result);
  });
});

const debuggerCommand = (method, params = {}) => callChrome(chrome.debugger.sendCommand, debuggerTarget(), method, params);

const fetchBridge = async (pathname, options = {}) => {
  const response = await fetch(bridgeUrl(pathname), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.token}`,
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Bruno Recorder returned HTTP ${response.status}`);
  return payload;
};

const makeId = () => `${Date.now().toString(36)}-${crypto.randomUUID()}`;

const queueEvent = (event) => {
  if (!state.sessionId) return;
  state.queue.push({
    id: event.id || makeId(),
    timestamp: event.timestamp || Date.now(),
    tabId: state.activeTabId,
    ...event
  });
  if (state.queue.length >= 20) flushEvents();
  else if (!state.flushTimer) state.flushTimer = setTimeout(flushEvents, 250);
};

const flushEvents = async () => {
  clearTimeout(state.flushTimer);
  state.flushTimer = null;
  if (!state.queue.length || !state.sessionId || !state.token) return;
  const events = state.queue.splice(0, 100);
  try {
    await fetchBridge('/v1/events', {
      method: 'POST',
      body: JSON.stringify({ sessionId: state.sessionId, events })
    });
  } catch (error) {
    state.queue.unshift(...events);
    state.queue = state.queue.slice(0, 1000);
    console.warn('Bruno Recorder flush failed:', error.message);
  }
  if (state.queue.length) state.flushTimer = setTimeout(flushEvents, 1000);
};

const captureScreenshot = async (actionId) => {
  if (!state.activeTabId || !state.sessionId) return;
  const now = Date.now();
  if (now - state.lastScreenshotAt < 600) {
    state.pendingScreenshotActionId = actionId;
    clearTimeout(state.screenshotTimer);
    state.screenshotTimer = setTimeout(() => captureScreenshot(state.pendingScreenshotActionId), 650);
    return;
  }
  state.lastScreenshotAt = now;
  try {
    const result = await debuggerCommand('Page.captureScreenshot', {
      format: 'jpeg',
      quality: 62,
      fromSurface: true,
      captureBeyondViewport: false
    });
    queueEvent({
      type: 'screenshot',
      actionId,
      data: { base64: result.data, mimeType: 'image/jpeg' }
    });
  } catch (error) {
    queueEvent({ type: 'recorder', actionId, data: { level: 'warning', message: `Screenshot failed: ${error.message}` } });
  }
};

const notifyContentScript = async (tabId, message) => {
  try {
    await callChrome(chrome.tabs.sendMessage, tabId, message);
  } catch {
    try {
      await callChrome(chrome.scripting.executeScript, { target: { tabId, allFrames: true }, files: ['content-script.js'] });
      await callChrome(chrome.tabs.sendMessage, tabId, message);
    } catch (error) {
      queueEvent({ type: 'recorder', data: { level: 'warning', message: `Page action capture unavailable: ${error.message}` } });
    }
  }
};

const startRecording = async ({ tabId, port, token }) => {
  if (state.activeTabId && state.activeTabId !== tabId) await stopRecording('Switched tabs');
  const wasAlreadyRecordingTab = state.activeTabId === tabId && Boolean(state.sessionId);
  state.port = Number(port) || 6174;
  state.token = String(token || '').trim();
  if (!state.token) throw new Error('Paste the pairing token from Bruno');

  const status = await fetchBridge('/v1/status');
  if (!status.session || status.session.status !== 'recording') {
    throw new Error('Start a recording session inside Bruno first');
  }
  state.sessionId = status.session.id;
  state.activeTabId = tabId;
  await chrome.storage.local.set({ brunoRecorderPort: state.port, brunoRecorderToken: state.token });

  let attachedNow = false;
  try {
    try {
      await callChrome(chrome.debugger.attach, debuggerTarget(), DEBUGGER_VERSION);
      attachedNow = true;
    } catch (error) {
      if (!wasAlreadyRecordingTab || !/already attached/i.test(error.message)) throw error;
    }

    await Promise.all([
      debuggerCommand('Network.enable', { maxPostDataSize: MAX_REQUEST_BODY_CHARS }),
      debuggerCommand('Page.enable'),
      debuggerCommand('Runtime.enable'),
      debuggerCommand('Log.enable')
    ]);

    await notifyContentScript(tabId, { type: 'BRUNO_RECORDER_START', sessionId: state.sessionId });
    const tab = await callChrome(chrome.tabs.get, tabId);
    queueEvent({
      type: 'recorder',
      data: { level: 'info', message: 'Chrome tab attached', title: tab.title, url: tab.url }
    });
    queueEvent({ type: 'navigation', data: { url: tab.url, title: tab.title, transition: 'attach' } });
    captureScreenshot(null);
    return { recording: true, sessionId: state.sessionId, tabId };
  } catch (error) {
    if (attachedNow) await callChrome(chrome.debugger.detach, { tabId }).catch(() => {});
    state.activeTabId = null;
    state.sessionId = null;
    state.requests.clear();
    state.responses.clear();
    throw error;
  }
};

const stopRecording = async (reason = 'Stopped from extension') => {
  const tabId = state.activeTabId;
  if (tabId) {
    queueEvent({ type: 'recorder', data: { level: 'info', message: reason } });
    await notifyContentScript(tabId, { type: 'BRUNO_RECORDER_STOP' }).catch(() => {});
    await flushEvents();
    await callChrome(chrome.debugger.detach, { tabId }).catch(() => {});
  }
  state.activeTabId = null;
  state.sessionId = null;
  state.requests.clear();
  state.responses.clear();
  return { recording: false };
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'BRUNO_RECORDER_EVENT') {
    if (sender.tab?.id !== state.activeTabId) return false;
    const event = {
      ...message.event,
      frameId: sender.frameId,
      data: {
        ...(message.event?.data || {}),
        frameUrl: sender.url || message.event?.data?.frameUrl || null
      }
    };
    queueEvent(event);
    if (event.type === 'action') captureScreenshot(event.id);
    return false;
  }

  if (message?.type === 'BRUNO_RECORDER_START_COMMAND') {
    startRecording(message).then(sendResponse).catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === 'BRUNO_RECORDER_STOP_COMMAND') {
    stopRecording().then(sendResponse).catch((error) => sendResponse({ error: error.message }));
    return true;
  }
  if (message?.type === 'BRUNO_RECORDER_STATUS_COMMAND') {
    sendResponse({ recording: Boolean(state.activeTabId), sessionId: state.sessionId, tabId: state.activeTabId });
    return false;
  }
  return false;
});

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  if (source.tabId !== state.activeTabId || !state.sessionId) return;
  try {
    if (method === 'Network.requestWillBeSent') {
      const request = params.request || {};
      state.requests.set(params.requestId, { startedAt: Date.now(), request });
      queueEvent({
        type: 'network-request',
        data: {
          requestId: params.requestId,
          loaderId: params.loaderId,
          documentURL: params.documentURL,
          url: request.url,
          method: request.method,
          headers: request.headers,
          body: request.postData ? request.postData.slice(0, MAX_REQUEST_BODY_CHARS) : null,
          resourceType: params.type,
          initiator: params.initiator,
          hasUserGesture: params.hasUserGesture,
          redirectResponse: params.redirectResponse || null
        }
      });
    } else if (method === 'Network.responseReceived') {
      state.responses.set(params.requestId, params.response || {});
    } else if (method === 'Network.loadingFinished') {
      const response = state.responses.get(params.requestId) || {};
      const requestMeta = state.requests.get(params.requestId) || {};
      let body = null;
      let base64Encoded = false;
      let bodyOmitted = null;
      if (params.encodedDataLength <= MAX_RESPONSE_BODY_BYTES && TEXT_MIME.test(response.mimeType || '')) {
        try {
          const result = await debuggerCommand('Network.getResponseBody', { requestId: params.requestId });
          body = result.body;
          base64Encoded = Boolean(result.base64Encoded);
        } catch (error) {
          bodyOmitted = error.message;
        }
      } else if (params.encodedDataLength > MAX_RESPONSE_BODY_BYTES) {
        bodyOmitted = `Response exceeds ${MAX_RESPONSE_BODY_BYTES} byte capture limit`;
      } else {
        bodyOmitted = 'Binary response body omitted';
      }
      queueEvent({
        type: 'network-response',
        data: {
          requestId: params.requestId,
          url: response.url || requestMeta.request?.url,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          mimeType: response.mimeType,
          protocol: response.protocol,
          remoteIPAddress: response.remoteIPAddress,
          encodedDataLength: params.encodedDataLength,
          duration: requestMeta.startedAt ? Date.now() - requestMeta.startedAt : null,
          body,
          base64Encoded,
          bodyOmitted
        }
      });
      state.responses.delete(params.requestId);
      state.requests.delete(params.requestId);
    } else if (method === 'Network.loadingFailed') {
      queueEvent({
        type: 'network-failed',
        data: {
          requestId: params.requestId,
          errorText: params.errorText,
          canceled: params.canceled,
          blockedReason: params.blockedReason,
          corsErrorStatus: params.corsErrorStatus
        }
      });
    } else if (method === 'Page.frameNavigated' && !params.frame?.parentId) {
      queueEvent({ type: 'navigation', frameId: params.frame.id, data: { url: params.frame.url, title: params.frame.name, transition: 'navigate' } });
      captureScreenshot(null);
    } else if (method === 'Page.navigatedWithinDocument') {
      queueEvent({ type: 'navigation', frameId: params.frameId, data: { url: params.url, transition: 'history' } });
      captureScreenshot(null);
    } else if (method === 'Runtime.exceptionThrown') {
      const details = params.exceptionDetails || {};
      queueEvent({
        type: 'console',
        data: {
          level: 'error',
          message: details.exception?.description || details.text || 'Unhandled JavaScript exception',
          url: details.url,
          lineNumber: details.lineNumber,
          columnNumber: details.columnNumber,
          stackTrace: details.stackTrace
        }
      });
      captureScreenshot(null);
    } else if (method === 'Log.entryAdded') {
      const entry = params.entry || {};
      queueEvent({
        type: 'console',
        data: {
          level: entry.level || 'log',
          message: entry.text,
          source: entry.source,
          url: entry.url,
          lineNumber: entry.lineNumber,
          stackTrace: entry.stackTrace
        }
      });
    }
  } catch (error) {
    console.warn('Bruno Recorder debugger event failed:', method, error);
  }
});

chrome.debugger.onDetach.addListener((source, reason) => {
  if (source.tabId !== state.activeTabId) return;
  queueEvent({ type: 'recorder', data: { level: 'error', message: `Chrome debugger detached: ${reason}` } });
  flushEvents();
  state.activeTabId = null;
  state.sessionId = null;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.activeTabId) stopRecording('Recorded tab was closed');
});
