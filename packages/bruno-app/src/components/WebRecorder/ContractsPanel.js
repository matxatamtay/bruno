import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { IconDatabase, IconExternalLink, IconFolder, IconRefresh, IconUpload, IconDownload } from '@tabler/icons';
import toast from 'react-hot-toast';
import { addTab } from 'providers/ReduxStore/slices/tabs';
import { collectionIdentity, requestDescriptors } from './intelligence-utils';
import useIntelligenceEvents from './useIntelligenceEvents';

const ContractsPanel = ({ collection }) => {
  const dispatch = useDispatch();
  const [dashboard, setDashboard] = useState({ summary: {}, contracts: [] });
  const [loading, setLoading] = useState(true);
  const identity = useMemo(() => collectionIdentity(collection), [collection]);
  const requests = useMemo(() => requestDescriptors(collection), [collection.items]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await window.ipcRenderer.invoke('renderer:api-intelligence:get-contract-dashboard', { collection: identity, requests });
      setDashboard(next || { summary: {}, contracts: [] });
    } catch (error) {
      toast.error(error.message || 'Unable to load contracts');
    } finally {
      setLoading(false);
    }
  }, [identity, requests]);

  useEffect(() => { load(); }, [load]);
  useIntelligenceEvents(identity, ['contracts', 'bundle'], load);

  const openRequest = (contract) => {
    const request = requests.find((candidate) => candidate.uid === contract.requestRef?.uid || candidate.pathname === contract.requestRef?.pathname);
    if (!request) return toast.error('Request is no longer present in this collection');
    dispatch(addTab({ uid: request.uid, collectionUid: collection.uid, type: request.type, pathname: request.pathname, preview: false, requestPaneTab: 'contract' }));
  };

  const exportBundle = async () => {
    const result = await window.ipcRenderer.invoke('renderer:api-intelligence:export-bundle', identity);
    if (!result?.canceled) toast.success('Intelligence data exported');
  };

  const exportReport = async () => {
    const result = await window.ipcRenderer.invoke('renderer:api-intelligence:export-contract-report', { collection: identity, requests });
    if (!result?.canceled) toast.success('Contract Guardian report exported');
  };

  const importBundle = async () => {
    const result = await window.ipcRenderer.invoke('renderer:api-intelligence:import-bundle', identity);
    if (!result?.canceled) {
      toast.success(`Imported ${result.result?.fileCount || 0} intelligence files`);
      await load();
    }
  };

  if (loading) return <div className="empty-state"><strong>Loading contracts…</strong></div>;
  const summary = dashboard.summary || {};

  return (
    <div className="intelligence-panel">
      <div className="intelligence-toolbar">
        <div><strong>API Contract Guardian</strong><span>Accepted contracts, source status and request revision awareness.</span></div>
        <div className="intelligence-actions">
          <button className="button" onClick={load}><IconRefresh size={14} /> Refresh</button>
          <button className="button" onClick={importBundle}><IconUpload size={14} /> Import</button>
          <button className="button" onClick={exportReport}><IconDownload size={14} /> CI report</button>
          <button className="button" onClick={exportBundle}><IconDownload size={14} /> Bundle</button>
          <button className="button" onClick={() => window.ipcRenderer.invoke('renderer:api-intelligence:reveal-data')}><IconFolder size={14} /> Local data</button>
        </div>
      </div>
      <div className="intelligence-cards">
        <div><span>Endpoints</span><strong>{summary.endpoints || 0}</strong></div>
        <div><span>Contracts</span><strong>{summary.contracts || 0}</strong></div>
        <div><span>Current</span><strong>{summary.current || 0}</strong></div>
        <div><span>Stale</span><strong>{summary.stale || 0}</strong></div>
        <div><span>Ambiguous links</span><strong>{summary.ambiguous || 0}</strong></div>
        <div><span>Breaking drift</span><strong>{summary.breakingDrifts || 0}</strong></div>
        <div><span>Warnings</span><strong>{summary.warnings || 0}</strong></div>
        <div><span>Without contracts</span><strong>{summary.withoutContracts || 0}</strong></div>
      </div>
      <div className="intelligence-table">
        <div className="intelligence-row header"><span>Request</span><span>Source</span><span>Statuses</span><span>Revision</span><span /></div>
        {(dashboard.contracts || []).map((contract) => (
          <div className="intelligence-row" key={contract.id}>
            <span><IconDatabase size={13} /> {contract.requestRef?.name || contract.requestRef?.normalizedUrl || contract.requestRef?.uid}</span>
            <span>{contract.source || 'local'}</span>
            <span>{Object.keys(contract.responseContracts || {}).join(', ') || 'none'}</span>
            <span className={`intel-status ${contract.comparison?.status || contract.revisionStatus}`}>{contract.revisionStatus}{contract.comparison ? ` · ${contract.comparison.status}` : ''}</span>
            <button className="button" onClick={() => openRequest(contract)}><IconExternalLink size={13} /> Open</button>
          </div>
        ))}
        {!dashboard.contracts?.length && <div className="empty-state"><strong>No accepted contracts</strong><span>Open an HTTP request and use its Contract tab to accept a response, response example or OpenAPI operation.</span></div>}
      </div>
    </div>
  );
};

export default ContractsPanel;
