import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { IconActivity, IconDatabase, IconPlus } from '@tabler/icons';
import toast from 'react-hot-toast';
import { addTab } from 'providers/ReduxStore/slices/tabs';
import useIntelligenceEvents from 'components/WebRecorder/useIntelligenceEvents';

const invokeSafe = (channel, payload, fallback) => window.ipcRenderer.invoke(channel, payload).catch(() => fallback);

const ReplayUsageBadge = ({ collection, item }) => {
  const dispatch = useDispatch();
  const [state, setState] = useState({
    usage: [],
    scenarios: [],
    contract: null,
    coverage: null,
    mockCount: 0,
    traceCount: 0
  });
  const identity = useMemo(() => ({
    uid: collection.uid,
    name: collection.name,
    pathname: collection.pathname,
    gitRemote: collection.gitRemote || null
  }), [collection.uid, collection.name, collection.pathname, collection.gitRemote]);
  const request = useMemo(() => {
    const source = item.draft || item;
    return {
      uid: item.uid,
      itemUid: item.uid,
      name: item.name,
      pathname: item.pathname,
      type: item.type,
      request: source.request || {},
      examples: source.examples || item.examples || []
    };
  }, [item]);

  const refresh = useCallback(async () => {
    const [usage, scenarios, contractState, coverage, mockResult, traces] = await Promise.all([
      invokeSafe('renderer:recorder:get-request-usage', { collection: identity, requestUid: item.uid }, []),
      invokeSafe('renderer:recorder:list-scenarios', identity, []),
      invokeSafe('renderer:api-intelligence:get-contract-state', { collection: identity, request, response: item.response || null }, {}),
      invokeSafe('renderer:api-intelligence:get-latest-coverage', identity, null),
      invokeSafe('renderer:api-intelligence:get-mock-lab', identity, { lab: { routes: [] } }),
      invokeSafe('renderer:api-intelligence:list-traces', { collection: identity }, [])
    ]);
    const coverageRecord = coverage?.requests?.find((candidate) => candidate.requestUid === item.uid) || null;
    const mockCount = (mockResult?.lab?.routes || []).filter((route) => route.requestRef?.uid === item.uid).length;
    const traceCount = (traces || []).filter((trace) => (trace.steps || []).some((step) => step.requestUid === item.uid)).length;
    setState({
      usage: usage || [],
      scenarios: scenarios || [],
      contract: contractState?.contract || null,
      coverage: coverageRecord,
      mockCount,
      traceCount
    });
  }, [identity, item.uid, item.response, request]);

  useEffect(() => { refresh(); }, [refresh]);
  useIntelligenceEvents(identity, ['contracts', 'coverage', 'mocks', 'traces', 'replay', 'bundle'], refresh);

  const openStudio = (intelligenceMode, scenarioId = null) => dispatch(addTab({
    uid: `${collection.uid}-web-recorder`,
    collectionUid: collection.uid,
    type: 'web-recorder',
    preview: false,
    intelligenceMode,
    replayScenarioId: scenarioId
  }));

  const addToScenario = async (event) => {
    const scenarioId = event.target.value;
    if (!scenarioId) return;
    const scenario = state.scenarios.find((candidate) => candidate.id === scenarioId);
    if (!scenario || scenario.steps?.some((step) => step.link?.requestUid === item.uid)) return;
    const source = item.draft || item;
    const next = {
      ...scenario,
      steps: [...(scenario.steps || []), {
        id: `${Date.now()}-${item.uid}`,
        name: item.name,
        order: (scenario.steps?.length || 0) + 1,
        enabled: true,
        role: 'api',
        confidence: 'manual',
        link: { requestUid: item.uid, pathHint: item.pathname, confidence: 'exact', source: 'manual' },
        requestHint: { method: source.request?.method || 'GET', url: source.request?.url || '' },
        overrides: {},
        extracts: [],
        assertions: [],
        replay: {}
      }]
    };
    await window.ipcRenderer.invoke('renderer:recorder:save-scenario', { collection: identity, scenario: next });
    await refresh();
    toast.success(`Added ${item.name} to ${scenario.name}`);
  };

  const coverageLabel = state.coverage
    ? state.coverage.staleLinks?.length
      ? 'Coverage stale'
      : state.coverage.covered && state.coverage.replayed
        ? 'Covered'
        : state.coverage.covered
          ? 'Coverage partial'
          : 'Uncovered'
    : 'Coverage';

  return (
    <div className="replay-usage-badge intelligence-request-badge">
      <IconActivity size={14} />
      <button className="intelligence-chip" onClick={() => openStudio('scenarios', state.usage[0]?.scenarioId || null)}>
        {state.usage.length ? `${state.usage.length} Scenario${state.usage.length === 1 ? '' : 's'}` : 'Scenarios'}
      </button>
      <button className={`intelligence-chip ${state.contract ? 'active' : 'muted'}`} onClick={() => openStudio('contracts')}>
        <IconDatabase size={11} /> {state.contract ? 'Contract' : 'No contract'}
      </button>
      <button className={`intelligence-chip ${state.coverage?.covered ? 'active' : 'muted'}`} onClick={() => openStudio('coverage')}>
        {coverageLabel}
      </button>
      <button className={`intelligence-chip ${state.mockCount ? 'active' : 'muted'}`} onClick={() => openStudio('mocks')}>
        {state.mockCount ? `${state.mockCount} Mock${state.mockCount === 1 ? '' : 's'}` : 'Mocks'}
      </button>
      <button className={`intelligence-chip ${state.traceCount ? 'active' : 'muted'}`} onClick={() => openStudio('traces')}>
        {state.traceCount ? `${state.traceCount} Trace${state.traceCount === 1 ? '' : 's'}` : 'Traces'}
      </button>
      {state.scenarios.length > 0 && (
        <label>
          <IconPlus size={12} />
          <select value="" onChange={addToScenario}>
            <option value="">Add to scenario…</option>
            {state.scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}
          </select>
        </label>
      )}
    </div>
  );
};

export default ReplayUsageBadge;
