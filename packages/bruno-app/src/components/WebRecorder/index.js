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
  IconAlertTriangle
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
import { findItemInCollection, flattenItems } from 'utils/collections';
import StyledWrapper from './StyledWrapper';
import ReplayStudioPanel from './ReplayStudioPanel';

const REQUEST_TYPES = new Set(['http-request', 'graphql-request', 'grpc-request', 'ws-request']);

const buildRequestDescriptors = (collection) => flattenItems(collection?.items || [])
  .filter((item) => REQUEST_TYPES.has(item.type))
  .map((item) => {
    const source = item.draft || item;
    return {
      itemUid: item.uid,
      pathname: item.pathname,
      name: item.name,
      type: item.type,
      method: source.request?.method || (item.type === 'graphql-request' ? 'POST' : 'GET'),
      url: source.request?.url || ''
    };
  })
  .filter((item) => item.url);

const eventTitle = (event) => {
  const data = event?.data || {};
  if (event.type === 'action') {
    const target = data.target?.ariaLabel || data.target?.text || data.target?.name || data.target?.css || '';
    return `${data.kind || 'Action'}${target ? ` · ${target}` : ''}`;
  }
  if (event.type === 'network-request') return `${data.method || 'GET'} ${data.url || ''}`;
  if (event.type === 'network-response') return `${data.status || 'Response'} ${data.url || ''}`;
  if (event.type === 'network-failed') return `Network failed · ${data.errorText || 'Unknown error'}`;
  if (event.type === 'console') return `${data.level || 'console'} · ${data.message || ''}`;
  if (event.type === 'navigation') return `Navigate · ${data.title || data.url || ''}`;
  return data.message || event.type;
};

const eventSubtitle = (event) => {
  const data = event?.data || {};
  if (event.type === 'action') return data.url;
  if (event.type === 'network-request') return data.resourceType || 'request';
  if (event.type === 'network-response') return `${data.duration || 0}ms · ${data.mimeType || 'unknown type'}`;
  if (event.type === 'console') return data.url || data.source;
  return data.url || data.transition || '';
};

const isErrorEvent = (event) => event?.type === 'network-failed'
  || (event?.type === 'network-response' && Number(event.data?.status) >= 400)
  || (event?.type === 'console' && ['error', 'warning'].includes(event.data?.level))
  || (event?.type === 'recorder' && event.data?.level === 'error');

const stringify = (value) => {
  if (value == null || value === '') return 'No data';
  if (typeof value === 'string') {
    try { return JSON.stringify(JSON.parse(value), null, 2); } catch { return value; }
  }
  return JSON.stringify(value, null, 2);
};

const WebRecorder = ({ collection, initialScenarioId = null }) => {
  const dispatch = useDispatch();
  const recorder = useSelector((state) => state.recorder);
  const [isBusy, setIsBusy] = useState(false);
  const [extensionPath, setExtensionPath] = useState('');
  const [assetUrl, setAssetUrl] = useState(null);
  const [detailTab, setDetailTab] = useState('overview');
  const [studioMode, setStudioMode] = useState(initialScenarioId ? 'scenarios' : 'recordings');

  const selectedSessionId = recorder.selectedSessionId || recorder.activeSession?.id;
  const events = recorder.eventsBySession[selectedSessionId] || [];
  const timelineEvents = useMemo(() => events.filter((event) => event.type !== 'screenshot'), [events]);
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

  const responseEvent = useMemo(() => {
    if (!selectedEvent) return null;
    if (selectedEvent.type === 'network-response') return selectedEvent;
    const requestId = selectedEvent.data?.requestId || requestEvent?.data?.requestId;
    if (requestId) return events.find((event) => event.type === 'network-response' && event.data?.requestId === requestId) || null;
    return events.find((event) => event.type === 'network-response' && event.actionId === selectedEvent.id) || null;
  }, [selectedEvent, requestEvent, events]);

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
        requests: buildRequestDescriptors(collection)
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

  const exportSession = async () => {
    if (!selectedSessionId) return;
    const result = await window.ipcRenderer.invoke('renderer:recorder:export', selectedSessionId);
    if (!result?.canceled) toast.success('Recording exported');
  };

  const importSession = async () => {
    try {
      const result = await window.ipcRenderer.invoke('renderer:recorder:import');
      if (result?.canceled) return;
      dispatch(recorderSessionLoaded(result.session));
      toast.success('Recording imported');
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

  return (
    <StyledWrapper>
      <div className="recorder-header">
        <div className="title-block">
          <IconActivity size={20} strokeWidth={1.5} />
          <div className="title-copy">
            <strong>Replay Studio</strong>
            <span>{collection.name} · record, link, replay and compare API scenarios locally</span>
          </div>
        </div>
        <div className="studio-mode-tabs">
          <button className={studioMode === 'recordings' ? 'active' : ''} onClick={() => setStudioMode('recordings')}>Recordings</button>
          <button className={studioMode === 'scenarios' ? 'active' : ''} onClick={() => setStudioMode('scenarios')}>Scenarios</button>
        </div>
        <div className="header-actions">
          <select className="session-select" value={selectedSessionId || ''} onChange={(event) => loadSession(event.target.value)}>
            <option value="">No recording selected</option>
            {recorder.sessions.map((session) => (
              <option key={session.id} value={session.id}>{session.name} · {session.status}</option>
            ))}
          </select>
          <button className="button" onClick={importSession}><IconUpload size={14} /> Import</button>
          <button className="button" disabled={!selectedSessionId} onClick={exportSession}><IconDownload size={14} /> Export</button>
          {!isRecording ? (
            <button className="button primary" disabled={isBusy} onClick={startRecording}><IconPlayerRecord size={14} /> Start</button>
          ) : (
            <button className="button danger" disabled={isBusy} onClick={stopRecording}><IconPlayerStop size={14} /> Stop</button>
          )}
        </div>
      </div>

      {studioMode === 'scenarios' ? (
        <ReplayStudioPanel collection={collection} selectedSessionId={selectedSessionId} initialScenarioId={initialScenarioId} />
      ) : (
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
          </div>

          <div className="recorder-grid">
            <section className="timeline-column">
              <div className="column-title"><span>Steps</span><small>{timelineEvents.length} events</small></div>
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
                {['overview', 'request', 'response', 'raw'].map((tab) => (
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
                      <div className="detail-section"><h4>Headers</h4><pre>{stringify(requestEvent.data?.headers)}</pre></div>
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
