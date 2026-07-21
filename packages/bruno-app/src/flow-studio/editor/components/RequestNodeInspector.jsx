import React, { useEffect, useMemo, useState } from 'react';
import { IconLink, IconPlus, IconRefresh, IconTrash } from '@tabler/icons';
import {
  ALL_BINDING_CHANNELS,
  FLOW_OUTPUT_MIME,
  FLOW_OUTPUT_TEXT_PREFIX,
  removeNodeBinding,
  setNodeBinding,
  updateNode
} from '../model';
import DataTree from './DataTree';
import RequestFieldsEditor from './RequestFieldsEditor';
import { describeRequest } from '../request-shape';

const safeStringify = (value) => {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_) {
    return String(value ?? '');
  }
};

const Select = ({ label, value, options, onChange }) => (
  <label className="flow-inspector-field">
    <span>{label}</span>
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
);

const NumberField = ({ label, value, onCommit }) => {
  const [draft, setDraft] = useState(value ?? 0);
  useEffect(() => setDraft(value ?? 0), [value]);
  return (
    <label className="flow-inspector-field">
      <span>{label}</span>
      <input
        type="number"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => onCommit(Number(draft))}
      />
    </label>
  );
};

const updatePolicy = (flow, nodeId, updates) => updateNode(flow, nodeId, (node) => ({
  ...node,
  policy: { ...node.policy, ...updates }
}));

const updateRetry = (flow, nodeId, updates) => updateNode(flow, nodeId, (node) => ({
  ...node,
  policy: {
    ...node.policy,
    retry: { maxAttempts: 1, backoffMs: 0, strategy: 'fixed', ...node.policy?.retry, ...updates }
  }
}));

const RequestOverview = ({ flow, node, onCommit, requestAsset, requestItem, environmentName }) => {
  const request = useMemo(() => requestItem ? describeRequest(requestItem) : (requestAsset?.requestShape || describeRequest({})), [requestAsset?.requestShape, requestItem]);
  return (
    <div className="flow-request-inspector-content">
      <div className="flow-inspector-reference">
        <span>Collection</span><strong>{requestAsset?.collectionName || 'Current collection'}</strong>
        <span>Request</span><strong>{requestAsset?.breadcrumb ? `${requestAsset.breadcrumb} / ${requestAsset.name}` : requestAsset?.name}</strong>
        <span>Method</span><strong>{request.method || requestAsset?.method || 'REQUEST'}</strong>
        <span>Environment</span><strong>{environmentName || 'No environment'}</strong>
      </div>
      <div className="flow-request-url"><strong>{request.method || 'REQUEST'}</strong><code>{request.url || requestAsset?.itemPathname}</code></div>
      <RequestFieldsEditor flow={flow} node={node} shape={request} onCommit={onCommit} />
      <details><summary>Auth inherited from Bruno</summary><pre>{safeStringify(request.auth)}</pre></details>
      <details><summary>Scripts & tests</summary><pre>{safeStringify({ scripts: request.scripts, tests: request.tests })}</pre></details>
    </div>
  );
};

const ResolvedRequest = ({ preview, previewError, previewing, onPreview, requestAsset }) => (
  <div className="flow-request-inspector-content">
    <div className="flow-request-inspector-actions">
      <button type="button" onClick={onPreview} disabled={previewing}><IconRefresh size={13} /> {previewing ? 'Resolving…' : 'Refresh resolved request'}</button>
    </div>
    {previewError && <div className="flow-run-error">{previewError}</div>}
    {!preview && !previewError && <div className="flow-empty-copy">Resolve this request to inspect the values Bruno will receive for the selected environment and data case.</div>}
    {preview && (
      <>
        <div className="flow-request-url"><strong>{preview.method || requestAsset?.method || 'REQUEST'}</strong><code>{preview.url || requestAsset?.itemPathname}</code></div>
        <details open><summary>Runtime variables</summary><pre>{safeStringify(preview.runtimeVariables || {})}</pre></details>
        <details open><summary>Path parameters</summary><pre>{safeStringify(preview.pathParams || {})}</pre></details>
        <details open><summary>Query</summary><pre>{safeStringify(preview.query || {})}</pre></details>
        <details><summary>Headers</summary><pre>{safeStringify(preview.headers || {})}</pre></details>
        <details open><summary>Body</summary><pre>{safeStringify(preview.body)}</pre></details>
        <details><summary>Resolution provenance</summary><pre>{safeStringify(preview.provenance || {})}</pre></details>
      </>
    )}
  </div>
);

const BindingEditor = ({ flow, node, onCommit }) => {
  const inputs = flow.nodes.filter((candidate) => candidate.id !== node.id && !['start', 'end'].includes(candidate.kind));
  const [channel, setChannel] = useState('runtime');
  const [key, setKey] = useState('');
  const [sourceNodeId, setSourceNodeId] = useState(inputs[0]?.id || '');
  const [sourcePath, setSourcePath] = useState('value');
  useEffect(() => {
    if (!inputs.some((input) => input.id === sourceNodeId)) setSourceNodeId(inputs[0]?.id || '');
  }, [inputs, sourceNodeId]);
  const bindings = ALL_BINDING_CHANNELS.flatMap((bindingChannel) => Object.entries(node.config?.bindings?.[bindingChannel] || {}).map(([bindingKey, binding]) => ({
    channel: bindingChannel,
    key: bindingKey,
    ...binding
  })));
  const readDroppedOutput = (dataTransfer) => {
    const raw = dataTransfer?.getData?.(FLOW_OUTPUT_MIME)
      || String(dataTransfer?.getData?.('text/plain') || '').replace(FLOW_OUTPUT_TEXT_PREFIX, '');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  };
  const dropOutput = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const dropped = readDroppedOutput(event.dataTransfer);
    if (!dropped?.sourceNodeId || !dropped?.sourcePath) return;
    setSourceNodeId(dropped.sourceNodeId);
    setSourcePath(dropped.sourcePath);
  };
  const addBinding = () => {
    if (!key.trim() || !sourceNodeId) return;
    const next = setNodeBinding(flow, {
      targetNodeId: node.id,
      channel,
      key: key.trim(),
      sourceNodeId,
      sourcePath: sourcePath.trim() || 'value'
    });
    onCommit(next, { topology: true, nodeIds: [node.id], dataEdgeIds: next.dataEdges.slice(-1).map((edge) => edge.id) });
    setKey('');
  };
  return (
    <div className="flow-binding-editor">
      <div className="flow-inspector-section-title"><IconLink size={14} /> Input mapping</div>
      <div className="flow-empty-copy">Inject a previous value into a runtime variable, query parameter, header, or JSON body path without modifying the canonical request file.</div>
      {bindings.length === 0 && <div className="flow-empty-copy">No input mappings yet.</div>}
      {bindings.map((binding) => {
        const source = flow.nodes.find((candidate) => candidate.id === binding.sourceNodeId);
        return (
          <div key={`${binding.channel}:${binding.key}`} className="flow-binding-row">
            <span className="flow-binding-channel">{binding.channel}</span>
            <span className="flow-binding-copy"><strong>{binding.key}</strong><small>{source?.name || binding.sourceNodeId}.{binding.sourcePath}</small></span>
            <button type="button" title="Remove binding" onClick={() => onCommit(removeNodeBinding(flow, { targetNodeId: node.id, channel: binding.channel, key: binding.key }), { topology: true, nodeIds: [node.id] })}>
              <IconTrash size={13} />
            </button>
          </div>
        );
      })}
      <div className="flow-binding-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={dropOutput}>
        Drop a response field here to select its source
      </div>
      <div className="flow-binding-form flow-binding-form-expanded">
        <Select
          label="Target"
          value={channel}
          options={[
            { value: 'runtime', label: 'Runtime variable' },
            { value: 'query', label: 'Query parameter' },
            { value: 'header', label: 'Header' },
            { value: 'body', label: 'JSON body path' }
          ]}
          onChange={setChannel}
        />
        <label className="flow-inspector-field"><span>{channel === 'body' ? 'Path' : 'Name'}</span><input value={key} onChange={(event) => setKey(event.target.value)} placeholder={channel === 'body' ? 'customer.id' : (channel === 'runtime' ? 'Runtime variable, e.g. customerId' : 'customerId')} /></label>
        <Select label="Source node" value={sourceNodeId} options={[{ value: '', label: 'Select input' }, ...inputs.map((input) => ({ value: input.id, label: input.name || input.semanticKey }))]} onChange={setSourceNodeId} />
        <label className="flow-inspector-field"><span>Source path</span><input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="value" /></label>
        <button type="button" className="flow-primary-button" disabled={!key.trim() || !sourceNodeId} onClick={addBinding}><IconPlus size={13} /> Add mapping</button>
      </div>
    </div>
  );
};

const ExecutionPolicy = ({ flow, node, onCommit }) => (
  <div className="flow-request-inspector-content">
    <Select
      label="Side effect"
      value={node.policy?.sideEffect || 'once'}
      options={[
        { value: 'none', label: 'No side effect' },
        { value: 'read-only', label: 'Read only' },
        { value: 'idempotent', label: 'Idempotent write' },
        { value: 'once', label: 'Once only' }
      ]}
      onChange={(sideEffect) => onCommit(updatePolicy(flow, node.id, { sideEffect }), { nodeIds: [node.id] })}
    />
    <Select
      label="Resume behavior"
      value={node.policy?.resume || 'reuse'}
      options={[
        { value: 'reuse', label: 'Reuse checkpoint result' },
        { value: 'rerun', label: 'Run again' },
        { value: 'forbid', label: 'Forbid resume' }
      ]}
      onChange={(resume) => onCommit(updatePolicy(flow, node.id, { resume }), { nodeIds: [node.id] })}
    />
    <label className="flow-inspector-field flow-inspector-checkbox"><input type="checkbox" checked={Boolean(node.policy?.allowReplay)} onChange={(event) => onCommit(updatePolicy(flow, node.id, { allowReplay: event.target.checked }), { nodeIds: [node.id] })} /><span>Allow replay of once-only work</span></label>
    <label className="flow-inspector-field flow-inspector-checkbox"><input type="checkbox" checked={Boolean(node.policy?.allowRetry)} onChange={(event) => onCommit(updatePolicy(flow, node.id, { allowRetry: event.target.checked }), { nodeIds: [node.id] })} /><span>Allow retry</span></label>
    <div className="flow-inspector-grid">
      <NumberField label="Max attempts" value={node.policy?.retry?.maxAttempts || 1} onCommit={(maxAttempts) => onCommit(updateRetry(flow, node.id, { maxAttempts }), { nodeIds: [node.id] })} />
      <NumberField label="Backoff (ms)" value={node.policy?.retry?.backoffMs || 0} onCommit={(backoffMs) => onCommit(updateRetry(flow, node.id, { backoffMs }), { nodeIds: [node.id] })} />
    </div>
    <Select
      label="Backoff strategy"
      value={node.policy?.retry?.strategy || 'fixed'}
      options={[
        { value: 'fixed', label: 'Fixed' },
        { value: 'linear', label: 'Linear' },
        { value: 'exponential', label: 'Exponential' }
      ]}
      onChange={(strategy) => onCommit(updateRetry(flow, node.id, { strategy }), { nodeIds: [node.id] })}
    />
  </div>
);

const LastRun = ({ runtimeNode, nodeId }) => {
  const [responseTab, setResponseTab] = useState('body');
  const response = runtimeNode?.result?.response || {};
  return (
    <div className="flow-request-inspector-content">
      {!runtimeNode && <div className="flow-empty-copy">Run the flow, then select this node to inspect its request, response, tests, variables, timing, and errors.</div>}
      {runtimeNode && (
        <>
          <div className="flow-last-run-status"><span>Status</span><strong>{response.status || runtimeNode.status || 'idle'}</strong></div>
          <details><summary>Request sent</summary><pre>{safeStringify(runtimeNode.result?.request || runtimeNode.preview || {})}</pre></details>
          <div className="flow-response-tabs">
            {['body', 'headers', 'meta'].map((tab) => <button key={tab} type="button" className={responseTab === tab ? 'active' : ''} onClick={() => setResponseTab(tab)}>{tab}</button>)}
          </div>
          {responseTab === 'body' && <pre className="flow-response-body">{safeStringify(response.body ?? null)}</pre>}
          {responseTab === 'headers' && <pre className="flow-response-body">{safeStringify(response.headers || {})}</pre>}
          {responseTab === 'meta' && <pre className="flow-response-body">{safeStringify({ status: response.status, statusText: response.statusText, durationMs: runtimeNode.result?.durationMs, size: runtimeNode.result?.size })}</pre>}
          <DataTree value={response.body} sourceNodeId={nodeId} />
          <details><summary>Timeline</summary><pre>{safeStringify(runtimeNode.result?.timeline || {})}</pre></details>
          <details><summary>Tests & assertions</summary><pre>{safeStringify({ tests: runtimeNode.result?.tests, assertions: runtimeNode.result?.assertions })}</pre></details>
          <details><summary>Variable changes</summary><pre>{safeStringify(runtimeNode.result?.variableChanges || runtimeNode.result?.variables || {})}</pre></details>
          <details><summary>Warnings & error</summary><pre>{safeStringify({ warnings: runtimeNode.result?.warnings, error: runtimeNode.result?.error })}</pre></details>
        </>
      )}
    </div>
  );
};

const tabs = [
  ['request', 'Request'],
  ['resolved', 'Resolved'],
  ['mapping', 'Input mapping'],
  ['execution', 'Execution'],
  ['last-run', 'Last run']
];

const RequestNodeInspector = ({
  flow,
  node,
  onCommit,
  requestAsset,
  requestItem,
  environmentName,
  preview,
  previewError,
  previewing,
  onPreview,
  runtimeNode
}) => {
  const [activeTab, setActiveTab] = useState('request');
  useEffect(() => setActiveTab(runtimeNode?.result ? 'last-run' : 'request'), [node.id, runtimeNode?.sequence]);
  return (
    <div className="flow-request-node-inspector">
      <div className="flow-inspector-tabs" role="tablist">
        {tabs.map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? 'active' : ''} onClick={() => setActiveTab(id)}>{label}</button>)}
      </div>
      {activeTab === 'request' && <RequestOverview flow={flow} node={node} onCommit={onCommit} requestAsset={requestAsset} requestItem={requestItem} environmentName={environmentName} />}
      {activeTab === 'resolved' && <ResolvedRequest preview={preview} previewError={previewError} previewing={previewing} onPreview={onPreview} requestAsset={requestAsset} />}
      {activeTab === 'mapping' && <BindingEditor flow={flow} node={node} onCommit={onCommit} />}
      {activeTab === 'execution' && <ExecutionPolicy flow={flow} node={node} onCommit={onCommit} />}
      {activeTab === 'last-run' && <LastRun runtimeNode={runtimeNode} nodeId={node.id} />}
    </div>
  );
};

export default RequestNodeInspector;
