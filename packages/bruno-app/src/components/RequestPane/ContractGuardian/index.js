import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { IconAlertTriangle, IconCheck, IconDatabase, IconFileCode, IconRefresh, IconTrash } from '@tabler/icons';
import toast from 'react-hot-toast';
import useIntelligenceEvents from 'components/WebRecorder/useIntelligenceEvents';

const collectionIdentity = (collection) => ({
  uid: collection.uid,
  name: collection.name,
  pathname: collection.pathname
});

const requestDescriptor = (item) => {
  const source = item.draft || item;
  return {
    uid: item.uid,
    name: item.name,
    pathname: item.pathname,
    type: item.type,
    request: source.request
  };
};

const responseFromExample = (example) => {
  const response = example?.response || {};
  const body = response.body || {};
  let data = body.content ?? null;
  if (body.type === 'json' && typeof data === 'string') {
    try { data = JSON.parse(data); } catch { /* Keep malformed example content as text. */ }
  }
  return {
    status: Number(response.status),
    statusText: response.statusText,
    headers: response.headers || [],
    data
  };
};

const comparisonTitle = (comparison) => {
  switch (comparison?.status) {
    case 'pass': return 'Current response matches the accepted contract';
    case 'breaking': return 'Breaking contract drift detected';
    case 'warning': return 'Contract warnings detected';
    case 'changed': return 'Compatible response changes detected';
    default: return 'Run this request to compare its response';
  }
};

const ContractGuardian = ({ item, collection }) => {
  const [state, setState] = useState({ contract: null, comparison: null, observationCount: 0, latestObservation: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [contractScope, setContractScope] = useState('all');
  const identity = useMemo(() => collectionIdentity(collection), [collection.uid, collection.name, collection.pathname]);
  const request = useMemo(() => requestDescriptor(item), [item]);
  const response = item.response || null;
  const examples = (item.draft?.examples || item.examples || []).filter((example) => Number.isInteger(Number(example?.response?.status)));
  const hasCompletedResponse = Number.isInteger(Number(response?.status));
  const hasOpenApiSource = Boolean(collection?.brunoConfig?.openapi?.[0]?.sourceUrl);
  const activeEnvironmentKey = collection.activeEnvironmentUid || null;
  const activeEnvironmentName = (collection.environments || []).find((environment) => environment.uid === activeEnvironmentKey)?.name || activeEnvironmentKey;
  const scopePayload = {
    environmentScope: contractScope,
    environmentKey: contractScope === 'environment-specific' ? activeEnvironmentKey : null
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await window.ipcRenderer.invoke('renderer:api-intelligence:get-contract-state', {
        collection: identity,
        request,
        response,
        environmentKey: activeEnvironmentKey
      });
      const resolved = next || { contract: null, comparison: null, observationCount: 0, latestObservation: null };
      setState(resolved);
      setContractScope(resolved.contract?.environmentScope === 'environment-specific' ? 'environment-specific' : 'all');
    } catch (error) {
      toast.error(error.message || 'Unable to load the local API contract');
    } finally {
      setLoading(false);
    }
  }, [identity, request, response, activeEnvironmentKey]);

  useEffect(() => { load(); }, [load]);
  useIntelligenceEvents(identity, ['contracts', 'observations', 'bundle'], load);

  const acceptCurrent = async () => {
    if (!hasCompletedResponse) return;
    setBusy(true);
    try {
      const next = await window.ipcRenderer.invoke('renderer:api-intelligence:accept-contract', {
        collection: identity,
        request,
        response,
        source: 'single-run',
        ...scopePayload
      });
      setState(next);
      toast.success(state.contract ? 'Local API contract updated' : 'Local API contract accepted');
    } catch (error) {
      toast.error(error.message || 'Unable to accept the current response');
    } finally {
      setBusy(false);
    }
  };

  const acceptExample = async (example) => {
    setBusy(true);
    try {
      const next = await window.ipcRenderer.invoke('renderer:api-intelligence:accept-contract', {
        collection: identity,
        request,
        response: responseFromExample(example),
        source: 'response-example',
        ...scopePayload
      });
      setState(next);
      toast.success(`Accepted response example “${example.name || 'Example'}” as the local contract`);
    } catch (error) {
      toast.error(error.message || 'Unable to accept the response example');
    } finally {
      setBusy(false);
    }
  };

  const acceptHistorical = async () => {
    if (!state.observationCount) return;
    setBusy(true);
    try {
      const next = await window.ipcRenderer.invoke('renderer:api-intelligence:accept-historical-contract', {
        collection: identity,
        request,
        ...scopePayload
      });
      setState((current) => ({ ...current, ...next }));
      toast.success(`Accepted a merged contract from ${state.observationCount} local observations`);
    } catch (error) {
      toast.error(error.message || 'Unable to accept historical observations');
    } finally {
      setBusy(false);
    }
  };

  const generateAssertions = async () => {
    setBusy(true);
    try {
      const result = await window.ipcRenderer.invoke('renderer:api-intelligence:generate-contract-assertions', { collection: identity, request, environmentKey: state.contract?.environmentKey || null });
      await navigator.clipboard.writeText(JSON.stringify(result.assertions || [], null, 2));
      toast.success(`Copied ${result.assertions?.length || 0} generated assertion suggestions`);
    } catch (error) {
      toast.error(error.message || 'Unable to generate assertions');
    } finally {
      setBusy(false);
    }
  };

  const suppressPath = async (findingPath, suppressed = true) => {
    try {
      const contract = await window.ipcRenderer.invoke('renderer:api-intelligence:suppress-contract-path', {
        collection: identity,
        request,
        path: findingPath,
        suppressed,
        environmentKey: state.contract?.environmentKey || null
      });
      setState((current) => ({ ...current, contract }));
      await load();
      toast.success(suppressed ? `Ignored ${findingPath} locally` : `Restored ${findingPath}`);
    } catch (error) {
      toast.error(error.message || 'Unable to update the local contract policy');
    }
  };

  const acceptOpenApi = async () => {
    if (!hasOpenApiSource) return;
    setBusy(true);
    try {
      const specResult = await window.ipcRenderer.invoke('renderer:read-openapi-spec', { collectionPath: collection.pathname });
      if (specResult?.error || !specResult?.content) throw new Error(specResult?.error || 'Stored OpenAPI spec is unavailable');
      const next = await window.ipcRenderer.invoke('renderer:api-intelligence:accept-openapi-contract', {
        collection: identity,
        request,
        spec: specResult.content,
        ...scopePayload
      });
      setState((current) => ({ ...current, ...next }));
      toast.success('Accepted matching OpenAPI operation as the local contract');
    } catch (error) {
      toast.error(error.message || 'Unable to accept the OpenAPI contract');
    } finally {
      setBusy(false);
    }
  };

  const removeContract = async () => {
    if (!state.contract || !window.confirm('Delete this local accepted contract?')) return;
    setBusy(true);
    try {
      await window.ipcRenderer.invoke('renderer:api-intelligence:delete-contract', { collection: identity, request, environmentKey: state.contract.environmentKey || null });
      setState((current) => ({ ...current, contract: null, comparison: null }));
      toast.success('Local API contract deleted');
    } catch (error) {
      toast.error(error.message || 'Unable to delete the local contract');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="px-4 py-3 text-muted">Loading local contract…</div>;

  const summary = state.comparison?.summary || { breaking: 0, warnings: 0, nonBreaking: 0 };
  const statuses = Object.keys(state.contract?.responseContracts || {});

  return (
    <div className="flex flex-col gap-4 px-4 pb-6 overflow-auto w-full">
      <div className="flex items-start justify-between gap-4 border rounded p-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2 font-semibold">
            <IconDatabase size={16} /> API Contract Guardian
          </div>
          <div className="text-xs text-muted">
            Stored locally outside the collection. Request files remain untouched until an explicit promotion action is added later.
          </div>
        </div>
        <div className="flex gap-2 flex-wrap justify-end">
          <select className="btn btn-sm" value={contractScope} onChange={(event) => setContractScope(event.target.value)}>
            <option value="all">All environments</option>
            <option value="environment-specific" disabled={!activeEnvironmentKey}>Only {activeEnvironmentName || 'active environment'}</option>
          </select>
          <button className="btn btn-sm" disabled={busy} onClick={load}><IconRefresh size={14} /> Refresh</button>
          {state.observationCount > 0 && <button className="btn btn-sm" disabled={busy} onClick={acceptHistorical}>Accept {state.observationCount} observations</button>}
          {hasOpenApiSource && <button className="btn btn-sm" disabled={busy} onClick={acceptOpenApi}><IconFileCode size={14} /> Accept OpenAPI</button>}
          {state.contract && <button className="btn btn-sm" disabled={busy} onClick={generateAssertions}>Generate assertions</button>}
          {state.contract && <button className="btn btn-sm" disabled={busy} onClick={removeContract}><IconTrash size={14} /> Delete</button>}
          <button className="btn btn-sm btn-primary" disabled={busy || !hasCompletedResponse} onClick={acceptCurrent}>
            <IconCheck size={14} /> {state.contract ? 'Accept current as new contract' : 'Accept current response'}
          </button>
        </div>
      </div>

      {examples.length > 0 && (
        <div className="border rounded p-4 flex flex-col gap-3">
          <div>
            <strong>Response example sources</strong>
            <div className="text-xs text-muted">Examples are read from the request, but the accepted contract is copied into local intelligence storage.</div>
          </div>
          <div className="flex flex-wrap gap-2">
            {examples.map((example, index) => (
              <button key={example.uid || `${example.name}-${index}`} className="btn btn-sm" disabled={busy} onClick={() => acceptExample(example)}>
                Accept {example.name || `Example ${index + 1}`} · {example.response.status}
              </button>
            ))}
          </div>
        </div>
      )}

      {!state.contract ? (
        <div className="border rounded p-5 flex flex-col gap-2">
          <strong>No accepted contract yet</strong>
          <span className="text-sm text-muted">Run the request successfully, inspect the response, then accept it as the local baseline.</span>
          {!hasCompletedResponse && <span className="text-xs text-muted">No completed HTTP response is available in this tab.</span>}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="border rounded p-3"><div className="text-xs text-muted">Accepted statuses</div><strong>{statuses.join(', ') || 'None'}</strong></div>
            <div className="border rounded p-3"><div className="text-xs text-muted">Local evidence</div><strong>{state.observationCount || 0}</strong></div>
            <div className="border rounded p-3"><div className="text-xs text-muted">Breaking</div><strong>{summary.breaking}</strong></div>
            <div className="border rounded p-3"><div className="text-xs text-muted">Warnings</div><strong>{summary.warnings}</strong></div>
            <div className="border rounded p-3"><div className="text-xs text-muted">Compatible changes</div><strong>{summary.nonBreaking}</strong></div>
          </div>

          <div className="border rounded p-4 flex flex-col gap-2">
            <div className="flex items-center gap-2 font-semibold">
              {state.comparison?.status === 'pass' ? <IconCheck size={16} /> : <IconAlertTriangle size={16} />}
              {comparisonTitle(state.comparison)}
            </div>
            <div className="text-xs text-muted">
              Source: {state.contract.source || 'accepted local contract'} · Scope: {state.contract.environmentScope === 'environment-specific' ? activeEnvironmentName || state.contract.environmentKey : 'all environments'} · Accepted {new Date(state.contract.acceptedAt).toLocaleString()}
              {state.latestObservation?.timestamp ? ` · Latest evidence ${new Date(state.latestObservation.timestamp).toLocaleString()}` : ''}
            </div>
          </div>

          {state.contract.ignoredPaths?.length > 0 && (
            <div className="border rounded p-4 flex flex-col gap-2">
              <strong>Local suppressions</strong>
              <div className="flex flex-wrap gap-2">{state.contract.ignoredPaths.map((path) => <button key={path} className="btn btn-sm" onClick={() => suppressPath(path, false)}>Restore {path}</button>)}</div>
            </div>
          )}

          {state.comparison?.findings?.length > 0 && (
            <div className="border rounded overflow-hidden">
              {state.comparison.findings.map((finding, index) => (
                <div key={`${finding.ruleId}-${finding.path}-${index}`} className="p-3 border-b last:border-b-0 flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold uppercase">{finding.severity}</span>
                    <code className="text-xs">{finding.path}</code>
                  </div>
                  <span className="text-sm">{finding.message}</span>
                  <span className="text-xs text-muted">Expected: {String(finding.expected)} · Actual: {String(finding.actual)}</span>
                  <button className="btn btn-sm self-start" onClick={() => suppressPath(finding.path)}>Ignore this path locally</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ContractGuardian;
