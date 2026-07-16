import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { IconExternalLink, IconRefresh, IconDownload } from '@tabler/icons';
import toast from 'react-hot-toast';
import { addTab } from 'providers/ReduxStore/slices/tabs';
import { collectionIdentity, requestDescriptors } from './intelligence-utils';
import useIntelligenceEvents from './useIntelligenceEvents';

const DIMENSION_LABELS = {
  execution: 'Execution',
  scenarios: 'Scenarios',
  assertions: 'Assertions',
  contracts: 'Contracts',
  failurePaths: 'Failure paths',
  environments: 'Environments',
  freshness: 'Freshness'
};

const CoveragePanel = ({ collection }) => {
  const dispatch = useDispatch();
  const [coverage, setCoverage] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const identity = useMemo(() => collectionIdentity(collection), [collection]);
  const requests = useMemo(() => requestDescriptors(collection), [collection.items]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCoverage(await window.ipcRenderer.invoke('renderer:api-intelligence:get-coverage', { collection: identity, requests }));
    } catch (error) {
      toast.error(error.message || 'Unable to compute coverage');
    } finally {
      setLoading(false);
    }
  }, [identity, requests]);

  useEffect(() => { load(); }, [load]);
  useIntelligenceEvents(identity, ['contracts', 'replay', 'coverage'], load);

  const exportCoverage = async () => {
    const result = await window.ipcRenderer.invoke('renderer:api-intelligence:export-coverage', { collection: identity, requests });
    if (!result?.canceled) toast.success('Coverage snapshot exported');
  };

  const visible = (coverage?.requests || []).filter((request) => {
    if (filter === 'uncovered') return !request.covered;
    if (filter === 'never-run') return !request.replayed;
    if (filter === 'stale') return request.staleLinks?.length > 0 || request.contractStatus === 'stale';
    if (filter === 'missing-contract') return request.contractStatus === 'missing';
    if (filter === 'missing-failure') return !Object.entries(request.variants || {}).some(([key, value]) => key !== 'success' && value);
    return true;
  });

  const openRequest = (record) => {
    const request = requests.find((candidate) => candidate.uid === record.requestUid);
    if (!request) return;
    dispatch(addTab({ uid: request.uid, collectionUid: collection.uid, type: request.type, pathname: request.pathname, preview: false, requestPaneTab: 'coverage' }));
  };

  if (loading) return <div className="empty-state"><strong>Computing coverage…</strong></div>;
  if (!coverage) return <div className="empty-state"><strong>Coverage unavailable</strong></div>;

  return (
    <div className="intelligence-panel">
      <div className="intelligence-toolbar">
        <div><strong>Scenario Coverage Map</strong><span>Transparent dimensions derived from Replay scenarios, runs, assertions, contracts and request revisions.</span></div>
        <div className="intelligence-actions">
          <select value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">All requests</option><option value="uncovered">Uncovered</option><option value="never-run">Never run</option><option value="stale">Stale</option><option value="missing-contract">Missing contract</option><option value="missing-failure">Missing failure paths</option>
          </select>
          <button className="button" onClick={load}><IconRefresh size={14} /> Recompute</button>
          <button className="button" onClick={exportCoverage}><IconDownload size={14} /> Export</button>
        </div>
      </div>
      <div className="intelligence-cards">
        {Object.entries(coverage.summary || {}).slice(0, 7).map(([key, value]) => <div key={key}><span>{key.replace(/([A-Z])/g, ' $1')}</span><strong>{value}</strong></div>)}
      </div>
      <div className="coverage-dimensions">
        {Object.entries(coverage.dimensions || {}).map(([key, value]) => (
          <div className="coverage-meter" key={key}><span>{DIMENSION_LABELS[key] || key}</span><div><i style={{ width: `${value}%` }} /></div><strong>{value}%</strong></div>
        ))}
      </div>
      <div className="intelligence-table">
        <div className="intelligence-row coverage header"><span>Request</span><span>Scenarios</span><span>Runs</span><span>Assertions</span><span>Contract</span><span>Failure paths</span><span /></div>
        {visible.map((request) => {
          const assertionCount = Object.values(request.assertions || {}).filter(Boolean).length;
          const failureCount = Object.entries(request.variants || {}).filter(([key, value]) => key !== 'success' && value).length;
          return (
            <div className="intelligence-row coverage" key={request.requestUid || request.requestRef?.key}>
              <span><strong>{request.name || request.requestRef?.normalizedUrl}</strong>{request.staleLinks?.length ? <small>{request.staleLinks.length} stale link(s)</small> : null}</span>
              <span>{request.scenarioIds?.length || 0}</span><span>{request.runCount || 0}</span><span>{assertionCount}/4</span>
              <span className={`intel-status ${request.contractStatus}`}>{request.contractStatus}</span><span>{failureCount}</span>
              <button className="button" onClick={() => openRequest(request)}><IconExternalLink size={13} /> Open</button>
            </div>
          );
        })}
        {!visible.length && <div className="empty-state"><strong>No requests match this filter</strong></div>}
      </div>
    </div>
  );
};

export default CoveragePanel;
