import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IconPlayerPlay, IconPlayerStop, IconRefresh, IconTrash } from '@tabler/icons';
import toast from 'react-hot-toast';
import { collectionIdentity, requestDescriptors } from './intelligence-utils';
import useIntelligenceEvents from './useIntelligenceEvents';

const PRESETS = [
  ['', 'Normal response'],
  ['status', 'Custom status'],
  ['auth-expired', 'Auth expired'],
  ['rate-limit', '429 rate limit'],
  ['invalid-json', 'Invalid JSON'],
  ['missing-field', 'Missing field'],
  ['wrong-type', 'Wrong type'],
  ['connection-reset', 'Connection reset'],
  ['timeout', 'Timeout'],
  ['partial-stream', 'Partial stream'],
  ['empty-list', 'Empty list'],
  ['large-response', 'Large response']
];

const MockLabPanel = ({ collection }) => {
  const [lab, setLab] = useState(null);
  const [state, setState] = useState({ running: false });
  const [logs, setLogs] = useState([]);
  const [busy, setBusy] = useState(false);
  const identity = useMemo(() => collectionIdentity(collection), [collection]);
  const requests = useMemo(() => requestDescriptors(collection), [collection.items]);

  const load = useCallback(async () => {
    const result = await window.ipcRenderer.invoke('renderer:api-intelligence:get-mock-lab', identity);
    setLab(result.lab);
    setState(result.state || { running: false });
    setLogs(await window.ipcRenderer.invoke('renderer:api-intelligence:get-mock-logs'));
  }, [identity]);

  useEffect(() => { load().catch((error) => toast.error(error.message)); }, [load]);
  useIntelligenceEvents(identity, ['mocks', 'contracts'], () => load().catch(() => {}));
  useEffect(() => {
    if (!state.running) return undefined;
    const timer = setInterval(async () => {
      setState(await window.ipcRenderer.invoke('renderer:api-intelligence:get-mock-state'));
      setLogs(await window.ipcRenderer.invoke('renderer:api-intelligence:get-mock-logs'));
    }, 1500);
    return () => clearInterval(timer);
  }, [state.running]);

  const save = async (next = lab) => {
    const saved = await window.ipcRenderer.invoke('renderer:api-intelligence:save-mock-lab', { collection: identity, lab: next });
    setLab(saved);
    return saved;
  };

  const syncRoutes = async () => {
    setBusy(true);
    try {
      setLab(await window.ipcRenderer.invoke('renderer:api-intelligence:sync-mock-routes', { collection: identity, requests }));
      toast.success('Mock routes synchronized from collection requests, examples and contracts');
    } finally { setBusy(false); }
  };

  const toggleServer = async () => {
    if (!state.running && lab.mode === 'proxy-override' && !window.confirm(`Proxy unmatched requests to ${lab.proxyBaseUrl || 'the configured upstream host'}? External traffic may include request data.`)) return;
    setBusy(true);
    try {
      const next = state.running
        ? await window.ipcRenderer.invoke('renderer:api-intelligence:stop-mock-lab')
        : await window.ipcRenderer.invoke('renderer:api-intelligence:start-mock-lab', identity);
      setState(next);
      toast.success(next.running ? `Mock Lab running at ${next.url}` : 'Mock Lab stopped');
    } catch (error) {
      toast.error(error.message || 'Unable to change Mock Lab state');
    } finally { setBusy(false); }
  };

  const updateRoute = async (route, patch) => {
    const nextRoute = { ...route, ...patch };
    const saved = await window.ipcRenderer.invoke('renderer:api-intelligence:upsert-mock-route', { collection: identity, route: nextRoute });
    setLab(saved);
  };

  const updatePreset = (route, type) => {
    const current = route.failurePreset || {};
    const preset = type ? {
      ...current,
      type,
      ...(type === 'status' ? { status: current.status || 500 } : {}),
      ...(type === 'missing-field' || type === 'wrong-type' ? { path: current.path || 'body.id' } : {}),
      ...(type === 'timeout' ? { timeoutMs: current.timeoutMs || 10000 } : {})
    } : null;
    updateRoute(route, { failurePreset: preset }).catch((error) => toast.error(error.message));
  };

  const removeRoute = async (routeId) => {
    setLab(await window.ipcRenderer.invoke('renderer:api-intelligence:delete-mock-route', { collection: identity, routeId }));
  };

  const reset = async () => {
    setState(await window.ipcRenderer.invoke('renderer:api-intelligence:reset-mock-state'));
    setLogs([]);
  };

  if (!lab) return <div className="empty-state"><strong>Loading Mock Lab…</strong></div>;

  return (
    <div className="intelligence-panel">
      <div className="intelligence-toolbar">
        <div><strong>Mock & Failure Lab</strong><span>Localhost-only deterministic routes, failure overlays and optional proxy passthrough.</span></div>
        <div className="intelligence-actions">
          <button className="button" disabled={busy} onClick={syncRoutes}><IconRefresh size={14} /> Sync routes</button>
          <button className="button" onClick={reset}>Reset state</button>
          <button className={`button ${state.running ? 'danger' : 'primary'}`} disabled={busy} onClick={toggleServer}>{state.running ? <IconPlayerStop size={14} /> : <IconPlayerPlay size={14} />}{state.running ? 'Stop' : 'Start'}</button>
        </div>
      </div>
      <div className="mock-state-bar">
        <strong>{state.running ? 'Running' : 'Stopped'}</strong><code>{state.url || '127.0.0.1 · random available port'}</code><span>{lab.routes?.length || 0} routes</span><span>{state.requestsServed || 0} served</span>
      </div>
      <div className="mock-settings">
        <label>
          Mode
          <select
            value={lab.mode || 'pure-mock'}
            onChange={(event) => {
              const next = { ...lab, mode: event.target.value };
              setLab(next);
              save(next);
            }}
          >
            <option value="pure-mock">Pure mock</option>
            <option value="proxy-override">Proxy + override</option>
          </select>
        </label>
        {lab.mode === 'proxy-override' && <label>Proxy base URL<input value={lab.proxyBaseUrl || ''} placeholder="https://api.example.com" onChange={(event) => setLab({ ...lab, proxyBaseUrl: event.target.value })} onBlur={() => save()} /></label>}
        {lab.mode === 'proxy-override' && (
          <label className="mock-checkbox">
            <input
              type="checkbox"
              checked={Boolean(lab.recordProxyResponses)}
              onChange={(event) => {
                const next = { ...lab, recordProxyResponses: event.target.checked };
                setLab(next);
                save(next);
              }}
            />
            Record sanitized proxy responses as local routes
          </label>
        )}
      </div>
      <div className="mock-route-list">
        {(lab.routes || []).map((route) => (
          <div className="mock-route" key={route.id}>
            <label><input type="checkbox" checked={route.enabled !== false} onChange={(event) => updateRoute(route, { enabled: event.target.checked })} /><strong>{route.method}</strong><code>{route.pathTemplate}</code></label>
            <span>{route.name}</span>
            <select value={route.failurePreset?.type || ''} onChange={(event) => updatePreset(route, event.target.value)}>{PRESETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            {route.failurePreset?.type === 'status' && <input type="number" min="100" max="599" value={route.failurePreset.status || 500} onChange={(event) => updateRoute(route, { failurePreset: { ...route.failurePreset, status: Number(event.target.value) } })} />}
            {['missing-field', 'wrong-type'].includes(route.failurePreset?.type) && <input value={route.failurePreset.path || ''} placeholder="body.id" onChange={(event) => updateRoute(route, { failurePreset: { ...route.failurePreset, path: event.target.value } })} />}
            <button className="button danger" onClick={() => removeRoute(route.id)}><IconTrash size={13} /></button>
          </div>
        ))}
        {!lab.routes?.length && <div className="empty-state"><strong>No mock routes</strong><span>Synchronize routes to generate local responses from response examples and accepted contracts.</span></div>}
      </div>
      <div className="mock-log">
        <div className="column-title"><span>Live traffic</span><button className="button" onClick={load}><IconRefresh size={13} /> Refresh</button></div>
        {logs.slice(0, 100).map((log) => <div key={log.id}><span>{new Date(log.timestamp).toLocaleTimeString()}</span><strong>{log.method} {log.path}</strong><code>{String(log.status)}</code><small>{log.matchedRouteName || (log.proxied ? 'proxy' : 'unmatched')} · {log.duration}ms</small></div>)}
        {!logs.length && <div className="empty-state"><strong>No traffic yet</strong></div>}
      </div>
    </div>
  );
};

export default MockLabPanel;
