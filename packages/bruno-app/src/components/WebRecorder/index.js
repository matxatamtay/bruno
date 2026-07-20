import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
  IconActivity,
  IconPlayerRecord,
  IconPlayerStop,
  IconDownload,
  IconUpload,
  IconCopy,
  IconFolder,
  IconPhoto,
  IconExternalLink,
  IconAlertTriangle,
  IconLock
} from '@tabler/icons';
import toast from 'react-hot-toast';
import { addTab } from 'providers/ReduxStore/slices/tabs';
import {
  recorderStateReceived,
  recorderSessionsLoaded,
  recorderSessionLoaded,
  selectRecorderSession,
  selectRecorderEvent,
  recorderErrorSet
} from 'providers/ReduxStore/slices/recorder';
import { findItemInCollection } from 'utils/collections';
import StyledWrapper from './StyledWrapper';
import ReplayStudioPanel from './ReplayStudioPanel';
import ContractsPanel from './ContractsPanel';
import CoveragePanel from './CoveragePanel';
import MockLabPanel from './MockLabPanel';
import TestDataPanel from './TestDataPanel';
import TracesPanel from './TracesPanel';
import { requestDescriptors } from './intelligence-utils';

const MODES = [
  ['recordings', 'Recordings'],
  ['scenarios', 'Replay'],
  ['contracts', 'Contracts'],
  ['coverage', 'Coverage'],
  ['mocks', 'Mock Lab'],
  ['test-data', 'Test Data'],
  ['traces', 'Traces']
];

const eventTitle = (event) => {
  const data = event?.data || {};
  if (event.type === 'action') {
    const target = data.target?.ariaLabel || data.target?.text || data.target?.name || data.target?.css || '';
    return `${data.kind || 'Action'}${target ? ` · ${target}` : ''}`;
  }
  if (event.type === 'network-request') return `${data.method || 'GET'} ${data.url || ''}`;
  if (event.type === 'network-response') return `${data.status || 'Response'} ${data.url || ''}`;
  if (event.type === 'network-failed') return `Network failed · ${data.errorText || 'Unknown error'}`;
  if (event.type === 'websocket-created') return `WS connect · ${data.url || data.requestId || ''}`;
  if (event.type === 'websocket-handshake') return `WS handshake ${data.direction === 'outgoing' ? '→' : '←'}${data.status ? ` · ${data.status}` : ''}`;
  if (event.type === 'websocket-frame') {
    const preview = String(data.payload || '').replace(/\s+/g, ' ').slice(0, 80);
    return `WS ${data.direction === 'outgoing' ? '→' : '←'}${preview ? ` · ${preview}` : ''}`;
  }
  if (event.type === 'websocket-closed') return `WS closed · ${data.requestId || ''}`;
  if (event.type === 'websocket-error') return `WS error · ${data.errorMessage || 'Unknown error'}`;
  if (event.type === 'console') return `${data.level || 'console'} · ${data.message || ''}`;
  if (event.type === 'navigation') return `Navigate · ${data.title || data.url || ''}`;
  return data.message || event.type;
};

const eventSubtitle = (event) => {
  const data = event?.data || {};
  if (event.type === 'action') return data.url;
  if (event.type === 'network-request') return data.resourceType || 'request';
  if (event.type === 'network-response') return `${data.duration || 0}ms · ${data.mimeType || 'unknown type'}`;
  if (event.type.startsWith('websocket-')) return `${data.requestId || 'socket'}${data.opcode != null ? ` · opcode ${data.opcode}` : ''}`;
  if (event.type === 'console') return data.url || data.source;
  return data.url || data.transition || '';
};

const BLOCKED_BY_CLIENT = /(?:net::)?ERR_BLOCKED_BY_CLIENT/i;

const isNoiseEvent = (event) => {
  if (!['console', 'network-failed'].includes(event?.type)) return false;
  const data = event.data || {};
  return BLOCKED_BY_CLIENT.test(`${data.message || ''} ${data.errorText || ''}`);
};

const isErrorEvent = (event) => !isNoiseEvent(event) && (event?.type === 'network-failed'
  || event?.type === 'websocket-error'
  || (event?.type === 'network-response' && Number(event.data?.status) >= 400)
  || (event?.type === 'console' && ['error', 'warning'].includes(event.data?.level))
  || (event?.type === 'recorder' && event.data?.level === 'error'));

const stringify = (value) => {
  if (value == null || value === '') return 'No data';
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  return JSON.stringify(value, null, 2);
};

const formatBytes = (value) => {
  const bytes = Number(value) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const recordedStateAt = (events, timestamp, url) => {
  let origin = null;
  try { origin = new URL(url).origin; } catch {}
  const snapshot = {
    origin,
    localStorage: {},
    sessionStorage: {},
    cookies: [],
    changes: []
  };
  for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    if (event.timestamp > timestamp) break;
    const data = event.data || {};
    let eventOrigin = data.origin || null;
    if (!eventOrigin && data.url) {
      try { eventOrigin = new URL(data.url).origin; } catch {}
    }
    if (origin && eventOrigin && eventOrigin !== origin) continue;
    if (event.type === 'storage-checkpoint') {
      snapshot.localStorage = { ...(data.localStorage?.values || data.localStorage || {}) };
      snapshot.sessionStorage = { ...(data.sessionStorage?.values || data.sessionStorage || {}) };
      snapshot.truncated = Boolean(data.localStorage?.truncated || data.sessionStorage?.truncated);
    } else if (event.type === 'storage-change') {
      const target = data.storageType === 'sessionStorage' ? snapshot.sessionStorage : snapshot.localStorage;
      if (data.operation === 'cleared') {
        if (data.storageType === 'sessionStorage') snapshot.sessionStorage = {};
        else snapshot.localStorage = {};
      } else if (data.operation === 'removed') {
        delete target[data.key];
      } else if (data.key) {
        target[data.key] = data.newValue;
      }
      snapshot.changes.push({
        timestamp: event.timestamp,
        storageType: data.storageType,
        operation: data.operation,
        key: data.key,
        value: data.newValue
      });
    } else if (event.type === 'cookie-checkpoint') {
      snapshot.cookies = data.cookies || [];
    }
  }
  return snapshot;
};

const WebRecorder = ({ collection, initialScenarioId = null, initialMode = null }) => {
  const dispatch = useDispatch();
  const recorder = useSelector((state) => state.recorder);
  const [isBusy, setIsBusy] = useState(false);
  const [extensionPath, setExtensionPath] = useState('');
  const [assetUrl, setAssetUrl] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [showNoiseEvents, setShowNoiseEvents] = useState(false);
  const [studioMode, setStudioMode] = useState(initialScenarioId ? 'scenarios' : initialMode || 'recordings');

  useEffect(() => {
    if (initialScenarioId) setStudioMode('scenarios');
    else if (initialMode) setStudioMode(initialMode);
  }, [initialScenarioId, initialMode]);

  const selectedSessionId = recorder.selectedSessionId || recorder.activeSession?.id;
  const events = recorder.eventsBySession[selectedSessionId] || [];
  const hiddenNoiseCount = useMemo(() => events.filter(isNoiseEvent).length, [events]);
  const timelineEvents = useMemo(() => events.filter((event) => event.type !== 'screenshot'
    && (showNoiseEvents || !isNoiseEvent(event))), [events, showNoiseEvents]);
  const selectedEvent = timelineEvents.find((event) => event.id === recorder.selectedEventId)
    || timelineEvents[timelineEvents.length - 1]
    || null;
  const selectedSession = recorder.activeSession?.id === selectedSessionId
    ? recorder.activeSession
    : recorder.sessions.find((session) => session.id === selectedSessionId);

  const requestEvent = useMemo(() => {
    if (!selectedEvent) return null;
    if (selectedEvent.type === 'network-request') return selectedEvent;
    const requestId = selectedEvent.data?.requestId;
    if (requestId) return events.find((event) => event.type === 'network-request' && event.data?.requestId === requestId) || null;
    return events.find((event) => event.type === 'network-request' && event.actionId === selectedEvent.id) || null;
  }, [selectedEvent, events]);

  const requestExtraEvent = useMemo(() => {
    const requestId = selectedEvent?.data?.requestId || requestEvent?.data?.requestId;
    if (!requestId) return null;
    return events.find((event) => event.type === 'network-request-extra' && event.data?.requestId === requestId) || null;
  }, [events, requestEvent, selectedEvent]);
  const requestHeaders = useMemo(() => ({
    ...(requestEvent?.data?.headers || {}),
    ...(requestExtraEvent?.data?.headers || {})
  }), [requestEvent, requestExtraEvent]);

  const responseEvent = useMemo(() => {
    if (!selectedEvent) return null;
    if (selectedEvent.type === 'network-response') return selectedEvent;
    const requestId = selectedEvent.data?.requestId || requestEvent?.data?.requestId;
    if (requestId) return events.find((event) => event.type === 'network-response' && event.data?.requestId === requestId) || null;
    return events.find((event) => event.type === 'network-response' && event.actionId === selectedEvent.id) || null;
  }, [selectedEvent, requestEvent, events]);

  const socketEvents = useMemo(() => {
    const requestId = selectedEvent?.data?.requestId;
    if (!requestId || !selectedEvent?.type?.startsWith('websocket-')) return [];
    return events.filter((event) => event.type?.startsWith('websocket-') && event.data?.requestId === requestId);
  }, [events, selectedEvent]);

  const selectedState = useMemo(() => recordedStateAt(
    events,
    selectedEvent?.timestamp || Date.now(),
    selectedEvent?.data?.url || requestEvent?.data?.url || selectedEvent?.data?.frameUrl
  ), [events, requestEvent, selectedEvent]);

  const screenshotEvent = useMemo(() => {
    if (!selectedEvent) return null;
    const exact = events.find((event) => event.type === 'screenshot' && event.actionId === selectedEvent.id);
    if (exact) return exact;
    return events.find((event) => event.type === 'screenshot'
      && event.timestamp >= selectedEvent.timestamp
      && event.timestamp - selectedEvent.timestamp < 2000) || null;
  }, [events, selectedEvent]);

  const match = selectedEvent?.data?.match || requestEvent?.data?.match || responseEvent?.data?.match || null;
  const relatedEventsByActionId = useMemo(() => {
    const groups = new Map();
    for (const event of events) {
      if (!event.actionId) continue;
      const group = groups.get(event.actionId) || [];
      group.push(event);
      groups.set(event.actionId, group);
    }
    return groups;
  }, [events]);
  const hasEventError = (event) => isErrorEvent(event)
    || (event?.type === 'action' && (relatedEventsByActionId.get(event.id) || []).some(isErrorEvent));
  const isRecording = recorder.activeSession?.status === 'recording';

  const refreshSessions = async () => {
    const sessions = await window.ipcRenderer.invoke('renderer:recorder:list-sessions');
    dispatch(recorderSessionsLoaded(sessions));
  };

  useEffect(() => {
    let active = true;
    Promise.all([
      window.ipcRenderer.invoke('renderer:recorder:get-state'),
      window.ipcRenderer.invoke('renderer:recorder:list-sessions'),
      window.ipcRenderer.invoke('renderer:recorder:get-extension-path')
    ]).then(([state, sessions, extension]) => {
      if (!active) return;
      dispatch(recorderStateReceived(state));
      dispatch(recorderSessionsLoaded(sessions));
      setExtensionPath(extension?.path || '');
    }).catch((error) => dispatch(recorderErrorSet(error.message)));
    return () => { active = false; };
  }, [dispatch]);

  useEffect(() => {
    if (!selectedEvent?.id || recorder.selectedEventId === selectedEvent.id) return;
    dispatch(selectRecorderEvent(selectedEvent.id));
  }, [dispatch, recorder.selectedEventId, selectedEvent?.id]);

  useEffect(() => {
    let active = true;
    setAssetUrl(null);
    if (!screenshotEvent?.data?.screenshotPath || !selectedSessionId) return () => { active = false; };
    window.ipcRenderer.invoke(
      'renderer:recorder:get-asset',
      selectedSessionId,
      screenshotEvent.data.screenshotPath
    ).then((url) => {
      if (active) setAssetUrl(url);
    }).catch(() => {});
    return () => { active = false; };
  }, [screenshotEvent?.id, screenshotEvent?.data?.screenshotPath, selectedSessionId]);

  const startRecording = async () => {
    setIsBusy(true);
    try {
      const state = await window.ipcRenderer.invoke('renderer:recorder:start', {
        name: `${collection.name} · ${new Date().toLocaleString()}`,
        collection: { uid: collection.uid, name: collection.name, pathname: collection.pathname },
        requests: requestDescriptors(collection).filter((request) => request.url)
      });
      dispatch(recorderStateReceived(state));
      dispatch(selectRecorderSession(state.activeSession?.id));
      toast.success('Recorder ready. Attach the Chrome extension to a tab.');
      await refreshSessions();
    } catch (error) {
      toast.error(error.message || 'Unable to start recorder');
    } finally {
      setIsBusy(false);
    }
  };

  const stopRecording = async () => {
    setIsBusy(true);
    try {
      const state = await window.ipcRenderer.invoke('renderer:recorder:stop', recorder.activeSession?.id);
      dispatch(recorderStateReceived(state));
      toast.success('Recording stopped');
      await refreshSessions();
    } catch (error) {
      toast.error(error.message || 'Unable to stop recorder');
    } finally {
      setIsBusy(false);
    }
  };

  const loadSession = async (sessionId) => {
    if (!sessionId) return;
    dispatch(selectRecorderSession(sessionId));
    if (recorder.eventsBySession[sessionId]) return;
    try {
      const session = await window.ipcRenderer.invoke('renderer:recorder:load-session', sessionId);
      dispatch(recorderSessionLoaded(session));
    } catch (error) {
      toast.error(error.message || 'Unable to load recording');
    }
  };

  const exportSession = async (includeSecrets = false) => {
    if (!selectedSessionId) return;
    let passphrase;
    if (includeSecrets) {
      passphrase = window.prompt('Passphrase for encrypted tokens/cookies (minimum 8 characters)');
      if (passphrase == null) return;
      if (passphrase.length < 8) return toast.error('Passphrase must be at least 8 characters');
    }
    try {
      const result = await window.ipcRenderer.invoke('renderer:recorder:export', {
        sessionId: selectedSessionId,
        includeSecrets,
        passphrase
      });
      if (!result?.canceled) {
        toast.success(`Run exported · ${formatBytes(result.bytes)}${result.secrets?.encrypted ? ' · encrypted secrets included' : ''}`);
      }
    } catch (error) {
      toast.error(error.message || 'Unable to export run');
    }
  };

  const importSession = async () => {
    try {
      const result = await window.ipcRenderer.invoke('renderer:recorder:import');
      if (result?.canceled) return;
      if (result.session?.manifest?.secrets?.encrypted) {
        const passphrase = window.prompt(
          'This run includes encrypted tokens/cookies. Enter the passphrase to unlock them, or Cancel to import safely without secrets.'
        );
        if (passphrase) {
          try {
            const unlocked = await window.ipcRenderer.invoke('renderer:recorder:unlock-secrets', {
              sessionId: result.session.manifest.id,
              passphrase
            });
            result.session.manifest.secrets = { ...result.session.manifest.secrets, unlocked: true, recordCount: unlocked.recordCount };
          } catch (error) {
            toast.error(error.message || 'Unable to unlock run secrets');
          }
        }
      }
      dispatch(recorderSessionLoaded(result.session));
      toast.success(`Run imported · ${formatBytes(result.session?.manifest?.storage?.totalBytes)}`);
      await refreshSessions();
    } catch (error) {
      toast.error(error.message || 'Unable to import recording');
    }
  };

  const copyPairing = async () => {
    const text = JSON.stringify({ port: recorder.bridge.port, token: recorder.bridge.token });
    await navigator.clipboard.writeText(text);
    toast.success('Pairing details copied');
  };

  const openMatchedRequest = () => {
    if (!match?.itemUid) return;
    const item = findItemInCollection(collection, match.itemUid);
    if (!item) return toast.error('Matched request is not present in this collection');
    dispatch(addTab({
      uid: item.uid,
      collectionUid: collection.uid,
      type: item.type,
      pathname: item.pathname,
      preview: false
    }));
  };

  const storage = selectedSession?.storage || {};
  const deduplicatedBytes = Number(storage.payloadDeduplicatedBytes || 0) + Number(storage.screenshotDeduplicatedBytes || 0);
  const omittedBytes = Number(storage.payloadOmittedBytes || 0) + Number(storage.screenshotOmittedBytes || 0);
  return (
    <StyledWrapper>
      <div className="recorder-header">
        <div className="title-block">
          <IconActivity size={20} strokeWidth={1.5} />
          <div className="title-copy">
            <strong>Intelligence Suite</strong>
            <span>{collection.name} · contracts, coverage, replay, mocks, test data and time-travel debugging</span>
          </div>
        </div>
        <div className="studio-mode-tabs">
          {MODES.map(([key, label]) => <button key={key} className={studioMode === key ? 'active' : ''} onClick={() => setStudioMode(key)}>{label}</button>)}
        </div>
        <div className="header-actions">
          {['recordings', 'scenarios'].includes(studioMode) && (
            <>
              <select className="session-select" value={selectedSessionId || ''} onChange={(event) => loadSession(event.target.value)}>
                <option value="">No recording selected</option>
                {recorder.sessions.map((session) => (
                  <option key={session.id} value={session.id}>{session.name} · {session.status} · {formatBytes(session.storage?.totalBytes)}</option>
                ))}
              </select>
              <button className="button" onClick={importSession}><IconUpload size={14} /> Import</button>
              <button className="button" disabled={!selectedSessionId} onClick={() => exportSession(false)}><IconDownload size={14} /> Export</button>
              <button className="button" disabled={!selectedSessionId} onClick={() => exportSession(true)} title="Include passphrase-encrypted tokens and cookies"><IconLock size={14} /> Export + secrets</button>
              {!isRecording ? (
                <button className="button primary" disabled={isBusy} onClick={startRecording}><IconPlayerRecord size={14} /> Start</button>
              ) : (
                <button className="button danger" disabled={isBusy} onClick={stopRecording}><IconPlayerStop size={14} /> Stop</button>
              )}
            </>
          )}
        </div>
      </div>

      {studioMode === 'scenarios' && <ReplayStudioPanel collection={collection} selectedSessionId={selectedSessionId} initialScenarioId={initialScenarioId} />}
      {studioMode === 'contracts' && <ContractsPanel collection={collection} />}
      {studioMode === 'coverage' && <CoveragePanel collection={collection} />}
      {studioMode === 'mocks' && <MockLabPanel collection={collection} />}
      {studioMode === 'test-data' && <TestDataPanel collection={collection} />}
      {studioMode === 'traces' && <TracesPanel collection={collection} />}
      {studioMode === 'recordings' && (
        <>
          <div className="pairing-bar">
            <div className="pairing-row">
              <span className="pairing-help">Chrome extension:</span>
              <code>{extensionPath || 'Loading extension path…'}</code>
              <button className="button" onClick={() => window.ipcRenderer.invoke('renderer:recorder:reveal-extension')}><IconFolder size={13} /> Reveal</button>
            </div>
            <div className="pairing-row">
              <span>Port <code>{recorder.bridge.port || '…'}</code></span>
              <span>Token <code className="pairing-token">{recorder.bridge.token || '…'}</code></span>
              <button className="button" disabled={!recorder.bridge.token} onClick={copyPairing}><IconCopy size={13} /> Copy</button>
            </div>
            {selectedSessionId && (
              <div className="run-storage-summary" title="Estimated uncompressed data stored in this run">
                <strong>{formatBytes(storage.totalBytes)}</strong>
                <span>events {formatBytes(storage.eventsBytes)}</span>
                <span>payload {formatBytes(storage.payloadBytes)}</span>
                <span>screens {formatBytes(storage.screenshotBytes)}</span>
                {deduplicatedBytes > 0 && <span>saved {formatBytes(deduplicatedBytes)}</span>}
                {omittedBytes > 0 && <span>trimmed {formatBytes(omittedBytes)}</span>}
              </div>
            )}
          </div>

          <div className="recorder-grid">
            <section className="timeline-column">
              <div className="column-title">
                <span>Steps</span>
                <div className="column-title-actions">
                  {hiddenNoiseCount > 0 && (
                    <button className="noise-toggle" onClick={() => setShowNoiseEvents((current) => !current)}>
                      {showNoiseEvents ? 'Hide blocked noise' : `${hiddenNoiseCount} blocked hidden`}
                    </button>
                  )}
                  <small>{timelineEvents.length} events</small>
                </div>
              </div>
              {timelineEvents.length ? (
                <div className="timeline-list">
                  {timelineEvents.map((event, index) => (
                    <button
                      key={event.id}
                      className={`timeline-row ${event.id === selectedEvent?.id ? 'selected' : ''} ${hasEventError(event) ? 'error' : ''}`}
                      onClick={() => dispatch(selectRecorderEvent(event.id))}
                    >
                      <span className="step-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="step-copy">
                        <span className={`step-badge ${hasEventError(event) ? 'error' : ''}`}>{event.type}</span>
                        <strong>{eventTitle(event)}</strong>
                        <span>{eventSubtitle(event)}</span>
                      </span>
                      <span className="step-time">{new Date(event.timestamp).toLocaleTimeString()}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="empty-state">
                  <IconPlayerRecord size={36} strokeWidth={1} />
                  <strong>No recorded steps yet</strong>
                  <span>Start here, then paste the pairing token into the unpacked Chrome extension and attach it to the web page.</span>
                </div>
              )}
            </section>

            <section className="viewport-column">
              <div className="column-title"><span>Page at this step</span><small>{selectedEvent ? eventTitle(selectedEvent) : 'No step selected'}</small></div>
              <div className="viewport-stage">
                {assetUrl ? <img className="screenshot" src={assetUrl} alt="Recorded browser step" /> : (
                  <div className="empty-state">
                    <IconPhoto size={42} strokeWidth={1} />
                    <strong>{selectedEvent ? 'No screenshot linked to this step' : 'Select a step'}</strong>
                    <span>Screenshots are captured after actions, navigation and runtime errors while the extension remains attached.</span>
                  </div>
                )}
              </div>
            </section>

            <section className="details-column">
              <div className="column-title"><span>Step details</span>{hasEventError(selectedEvent) && <IconAlertTriangle size={14} />}</div>
              <div className="detail-tabs">
                {['overview', 'request', 'response', 'socket', 'state', 'raw'].map((tab) => (
                  <button key={tab} className={`detail-tab ${detailTab === tab ? 'active' : ''}`} onClick={() => setDetailTab(tab)}>{tab}</button>
                ))}
              </div>
              <div className="details-scroll">
                {!selectedEvent ? <div className="empty-state"><strong>No step selected</strong></div> : null}

                {selectedEvent && detailTab === 'overview' && (
                  <>
                    <div className="detail-section">
                      <h4>Step</h4>
                      <div className="status-line"><span className="step-badge">{selectedEvent.type}</span><strong>{eventTitle(selectedEvent)}</strong></div>
                      <div className="url">{selectedEvent.data?.url || selectedEvent.data?.frameUrl || ''}</div>
                    </div>
                    {match && (
                      <div className="detail-section match-card">
                        <strong>{match.confidence === 'exact' ? 'Matched request' : 'Probable request'} · {match.name || match.pathname}</strong>
                        <span>{match.method} {match.url} · score {match.score}</span>
                        <button className="button" onClick={openMatchedRequest}><IconExternalLink size={13} /> Open in Bruno</button>
                      </div>
                    )}
                    <div className="detail-section"><h4>Captured data</h4><pre>{stringify(selectedEvent.data)}</pre></div>
                  </>
                )}

                {selectedEvent && detailTab === 'request' && (
                  requestEvent ? (
                    <>
                      <div className="detail-section"><h4>Request</h4><div className="status-line"><strong>{requestEvent.data?.method}</strong><span className="url">{requestEvent.data?.url}</span></div></div>
                      <div className="detail-section"><h4>Headers</h4><pre>{stringify(requestHeaders)}</pre></div>
                      <div className="detail-section"><h4>Body</h4><pre>{stringify(requestEvent.data?.body)}</pre></div>
                    </>
                  ) : <div className="empty-state"><strong>No request linked to this step</strong></div>
                )}

                {selectedEvent && detailTab === 'response' && (
                  responseEvent ? (
                    <>
                      <div className="detail-section"><h4>Response</h4><div className="status-line"><span className={`status-code ${Number(responseEvent.data?.status) >= 400 ? 'error' : ''}`}>{responseEvent.data?.status}</span><span>{responseEvent.data?.duration}ms</span></div><div className="url">{responseEvent.data?.url}</div></div>
                      <div className="detail-section"><h4>Headers</h4><pre>{stringify(responseEvent.data?.headers)}</pre></div>
                      <div className="detail-section"><h4>Body</h4><pre>{stringify(responseEvent.data?.body || responseEvent.data?.bodyOmitted)}</pre></div>
                    </>
                  ) : <div className="empty-state"><strong>No response linked to this step</strong></div>
                )}

                {selectedEvent && detailTab === 'socket' && (
                  socketEvents.length ? (
                    <>
                      <div className="detail-section"><h4>Connection</h4><div className="status-line"><strong>{selectedEvent.data?.requestId}</strong><span>{socketEvents.length} events</span></div></div>
                      {socketEvents.map((event) => (
                        <div className="detail-section" key={event.id}>
                          <h4>{eventTitle(event)}</h4>
                          {event.data?.headers && <pre>{stringify(event.data.headers)}</pre>}
                          {event.data?.payload != null && <pre>{stringify(event.data.payload)}</pre>}
                          {event.data?.errorMessage && <pre>{event.data.errorMessage}</pre>}
                        </div>
                      ))}
                    </>
                  ) : <div className="empty-state"><strong>No socket connection selected</strong></div>
                )}

                {selectedEvent && detailTab === 'state' && (
                  <>
                    <div className="detail-section"><h4>Local storage</h4><pre>{stringify(selectedState.localStorage)}</pre></div>
                    <div className="detail-section"><h4>Session storage</h4><pre>{stringify(selectedState.sessionStorage)}</pre></div>
                    <div className="detail-section"><h4>Cookies</h4><pre>{stringify(selectedState.cookies)}</pre></div>
                    <div className="detail-section"><h4>Changes before this step</h4><pre>{stringify(selectedState.changes)}</pre></div>
                  </>
                )}

                {selectedEvent && detailTab === 'raw' && <pre>{stringify(selectedEvent)}</pre>}
              </div>
            </section>
          </div>
        </>
      )}
    </StyledWrapper>
  );
};

export default WebRecorder;
