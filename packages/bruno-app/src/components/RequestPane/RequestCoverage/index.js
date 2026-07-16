import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IconRefresh } from '@tabler/icons';
import toast from 'react-hot-toast';
import { collectionIdentity, requestDescriptors } from 'components/WebRecorder/intelligence-utils';
import useIntelligenceEvents from 'components/WebRecorder/useIntelligenceEvents';

const RequestCoverage = ({ item, collection }) => {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const identity = useMemo(() => collectionIdentity(collection), [collection]);
  const requests = useMemo(() => requestDescriptors(collection), [collection.items]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const coverage = await window.ipcRenderer.invoke('renderer:api-intelligence:get-coverage', { collection: identity, requests, saveSnapshot: false });
      setRecord((coverage.requests || []).find((candidate) => candidate.requestUid === item.uid) || null);
    } catch (error) { toast.error(error.message); } finally { setLoading(false); }
  }, [identity, requests, item.uid]);
  useEffect(() => { load(); }, [load]);
  useIntelligenceEvents(identity, ['coverage', 'contracts', 'replay'], load);

  if (loading) return <div className="px-4 py-3 text-muted">Computing request coverage…</div>;
  if (!record) return <div className="px-4 py-3 text-muted">No coverage record is available.</div>;
  const missingFailures = ['authFailure', 'validationFailure', 'notFound', 'rateLimit', 'serverFailure'].filter((key) => !record.variants?.[key]);

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 overflow-auto w-full">
      <div className="flex items-start justify-between border rounded p-4"><div><strong>Scenario Coverage</strong><div className="text-xs text-muted">Computed from local Replay scenarios, runs, assertions, contracts and the current request fingerprint.</div></div><button className="btn btn-sm" onClick={load}><IconRefresh size={14} /> Refresh</button></div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="border rounded p-3"><div className="text-xs text-muted">Scenarios</div><strong>{record.scenarioIds?.length || 0}</strong></div>
        <div className="border rounded p-3"><div className="text-xs text-muted">Executions</div><strong>{record.runCount || 0}</strong></div>
        <div className="border rounded p-3"><div className="text-xs text-muted">Environments</div><strong>{record.environmentsCovered?.length || 0}</strong></div>
        <div className="border rounded p-3"><div className="text-xs text-muted">Contract</div><strong>{record.contractStatus}</strong></div>
        <div className="border rounded p-3"><div className="text-xs text-muted">Stale links</div><strong>{record.staleLinks?.length || 0}</strong></div>
      </div>
      <div className="border rounded p-4"><strong>Assertion dimensions</strong><pre className="mt-2">{JSON.stringify(record.assertions, null, 2)}</pre></div>
      <div className="border rounded p-4"><strong>Missing failure-path recommendations</strong><div className="text-sm text-muted mt-2">{missingFailures.length ? missingFailures.join(', ') : 'Core failure paths are represented in local scenarios or run evidence.'}</div></div>
    </div>
  );
};

export default RequestCoverage;
