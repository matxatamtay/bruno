import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { IconPlayerPlay, IconRefresh, IconTrash } from '@tabler/icons';
import toast from 'react-hot-toast';
import { runReplayScenario } from 'providers/ReduxStore/slices/collections/actions';
import { collectionIdentity, pretty } from './intelligence-utils';
import useIntelligenceEvents from './useIntelligenceEvents';

const TracesPanel = ({ collection }) => {
  const dispatch = useDispatch();
  const [traces, setTraces] = useState([]);
  const [selected, setSelected] = useState(null);
  const [selectedStepId, setSelectedStepId] = useState(null);
  const [leftTraceId, setLeftTraceId] = useState('');
  const [rightTraceId, setRightTraceId] = useState('');
  const [comparison, setComparison] = useState(null);
  const [variableOverrides, setVariableOverrides] = useState('{}');
  const [busy, setBusy] = useState(false);
  const identity = useMemo(() => collectionIdentity(collection), [collection]);

  const load = useCallback(async () => {
    const next = await window.ipcRenderer.invoke('renderer:api-intelligence:list-traces', { collection: identity });
    setTraces(next || []);
    if (!selected && next?.[0]) {
      setSelected(next[0]);
      setSelectedStepId(next[0].steps?.[0]?.stepId || null);
    } else if (selected) {
      const fresh = next.find((trace) => trace.traceId === selected.traceId);
      if (fresh) setSelected(fresh);
    }
  }, [identity, selected?.traceId]);

  useEffect(() => { load().catch((error) => toast.error(error.message)); }, [load]);
  useIntelligenceEvents(identity, ['traces', 'replay'], () => load().catch(() => {}));

  const choose = (trace) => {
    setSelected(trace);
    setSelectedStepId(trace.steps?.[0]?.stepId || null);
    setComparison(null);
    setVariableOverrides('{}');
  };

  const compare = async () => {
    if (!leftTraceId || !rightTraceId) return;
    const left = traces.find((trace) => trace.traceId === leftTraceId);
    const right = traces.find((trace) => trace.traceId === rightTraceId);
    if (!left || !right || left.scenarioId !== right.scenarioId) return toast.error('Choose two traces from the same scenario');
    setComparison(await window.ipcRenderer.invoke('renderer:api-intelligence:compare-traces', { collection: identity, scenarioId: left.scenarioId, leftTraceId, rightTraceId }));
  };

  const togglePin = async () => {
    if (!selected) return;
    const next = await window.ipcRenderer.invoke('renderer:api-intelligence:pin-trace', { collection: identity, scenarioId: selected.scenarioId, traceId: selected.traceId, pinned: !selected.pinned });
    setSelected(next); await load();
  };

  const remove = async () => {
    if (!selected || !window.confirm('Delete this local trace?')) return;
    await window.ipcRenderer.invoke('renderer:api-intelligence:delete-trace', { collection: identity, scenarioId: selected.scenarioId, traceId: selected.traceId });
    setSelected(null); setSelectedStepId(null); await load();
  };

  const replayFromStep = async (stepId, onlyStep = false) => {
    if (!selected || !stepId) return;
    if (!window.confirm('Replay from this step using the sanitized historical variable snapshot? Cookies, OAuth sessions and redacted secrets may be unavailable.')) return;
    setBusy(true);
    try {
      const scenario = await window.ipcRenderer.invoke('renderer:recorder:get-scenario', { collection: identity, scenarioId: selected.scenarioId });
      if (!scenario) throw new Error('Scenario no longer exists');
      const traceStep = selected.steps.find((step) => step.stepId === stepId);
      const historicalVariables = traceStep?.before?.variablesByScope?.scenario || selected.initialVariables || {};
      let overrides = {};
      try { overrides = JSON.parse(variableOverrides || '{}'); } catch { throw new Error('Variable overrides must be valid JSON'); }
      const result = await dispatch(runReplayScenario(scenario, collection.uid, {
        environmentUid: selected.environmentKey || null,
        startStepId: stepId,
        onlyStep,
        historicalVariables: { ...historicalVariables, ...overrides },
        stopOnFailure: true,
        breakpoints: scenario.breakpoints || [],
        onBreakpoint: async ({ when, step }) => {
          if (!window.confirm(`Breakpoint ${when} “${step.name}”. Continue replay?`)) throw new Error('Replay stopped at breakpoint');
        }
      }));
      await window.ipcRenderer.invoke('renderer:recorder:save-run', { collection: identity, scenarioId: scenario.id, run: { ...result, forkedFromTraceId: selected.traceId } });
      toast.success(result.status === 'passed' ? 'Forked replay passed' : 'Forked replay completed with a failure');
      await load();
    } catch (error) {
      toast.error(error.message || 'Unable to replay from step');
    } finally { setBusy(false); }
  };

  const step = selected?.steps?.find((candidate) => candidate.stepId === selectedStepId) || selected?.steps?.[0] || null;

  return (
    <div className="trace-layout">
      <aside className="intelligence-sidebar">
        <div className="replay-toolbar"><button className="button" onClick={load}><IconRefresh size={14} /> Refresh</button></div>
        {traces.map((trace) => <button key={trace.traceId} className={`replay-scenario-row ${selected?.traceId === trace.traceId ? 'selected' : ''}`} onClick={() => choose(trace)}><strong>{trace.scenarioName || trace.scenarioId}</strong><span>{trace.status} · {new Date(trace.startedAt).toLocaleString()}{trace.pinned ? ' · pinned' : ''}</span></button>)}
        {!traces.length && <div className="empty-state"><strong>No traces yet</strong><span>Run a Replay scenario. Trace capture is automatic.</span></div>}
      </aside>
      <main className="trace-viewer">
        {!selected ? <div className="empty-state"><strong>Select a trace</strong></div> : (
          <>
            <div className="intelligence-toolbar">
              <div><strong>Time-travel Debugger</strong><span>{selected.scenarioName} · {selected.status} · state {selected.stateCompleteness?.status || 'partial'}</span></div>
              <div className="intelligence-actions"><button className="button" onClick={togglePin}>{selected.pinned ? 'Unpin' : 'Pin'}</button><button className="button danger" onClick={remove}><IconTrash size={14} /></button></div>
            </div>
            <div className="trace-compare-bar">
              <select value={leftTraceId} onChange={(event) => setLeftTraceId(event.target.value)}><option value="">Left run…</option>{traces.map((trace) => <option key={trace.traceId} value={trace.traceId}>{trace.scenarioName} · {new Date(trace.startedAt).toLocaleTimeString()}</option>)}</select>
              <select value={rightTraceId} onChange={(event) => setRightTraceId(event.target.value)}><option value="">Right run…</option>{traces.map((trace) => <option key={trace.traceId} value={trace.traceId}>{trace.scenarioName} · {new Date(trace.startedAt).toLocaleTimeString()}</option>)}</select>
              <button className="button" onClick={compare}>Compare</button>
              {comparison?.firstDivergence && <span>First divergence: {comparison.firstDivergence.name} · {comparison.firstDivergence.firstDifference?.path || 'status'}</span>}
            </div>
            <div className="trace-grid">
              <section className="trace-timeline">
                <div className="column-title"><span>Step timeline</span><small>{selected.steps?.length || 0} steps</small></div>
                {(selected.steps || []).map((candidate, index) => <button key={`${candidate.phase}-${candidate.stepId}-${index}`} className={selectedStepId === candidate.stepId ? 'selected' : ''} onClick={() => setSelectedStepId(candidate.stepId)}><span>{index + 1}</span><strong>{candidate.name}</strong><small>{candidate.phase || 'scenario'} · {candidate.status} · {candidate.duration || 0}ms</small></button>)}
              </section>
              <section className="trace-inspector">
                {!step ? <div className="empty-state"><strong>No step selected</strong></div> : (
                  <>
                    <div className="trace-inspector-header"><div><strong>{step.name}</strong><span>{step.status} · HTTP {step.httpStatus || 'n/a'}</span></div><div className="intelligence-actions"><button className="button" disabled={busy || step.phase !== 'scenario'} onClick={() => replayFromStep(step.stepId, true)}><IconPlayerPlay size={14} /> This step only</button><button className="button primary" disabled={busy || step.phase !== 'scenario'} onClick={() => replayFromStep(step.stepId, false)}><IconPlayerPlay size={14} /> From this step</button></div></div>
                    {(step.requestRevision?.methodChanged || step.requestRevision?.urlChanged) && <div className="trace-revision-warning">Current request definition differs from the historical trace. Replay uses the current request with historical variables.</div>}
                    <div className="trace-section"><strong>Variable overrides before replay</strong><textarea value={variableOverrides} onChange={(event) => setVariableOverrides(event.target.value)} /></div>
                    <div className="trace-section"><strong>Variable mutations</strong><pre>{pretty(step.after?.variableMutations || [])}</pre></div>
                    <div className="trace-section"><strong>Request template</strong><pre>{pretty(step.before?.requestTemplate)}</pre></div>
                    <div className="trace-section"><strong>Attempts</strong>{(step.attempts || []).map((attempt) => <div className="trace-attempt" key={attempt.attempt}><span>#{attempt.attempt} · {attempt.status} · {attempt.duration}ms</span><pre>{pretty({ request: attempt.effectiveRequest, response: attempt.responseSummary, error: attempt.error })}</pre></div>)}</div>
                    <div className="trace-section"><strong>Variables after</strong><pre>{pretty(step.after?.variablesByScope)}</pre></div>
                  </>
                )}
              </section>
            </div>
          </>
        )}
      </main>
    </div>
  );
};

export default TracesPanel;
