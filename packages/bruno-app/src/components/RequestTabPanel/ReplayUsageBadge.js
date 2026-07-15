import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { IconActivity, IconPlus } from '@tabler/icons';
import toast from 'react-hot-toast';
import { addTab } from 'providers/ReduxStore/slices/tabs';

const ReplayUsageBadge = ({ collection, item }) => {
  const dispatch = useDispatch();
  const [usage, setUsage] = useState([]);
  const [scenarios, setScenarios] = useState([]);
  const identity = useMemo(() => ({ uid: collection.uid, name: collection.name, pathname: collection.pathname }), [collection.uid, collection.name, collection.pathname]);
  const refresh = async () => {
    const [nextUsage, nextScenarios] = await Promise.all([
      window.ipcRenderer.invoke('renderer:recorder:get-request-usage', { collection: identity, requestUid: item.uid }),
      window.ipcRenderer.invoke('renderer:recorder:list-scenarios', identity)
    ]);
    setUsage(nextUsage || []);
    setScenarios(nextScenarios || []);
  };
  useEffect(() => { refresh().catch(() => {}); }, [identity, item.uid]);
  const openStudio = (scenarioId = null) => dispatch(addTab({ uid: `${collection.uid}-web-recorder`, collectionUid: collection.uid, type: 'web-recorder', preview: false, replayScenarioId: scenarioId }));
  const addToScenario = async (event) => {
    const scenarioId = event.target.value;
    if (!scenarioId) return;
    const scenario = scenarios.find((candidate) => candidate.id === scenarioId);
    if (!scenario || scenario.steps?.some((step) => step.link?.requestUid === item.uid)) return;
    const source = item.draft || item;
    const next = { ...scenario, steps: [...(scenario.steps || []), { id: `${Date.now()}-${item.uid}`, name: item.name, order: (scenario.steps?.length || 0) + 1, enabled: true, role: 'api', confidence: 'manual', link: { requestUid: item.uid, pathHint: item.pathname, confidence: 'exact', source: 'manual' }, requestHint: { method: source.request?.method || 'GET', url: source.request?.url || '' }, overrides: {}, extracts: [], assertions: [], replay: {} }] };
    await window.ipcRenderer.invoke('renderer:recorder:save-scenario', { collection: identity, scenario: next });
    await refresh();
    toast.success(`Added ${item.name} to ${scenario.name}`);
  };
  if (!usage.length && !scenarios.length) return null;
  return <div className="replay-usage-badge"><IconActivity size={14} /><button onClick={() => openStudio(usage[0]?.scenarioId)}>{usage.length ? `Used in ${usage.length} Replay scenario${usage.length === 1 ? '' : 's'}` : 'Replay Studio'}</button>{scenarios.length > 0 && <label><IconPlus size={12} /><select value="" onChange={addToScenario}><option value="">Add to scenario…</option>{scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.name}</option>)}</select></label>}</div>;
};

export default ReplayUsageBadge;
