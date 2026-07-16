import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { IconAlertTriangle, IconCheck, IconDownload, IconExternalLink, IconFolder, IconPlayerPlay, IconRefresh, IconTrash, IconUpload } from '@tabler/icons';
import toast from 'react-hot-toast';
import { addTab } from 'providers/ReduxStore/slices/tabs';
import { runReplayScenario, selectEnvironment } from 'providers/ReduxStore/slices/collections/actions';
import { findItemInCollection } from 'utils/collections';
import ReplayDependencyGraph from './ReplayDependencyGraph';
import { collectionIdentity, requestDescriptors } from './intelligence-utils';
const schemaDiff = (baseline, actual, prefix = '', output = []) => {
  if (!baseline && actual) return output;
  if (baseline?.type !== actual?.type) output.push({ path: prefix || 'body', baseline: baseline?.type || 'missing', actual: actual?.type || 'missing' });
  if (baseline?.type === 'object') Object.entries(baseline.properties || {}).forEach(([key, value]) => {
    const next = prefix ? `${prefix}.${key}` : key;
    if (!actual?.properties?.[key]) output.push({ path: next, baseline: value.type, actual: 'missing' });
    else schemaDiff(value, actual.properties[key], next, output);
  });
  return output;
};
const compareRun = (baseline, run) => {
  if (!baseline) return null;
  for (const step of run.steps || []) {
    const expected = (baseline.steps || []).find((candidate) => candidate.stepId === step.stepId);
    if (!expected) return { stepId: step.stepId, reason: 'Step is not in baseline' };
    if (step.status !== expected.status) return { stepId: step.stepId, reason: `Status changed from ${expected.status} to ${step.status}` };
    const differences = schemaDiff(expected.responseSchema, step.responseSchema);
    if (differences.length) return { stepId: step.stepId, reason: `Response schema changed at ${differences[0].path}`, differences };
    if (expected.duration && step.duration > Math.max(expected.duration * 2, expected.duration + 500)) return { stepId: step.stepId, reason: `Response time regressed from ${expected.duration}ms to ${step.duration}ms` };
  }
  return null;
};

const ReplayStudioPanel = ({ collection, selectedSessionId, initialScenarioId = null }) => {
  const dispatch = useDispatch();
  const [scenarios, setScenarios] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [scenario, setScenario] = useState(null);
  const [busy, setBusy] = useState(false);
  const [environmentUid, setEnvironmentUid] = useState(collection.activeEnvironmentUid || '');
  const [lastRun, setLastRun] = useState(null);
  const [runs, setRuns] = useState([]);
  const [baseline, setBaseline] = useState(null);
  const [divergence, setDivergence] = useState(null);
  const [editorView, setEditorView] = useState('steps');
  const [draggedStepId, setDraggedStepId] = useState(null);
  const [testDataProfiles, setTestDataProfiles] = useState([]);
  const [testDataProfileId, setTestDataProfileId] = useState('');
  const [replayTarget, setReplayTarget] = useState('environment');
  const [mockState, setMockState] = useState({ running: false, url: null });
  const identity = useMemo(() => collectionIdentity(collection), [collection.uid, collection.name, collection.pathname]);
  const availableRequests = useMemo(() => requestDescriptors(collection), [collection.items]);

  const refresh = useCallback(async () => {
    const next = await window.ipcRenderer.invoke('renderer:recorder:list-scenarios', identity);
    setScenarios(next || []);
    if (!selectedId && next?.[0]) setSelectedId(next[0].id);
  }, [identity, selectedId]);

  useEffect(() => { refresh().catch((error) => toast.error(error.message)); }, [refresh]);
  useEffect(() => {
    Promise.all([
      window.ipcRenderer.invoke('renderer:api-intelligence:list-test-data', identity),
      window.ipcRenderer.invoke('renderer:api-intelligence:get-mock-state')
    ]).then(([profiles, state]) => {
      setTestDataProfiles(profiles || []);
      setMockState(state || { running: false, url: null });
    }).catch(() => {});
  }, [identity]);
  useEffect(() => { if (initialScenarioId) setSelectedId(initialScenarioId); }, [initialScenarioId]);
  useEffect(() => {
    if (!selectedId) return setScenario(null);
    window.ipcRenderer.invoke('renderer:recorder:get-scenario', { collection: identity, scenarioId: selectedId }).then((next) => {
      setScenario(next);
      setTestDataProfileId(next?.testDataProfileId || '');
      setReplayTarget(next?.replayTarget || 'environment');
    }).catch((error) => toast.error(error.message));
  }, [identity, selectedId]);
  useEffect(() => {
    if (!selectedId) return;
    Promise.all([
      window.ipcRenderer.invoke('renderer:recorder:get-baseline', { collection: identity, scenarioId: selectedId, environmentKey: environmentUid || null }),
      window.ipcRenderer.invoke('renderer:recorder:list-runs', { collection: identity, scenarioId: selectedId })
    ]).then(([nextBaseline, nextRuns]) => {
      setBaseline(nextBaseline || null);
      setRuns(nextRuns || []);
      setLastRun(nextRuns?.[0] || null);
    }).catch(() => {
      setBaseline(null);
      setRuns([]);
    });
  }, [identity, selectedId, environmentUid]);

  const analyze = async () => {
    if (!selectedSessionId) return toast.error('Select a recording first');
    setBusy(true);
    try {
      const saved = await window.ipcRenderer.invoke('renderer:recorder:analyze-session', { sessionId: selectedSessionId, collection: identity, requests: requestDescriptors(collection) });
      await refresh();
      setSelectedId(saved.id);
      setScenario(saved);
      toast.success('Recording analyzed into a local Replay scenario');
    } catch (error) { toast.error(error.message || 'Unable to analyze recording'); } finally { setBusy(false); }
  };
  const save = async () => {
    if (!scenario) return;
    const saved = await window.ipcRenderer.invoke('renderer:recorder:save-scenario', { collection: identity, scenario });
    setScenario(saved);
    await refresh();
    toast.success('Scenario saved locally');
  };
  const remove = async () => {
    if (!scenario || !window.confirm(`Delete local scenario “${scenario.name}”?`)) return;
    await window.ipcRenderer.invoke('renderer:recorder:delete-scenario', { collection: identity, scenarioId: scenario.id });
    setScenario(null);
    setSelectedId(null);
    await refresh();
  };
  const openRequest = (step) => {
    const item = step.link?.requestUid ? findItemInCollection(collection, step.link.requestUid) : null;
    if (!item) return toast.error('Linked request is missing from the current collection');
    dispatch(addTab({ uid: item.uid, collectionUid: collection.uid, type: item.type, pathname: item.pathname, preview: false }));
  };
  const run = async () => {
    if (!scenario) return;
    const sideEffects = (scenario.steps || []).filter((step) => step.enabled !== false && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(step.requestHint?.method));
    if (sideEffects.length && !window.confirm(`Run ${scenario.steps.length} scenario steps? ${sideEffects.length} may modify server data.`)) return;
    setBusy(true);
    try {
      await dispatch(selectEnvironment(environmentUid || null, collection.uid));
      let testData = null;
      if (testDataProfileId) {
        const profile = testDataProfiles.find((candidate) => candidate.profileId === testDataProfileId);
        if (profile) testData = await window.ipcRenderer.invoke('renderer:api-intelligence:materialize-test-data', { profile, seed: profile.seed });
      }
      const currentMockState = replayTarget === 'mock-lab'
        ? await window.ipcRenderer.invoke('renderer:api-intelligence:get-mock-state')
        : mockState;
      if (replayTarget === 'mock-lab' && !currentMockState?.running) throw new Error('Start Mock Lab before replaying against it');
      const result = await dispatch(runReplayScenario(scenario, collection.uid, {
        environmentUid: environmentUid || null,
        stopOnFailure: true,
        testData,
        targetBaseUrl: replayTarget === 'mock-lab' ? currentMockState.url : null,
        breakpoints: scenario.breakpoints || [],
        onBreakpoint: async ({ when, step }) => {
          if (!window.confirm(`Breakpoint ${when} “${step.name}”. Continue?`)) throw new Error('Replay stopped at breakpoint');
        }
      }));
      const saved = await window.ipcRenderer.invoke('renderer:recorder:save-run', { collection: identity, scenarioId: scenario.id, run: result });
      setLastRun(saved);
      setRuns((current) => [saved, ...current.filter((candidate) => candidate.id !== saved.id)]);
      setDivergence(compareRun(baseline, saved));
      toast.success(saved.status === 'passed' ? 'Replay passed' : 'Replay stopped at the first failing step');
    } catch (error) { toast.error(error.message || 'Replay failed'); } finally { setBusy(false); }
  };
  const promoteBaselineContracts = async () => {
    if (!lastRun || lastRun.status !== 'passed') return toast.error('A passing run is required');
    let promoted = 0;
    for (const step of scenario.steps || []) {
      const runStep = lastRun.steps?.find((candidate) => candidate.stepId === step.id);
      const item = step.link?.requestUid ? findItemInCollection(collection, step.link.requestUid) : null;
      if (!item || !runStep?.responseSchema) continue;
      await window.ipcRenderer.invoke('renderer:api-intelligence:accept-schema-contract', {
        collection: identity,
        request: { uid: item.uid, itemUid: item.uid, name: item.name, pathname: item.pathname, type: item.type, request: (item.draft || item).request },
        status: runStep.httpStatus || 200,
        schema: runStep.responseSchema,
        source: 'replay-baseline',
        environmentScope: environmentUid ? 'environment-specific' : 'all',
        environmentKey: environmentUid || null
      });
      promoted += 1;
    }
    toast.success(`Promoted ${promoted} Replay response contract${promoted === 1 ? '' : 's'} locally`);
  };

  const toggleBreakpoint = (stepId, when, enabled) => {
    setScenario((current) => {
      const existing = current.breakpoints || [];
      const filtered = existing.filter((breakpoint) => !(breakpoint.stepId === stepId && breakpoint.when === when));
      return { ...current, breakpoints: enabled ? [...filtered, { stepId, when }] : filtered };
    });
  };

  const saveBaseline = async () => {
    if (!lastRun || lastRun.status !== 'passed') return toast.error('Only a passing run can become the baseline');
    const saved = await window.ipcRenderer.invoke('renderer:recorder:save-baseline', { collection: identity, scenarioId: scenario.id, environmentKey: environmentUid || null, run: lastRun });
    setBaseline(saved);
    setDivergence(null);
    toast.success('Good baseline saved locally');
  };
  const exportScenario = async () => {
    if (!scenario) return;
    const result = await window.ipcRenderer.invoke('renderer:recorder:export-scenario', { collection: identity, scenarioId: scenario.id });
    if (!result?.canceled) toast.success('Replay scenario exported');
  };
  const importScenario = async () => {
    const result = await window.ipcRenderer.invoke('renderer:recorder:import-scenario', identity);
    if (!result?.canceled) {
      await refresh(); setSelectedId(result.scenario.id); toast.success('Replay scenario imported and ready to relink');
    }
  };
  const updateStep = (stepId, patch) => setScenario((current) => ({ ...current, steps: current.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step) }));
  const relinkStep = (stepId, requestUid) => {
    const request = availableRequests.find((candidate) => candidate.itemUid === requestUid);
    if (!request) return;
    updateStep(stepId, {
      link: { requestUid: request.itemUid, pathHint: request.pathname, confidence: 'exact', source: 'manual-relink' },
      requestHint: { method: request.method, url: request.url }
    });
  };
  const reorderStep = (targetStepId) => {
    if (!draggedStepId || draggedStepId === targetStepId) return setDraggedStepId(null);
    setScenario((current) => {
      const ordered = [...(current.steps || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
      const fromIndex = ordered.findIndex((step) => step.id === draggedStepId);
      const toIndex = ordered.findIndex((step) => step.id === targetStepId);
      if (fromIndex < 0 || toIndex < 0) return current;
      const [moved] = ordered.splice(fromIndex, 1);
      ordered.splice(toIndex, 0, moved);
      return { ...current, steps: ordered.map((step, index) => ({ ...step, order: index + 1 })) };
    });
    setDraggedStepId(null);
  };
  const updateRetry = (step, patch) => updateStep(step.id, {
    replay: {
      ...(step.replay || {}),
      retry: patch === null ? undefined : { maxAttempts: 3, backoff: 'exponential', backoffMs: 500, maxBackoffMs: 10000, onStatuses: [429, 500, 502, 503, 504], onNetworkError: true, ...(step.replay?.retry || {}), ...patch }
    }
  });
  const updatePolling = (step, patch) => updateStep(step.id, {
    replay: {
      ...(step.replay || {}),
      polling: patch === null ? undefined : { intervalMs: 2000, maxAttempts: 10, until: { path: 'body.status', operator: 'eq', expected: 'complete' }, ...(step.replay?.polling || {}), ...patch }
    }
  });

  return (
    <div className="replay-studio-layout">
      <aside className="replay-scenario-list">
        <div className="replay-toolbar">
          <button className="button primary" disabled={!selectedSessionId || busy} onClick={analyze}><IconRefresh size={14} /> Analyze recording</button>
          <button className="button" onClick={importScenario}><IconUpload size={14} /> Import</button>
          <button className="button" onClick={() => window.ipcRenderer.invoke('renderer:recorder:reveal-replay-data')}><IconFolder size={14} /> Local data</button>
        </div>
        {scenarios.map((item) => <button key={item.id} className={`replay-scenario-row ${selectedId === item.id ? 'selected' : ''}`} onClick={() => setSelectedId(item.id)}><strong>{item.name}</strong><span>{item.steps?.length || 0} steps · local</span></button>)}
        {!scenarios.length && <div className="empty-state"><strong>No local scenarios yet</strong><span>Analyze a recording. Nothing will be written into this collection.</span></div>}
      </aside>
      <main className="replay-editor">
        {!scenario ? <div className="empty-state"><strong>Select or generate a scenario</strong></div> : (
          <>
            <div className="replay-editor-header">
              <input value={scenario.name || ''} onChange={(event) => setScenario({ ...scenario, name: event.target.value })} />
              <select value={environmentUid} onChange={(event) => setEnvironmentUid(event.target.value)}><option value="">No environment</option>{(collection.environments || []).map((env) => <option key={env.uid} value={env.uid}>{env.name}</option>)}</select>
              <select
                value={replayTarget}
                onChange={(event) => {
                  setReplayTarget(event.target.value); setScenario({ ...scenario, replayTarget: event.target.value });
                }}
              ><option value="environment">Active environment</option><option value="mock-lab">Mock Lab{mockState.running ? ` · ${mockState.url}` : ' · stopped'}</option>
              </select>
              <select
                value={testDataProfileId}
                onChange={(event) => {
                  setTestDataProfileId(event.target.value); setScenario({ ...scenario, testDataProfileId: event.target.value || null });
                }}
              ><option value="">No test data</option>{testDataProfiles.map((profile) => <option key={profile.profileId} value={profile.profileId}>{profile.name}</option>)}
              </select>
              <button className="button" onClick={save}>Save</button>
              <button className="button" onClick={exportScenario}><IconDownload size={14} /> Export</button>
              <button className="button danger" onClick={remove}><IconTrash size={14} /></button>
              <button className="button primary" disabled={busy} onClick={run}><IconPlayerPlay size={14} /> Replay</button>
            </div>
            <div className="replay-local-note">Stored locally outside the collection. Linked requests remain normal Bruno requests.</div>
            <div className="replay-editor-tabs">
              <button className={editorView === 'steps' ? 'active' : ''} onClick={() => setEditorView('steps')}>Steps & policies</button>
              <button className={editorView === 'graph' ? 'active' : ''} onClick={() => setEditorView('graph')}>Dependency graph</button>
            </div>
            {divergence && <div className="replay-divergence"><IconAlertTriangle size={15} /><strong>First divergence:</strong> {divergence.reason}</div>}
            {editorView === 'graph' ? <ReplayDependencyGraph scenario={scenario} /> : (
              <div className="replay-step-list">{[...(scenario.steps || [])].sort((a, b) => (a.order || 0) - (b.order || 0)).map((step, index) => {
                const linked = step.link?.requestUid ? findItemInCollection(collection, step.link.requestUid) : null;
                const linkedSource = linked?.draft || linked;
                const stale = Boolean(linked && (String(linkedSource?.request?.method || 'GET').toUpperCase() !== String(step.requestHint?.method || 'GET').toUpperCase() || String(linkedSource?.request?.url || '') !== String(step.requestHint?.url || '')));
                const runStep = lastRun?.steps?.find((candidate) => candidate.stepId === step.id);
                return (
                  <div
                    key={step.id}
                    className={`replay-step ${!linked ? 'broken' : ''} ${stale ? 'stale' : ''} ${draggedStepId === step.id ? 'dragging' : ''}`}
                    draggable
                    onDragStart={() => setDraggedStepId(step.id)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => reorderStep(step.id)}
                    onDragEnd={() => setDraggedStepId(null)}
                  >
                    <span className="replay-drag-handle" title="Drag to reorder">⋮⋮</span>
                    <input type="checkbox" checked={step.enabled !== false} onChange={(event) => updateStep(step.id, { enabled: event.target.checked })} />
                    <span className="replay-step-index">{index + 1}</span>
                    <div className="replay-step-copy">
                      <input value={step.name || ''} onChange={(event) => updateStep(step.id, { name: event.target.value })} />
                      <span>{step.requestHint?.method} {step.requestHint?.url}</span>
                      <small>{linked ? `Linked to ${linked.name}${stale ? ' · request changed since review' : ''}` : 'Linked request missing · relink required'} · {step.role} · {step.confidence}</small>
                      {runStep?.attempts?.length > 1 && <div className="replay-attempt-trace">{runStep.attempts.map((attempt) => <span key={attempt.attempt} className={attempt.status}>#{attempt.attempt} {attempt.httpStatus || attempt.status} · {attempt.duration}ms</span>)}</div>}
                      <div className="replay-policy-row">
                        <label><input type="checkbox" checked={Boolean(step.replay?.retry)} onChange={(event) => updateRetry(step, event.target.checked ? {} : null)} /> Retry</label>
                        {step.replay?.retry && (
                          <>
                            <span>attempts <input type="number" min="1" max="20" value={step.replay.retry.maxAttempts || 3} onChange={(event) => updateRetry(step, { maxAttempts: Number(event.target.value) })} /></span>
                            <select value={step.replay.retry.backoff || 'exponential'} onChange={(event) => updateRetry(step, { backoff: event.target.value })}><option value="exponential">exponential</option><option value="fixed">fixed</option></select>
                            <span>base ms <input type="number" min="0" value={step.replay.retry.backoffMs || 500} onChange={(event) => updateRetry(step, { backoffMs: Number(event.target.value) })} /></span>
                          </>
                        )}
                        <label><input type="checkbox" checked={(scenario.breakpoints || []).some((breakpoint) => breakpoint.stepId === step.id && breakpoint.when === 'before')} onChange={(event) => toggleBreakpoint(step.id, 'before', event.target.checked)} /> Break before</label>
                        <label><input type="checkbox" checked={(scenario.breakpoints || []).some((breakpoint) => breakpoint.stepId === step.id && breakpoint.when === 'after')} onChange={(event) => toggleBreakpoint(step.id, 'after', event.target.checked)} /> Break after</label>
                        <label><input type="checkbox" checked={Boolean(step.replay?.polling)} onChange={(event) => updatePolling(step, event.target.checked ? {} : null)} /> Polling</label>
                        {step.replay?.polling && (
                          <>
                            <span>interval <input type="number" min="0" value={step.replay.polling.intervalMs || 2000} onChange={(event) => updatePolling(step, { intervalMs: Number(event.target.value) })} /></span>
                            <span>max <input type="number" min="1" max="100" value={step.replay.polling.maxAttempts || 10} onChange={(event) => updatePolling(step, { maxAttempts: Number(event.target.value) })} /></span>
                            <input className="replay-condition-path" placeholder="body.status" value={step.replay.polling.until?.path || ''} onChange={(event) => updatePolling(step, { until: { ...(step.replay.polling.until || {}), path: event.target.value } })} />
                            <select value={step.replay.polling.until?.operator || 'eq'} onChange={(event) => updatePolling(step, { until: { ...(step.replay.polling.until || {}), operator: event.target.value } })}><option value="eq">equals</option><option value="neq">not equal</option><option value="exists">exists</option><option value="contains">contains</option></select>
                            {step.replay.polling.until?.operator !== 'exists' && <input className="replay-condition-value" placeholder="complete" value={step.replay.polling.until?.expected ?? ''} onChange={(event) => updatePolling(step, { until: { ...(step.replay.polling.until || {}), expected: event.target.value } })} />}
                          </>
                        )}
                      </div>
                    </div>
                    <span className={`replay-run-status ${runStep?.status || ''}`}>{runStep?.status === 'passed' ? <IconCheck size={14} /> : runStep?.status || ''}</span>
                    {!linked ? (
                      <select className="replay-relink" value="" onChange={(event) => relinkStep(step.id, event.target.value)}>
                        <option value="">Relink…</option>
                        {availableRequests.map((request) => <option key={request.itemUid} value={request.itemUid}>{request.method} · {request.name}</option>)}
                      </select>
                    ) : <button className="button" onClick={() => openRequest(step)}><IconExternalLink size={13} /> Open</button>}
                  </div>
                );
              })}
              </div>
            )}
            {lastRun && <div className="replay-run-summary"><strong>Last run: {lastRun.status}</strong><span>{lastRun.steps?.length || 0} executed steps</span>{lastRun.status === 'passed' && <button className="button" onClick={saveBaseline}>Save as good baseline</button>}{lastRun.status === 'passed' && <button className="button" onClick={promoteBaselineContracts}>Promote contracts</button>}{baseline && <span>Baseline: {new Date(baseline.savedAt).toLocaleString()}</span>}<span>{runs.length} saved run{runs.length === 1 ? '' : 's'}</span></div>}
          </>
        )}
      </main>
    </div>
  );
};

export default ReplayStudioPanel;
