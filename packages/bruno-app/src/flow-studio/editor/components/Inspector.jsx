import React, { useEffect, useMemo, useState } from 'react';
import { IconAlertTriangle, IconLink, IconPlus, IconTrash } from '@tabler/icons';
import {
  BINDING_CHANNELS,
  CONTROL_NODE_KINDS,
  DATA_NODE_KINDS,
  INPUT_NODE_KINDS,
  REQUEST_NODE_KINDS,
  findEntity,
  removeNodeBinding,
  setNodeBinding,
  updateControlEdge,
  updateDataEdge,
  updateFormInputNode,
  updateFrame,
  updateNode
} from '../model';
import { getIssuesForEntity } from '../validation';

const Field = ({ label, value, onCommit, multiline = false, type = 'text' }) => {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const commit = () => {
    if (String(draft) !== String(value ?? '')) onCommit(type === 'number' ? Number(draft) : draft);
  };
  return (
    <label className="flow-inspector-field">
      <span>{label}</span>
      {multiline
        ? <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} rows={4} />
        : <input type={type} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} />}
    </label>
  );
};

const SelectField = ({ label, value, options, onCommit }) => (
  <label className="flow-inspector-field">
    <span>{label}</span>
    <select value={value ?? ''} onChange={(event) => onCommit(event.target.value)}>
      {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  </label>
);

const updateConfig = (flow, nodeId, updates) => updateNode(flow, nodeId, (node) => ({
  ...node,
  config: { ...node.config, ...updates }
}));

const updatePolicy = (flow, nodeId, updates) => updateNode(flow, nodeId, (node) => ({
  ...node,
  policy: { ...node.policy, ...updates }
}));

const updateRetryPolicy = (flow, nodeId, updates) => updateNode(flow, nodeId, (node) => ({
  ...node,
  policy: {
    ...node.policy,
    retry: { maxAttempts: 1, backoffMs: 0, strategy: 'fixed', ...node.policy?.retry, ...updates }
  }
}));

const CheckboxField = ({ label, checked, onCommit }) => (
  <label className="flow-inspector-field flow-inspector-checkbox">
    <input type="checkbox" checked={Boolean(checked)} onChange={(event) => onCommit(event.target.checked)} />
    <span>{label}</span>
  </label>
);

const BindingEditor = ({ flow, node, onCommit }) => {
  const inputs = flow.nodes.filter((candidate) => DATA_NODE_KINDS.has(candidate.kind));
  const [channel, setChannel] = useState('body');
  const [key, setKey] = useState('');
  const [sourceNodeId, setSourceNodeId] = useState(inputs[0]?.id || '');
  const [sourcePath, setSourcePath] = useState('value');
  useEffect(() => {
    if (!inputs.some((input) => input.id === sourceNodeId)) setSourceNodeId(inputs[0]?.id || '');
  }, [inputs, sourceNodeId]);

  const bindings = BINDING_CHANNELS.flatMap((bindingChannel) => Object.entries(node.config?.bindings?.[bindingChannel] || {}).map(([bindingKey, binding]) => ({
    channel: bindingChannel,
    key: bindingKey,
    ...binding
  })));

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
      <div className="flow-inspector-section-title"><IconLink size={14} /> Data bindings</div>
      {bindings.length === 0 && <div className="flow-empty-copy">Connect an input node or add a binding below.</div>}
      {bindings.map((binding) => {
        const source = flow.nodes.find((candidate) => candidate.id === binding.sourceNodeId);
        return (
          <div key={`${binding.channel}:${binding.key}`} className="flow-binding-row">
            <span className="flow-binding-channel">{binding.channel}</span>
            <span className="flow-binding-copy"><strong>{binding.key}</strong><small>{source?.name || binding.sourceNodeId}.{binding.sourcePath}</small></span>
            <button
              type="button"
              title="Remove binding"
              onClick={() => onCommit(removeNodeBinding(flow, { targetNodeId: node.id, channel: binding.channel, key: binding.key }), { topology: true, nodeIds: [node.id] })}
            >
              <IconTrash size={13} />
            </button>
          </div>
        );
      })}
      <div className="flow-binding-form">
        <select value={channel} onChange={(event) => setChannel(event.target.value)}>
          {BINDING_CHANNELS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <input value={key} onChange={(event) => setKey(event.target.value)} placeholder={channel === 'header' ? 'Authorization' : 'customerId'} />
        <select value={sourceNodeId} onChange={(event) => setSourceNodeId(event.target.value)}>
          <option value="">Select input</option>
          {inputs.map((input) => <option key={input.id} value={input.id}>{input.name || input.semanticKey}</option>)}
        </select>
        <input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="value" />
        <button type="button" className="flow-primary-button" disabled={!key.trim() || !sourceNodeId} onClick={addBinding}>
          <IconPlus size={13} /> Add binding
        </button>
      </div>
    </div>
  );
};

const Inspector = ({ flow, selection, validation, onCommit }) => {
  const entity = useMemo(() => findEntity(flow, selection), [flow, selection]);
  const issues = entity.value ? getIssuesForEntity(validation, entity.value.id) : [];

  if (!entity.value) {
    return (
      <aside className="flow-inspector">
        <div className="flow-panel-heading">Inspector</div>
        <div className="flow-empty-copy flow-inspector-empty">Select a node, edge, or frame to edit it.</div>
      </aside>
    );
  }

  const value = entity.value;
  return (
    <aside className="flow-inspector">
      <div className="flow-panel-heading">Inspector</div>
      <div className="flow-inspector-kind">{entity.type}</div>
      {issues.length > 0 && (
        <div className="flow-inspector-issues">
          {issues.map((issue, index) => <div key={`${issue.path}-${index}`}><IconAlertTriangle size={13} /> {issue.message}</div>)}
        </div>
      )}

      {entity.type === 'node' && (
        <>
          <Field
            label="Name"
            value={value.name || ''}
            onCommit={(name) => onCommit(
              value.kind === 'form-input'
                ? updateFormInputNode(flow, value.id, { name })
                : updateNode(flow, value.id, { name }),
              { nodeIds: [value.id] }
            )}
          />
          <Field label="Semantic key" value={value.semanticKey} onCommit={(semanticKey) => onCommit(updateNode(flow, value.id, { semanticKey }), { identity: true, nodeIds: [value.id] })} />
          <Field label="Kind" value={value.kind} onCommit={() => {}} />
          {value.requestRef && (
            <div className="flow-inspector-reference">
              <span>Collection</span><strong>{value.requestRef.collectionPath}</strong>
              <span>Request</span><strong>{value.requestRef.itemPathname}</strong>
              <span>Method</span><strong>{value.requestRef.expectedMethod || value.kind}</strong>
            </div>
          )}
          {(INPUT_NODE_KINDS.has(value.kind) || value.kind === 'secret-reference') && (
            <>
              <Field label="Output path" value={value.config?.outputPath || 'value'} onCommit={(outputPath) => onCommit(updateNode(flow, value.id, (node) => ({ ...node, config: { ...node.config, outputPath } })), { nodeIds: [value.id] })} />
              {value.kind === 'static-input' && <Field multiline label="Value" value={value.config?.value || ''} onCommit={(inputValue) => onCommit(updateNode(flow, value.id, (node) => ({ ...node, config: { ...node.config, value: inputValue } })), { nodeIds: [value.id] })} />}
              {(value.kind === 'environment-input' || value.kind === 'secret-reference') && <Field label="Variable" value={value.config?.variable || ''} onCommit={(variable) => onCommit(updateNode(flow, value.id, (node) => ({ ...node, config: { ...node.config, variable } })), { nodeIds: [value.id] })} />}
              {value.kind === 'dataset-input' && <Field label="Dataset path" value={value.config?.datasetPath || ''} onCommit={(datasetPath) => onCommit(updateNode(flow, value.id, (node) => ({ ...node, config: { ...node.config, datasetPath } })), { nodeIds: [value.id] })} />}
              {value.kind === 'form-input' && (
                <>
                  <Field label="Field name" value={value.config?.fieldName || ''} onCommit={(fieldName) => onCommit(updateFormInputNode(flow, value.id, { fieldName }), { nodeIds: [value.id] })} />
                  <SelectField
                    label="Input type"
                    value={value.config?.inputType || 'string'}
                    options={['string', 'number', 'integer', 'boolean'].map((inputType) => ({ value: inputType, label: inputType }))}
                    onCommit={(inputType) => onCommit(updateFormInputNode(flow, value.id, { inputType }), { nodeIds: [value.id] })}
                  />
                  <CheckboxField label="Required" checked={value.config?.required} onCommit={(required) => onCommit(updateFormInputNode(flow, value.id, { required }), { nodeIds: [value.id] })} />
                </>
              )}
              <CheckboxField
                label="Secret taint"
                checked={value.config?.secret || value.kind === 'secret-reference'}
                onCommit={(secret) => onCommit(
                  value.kind === 'form-input'
                    ? updateFormInputNode(flow, value.id, { secret })
                    : updateNode(flow, value.id, (node) => ({ ...node, config: { ...node.config, secret } })),
                  { nodeIds: [value.id] }
                )}
              />
            </>
          )}
          {value.kind === 'response-extractor' && (
            <>
              <SelectField
                label="Source request"
                value={value.config?.sourceNodeId || ''}
                options={[
                  { value: '', label: 'Select request' },
                  ...flow.nodes.filter((node) => REQUEST_NODE_KINDS.has(node.kind)).map((node) => ({ value: node.id, label: node.name || node.semanticKey }))
                ]}
                onCommit={(sourceNodeId) => onCommit(updateNode(flow, value.id, (node) => ({ ...node, config: { ...node.config, sourceNodeId } })), { nodeIds: [value.id] })}
              />
              <Field label="Response source" value={value.config?.sourcePath || 'response.body'} onCommit={(sourcePath) => onCommit(updateNode(flow, value.id, (node) => ({ ...node, config: { ...node.config, sourcePath } })), { nodeIds: [value.id] })} />
              <Field label="Extract path" value={value.config?.path || ''} onCommit={(path) => onCommit(updateNode(flow, value.id, (node) => ({ ...node, config: { ...node.config, path } })), { nodeIds: [value.id] })} />
              <Field label="Output path" value={value.config?.outputPath || 'value'} onCommit={(outputPath) => onCommit(updateNode(flow, value.id, (node) => ({ ...node, config: { ...node.config, outputPath } })), { nodeIds: [value.id] })} />
              <CheckboxField label="Secret taint" checked={value.config?.secret} onCommit={(secret) => onCommit(updateNode(flow, value.id, (node) => ({ ...node, config: { ...node.config, secret } })), { nodeIds: [value.id] })} />
            </>
          )}
          {CONTROL_NODE_KINDS.has(value.kind) && value.kind === 'condition' && (
            <Field
              label="Expression"
              multiline
              value={value.config?.expression || ''}
              onCommit={(expression) => onCommit(updateConfig(flow, value.id, { expression }), { nodeIds: [value.id] })}
            />
          )}
          {value.kind === 'fork' && (
            <>
              <SelectField
                label="Join node"
                value={value.config?.joinNodeId || ''}
                options={[
                  { value: '', label: 'Select join' },
                  ...flow.nodes.filter((node) => node.kind === 'join').map((node) => ({ value: node.id, label: node.name || node.semanticKey }))
                ]}
                onCommit={(joinNodeId) => onCommit(updateConfig(flow, value.id, { joinNodeId }), { topology: true, nodeIds: [value.id] })}
              />
              <Field type="number" label="Branch handles" value={value.config?.branchCount || 2} onCommit={(branchCount) => onCommit(updateConfig(flow, value.id, { branchCount: Math.max(2, Math.min(8, branchCount)) }), { nodeIds: [value.id] })} />
            </>
          )}
          {value.kind === 'join' && (
            <>
              <SelectField
                label="Join mode"
                value={value.config?.mode || 'all'}
                options={[
                  { value: 'all', label: 'All branches' },
                  { value: 'any', label: 'Any successful branch' },
                  { value: 'quorum', label: 'Quorum' },
                  { value: 'all-settled', label: 'All settled' }
                ]}
                onCommit={(mode) => onCommit(updateConfig(flow, value.id, { mode }), { nodeIds: [value.id] })}
              />
              {value.config?.mode === 'quorum' && (
                <Field type="number" label="Quorum" value={value.config?.quorum || 2} onCommit={(quorum) => onCommit(updateConfig(flow, value.id, { quorum }), { nodeIds: [value.id] })} />
              )}
              <SelectField
                label="Branch merge"
                value={value.config?.merge || 'last-branch-wins'}
                options={[
                  { value: 'last-branch-wins', label: 'Last branch wins' },
                  { value: 'first-branch-wins', label: 'First branch wins' },
                  { value: 'error-on-conflict', label: 'Error on conflict' }
                ]}
                onCommit={(merge) => onCommit(updateConfig(flow, value.id, { merge }), { nodeIds: [value.id] })}
              />
            </>
          )}
          {value.kind === 'delay' && (
            <Field type="number" label="Delay (ms)" value={value.config?.milliseconds || 0} onCommit={(milliseconds) => onCommit(updateConfig(flow, value.id, { milliseconds }), { nodeIds: [value.id] })} />
          )}
          {value.kind === 'subflow' && (
            <>
              <Field label="Flow relative path" value={value.config?.relativePath || ''} onCommit={(relativePath) => onCommit(updateConfig(flow, value.id, { relativePath }), { nodeIds: [value.id] })} />
              <Field label="Flow UID fallback" value={value.config?.flowUid || ''} onCommit={(flowUid) => onCommit(updateConfig(flow, value.id, { flowUid }), { nodeIds: [value.id] })} />
              <SelectField
                label="Dataset mode"
                value={value.config?.datasetMode || 'single'}
                options={[
                  { value: 'single', label: 'Single invocation' },
                  { value: 'for-each', label: 'For each row' }
                ]}
                onCommit={(datasetMode) => onCommit(updateConfig(flow, value.id, { datasetMode }), { nodeIds: [value.id] })}
              />
              {value.config?.datasetMode === 'for-each' && (
                <>
                  <Field label="Dataset path" value={value.config?.datasetPath || ''} onCommit={(datasetPath) => onCommit(updateConfig(flow, value.id, { datasetPath }), { nodeIds: [value.id] })} />
                  <div className="flow-inspector-grid">
                    <Field type="number" label="Max rows" value={value.config?.maxItems || 20} onCommit={(maxItems) => onCommit(updateConfig(flow, value.id, { maxItems }), { nodeIds: [value.id] })} />
                    <Field type="number" label="Concurrency" value={value.config?.concurrency || 4} onCommit={(concurrency) => onCommit(updateConfig(flow, value.id, { concurrency }), { nodeIds: [value.id] })} />
                  </div>
                </>
              )}
            </>
          )}
          {value.kind === 'checkpoint' && (
            <SelectField
              label="Checkpoint mode"
              value={value.config?.mode || 'pause'}
              options={[
                { value: 'pause', label: 'Save and pause' },
                { value: 'snapshot', label: 'Save and continue' }
              ]}
              onCommit={(mode) => onCommit(updateConfig(flow, value.id, { mode }), { nodeIds: [value.id] })}
            />
          )}
          {value.kind === 'fail' && (
            <>
              <Field label="Failure code" value={value.config?.code || 'FLOW_FAILED'} onCommit={(code) => onCommit(updateConfig(flow, value.id, { code }), { nodeIds: [value.id] })} />
              <Field multiline label="Failure message" value={value.config?.message || ''} onCommit={(message) => onCommit(updateConfig(flow, value.id, { message }), { nodeIds: [value.id] })} />
            </>
          )}
          {value.kind === 'merge' && (
            <>
              <SelectField
                label="Merge strategy"
                value={value.config?.strategy || 'last-write-wins'}
                options={[
                  { value: 'last-write-wins', label: 'Last write wins' },
                  { value: 'first-write-wins', label: 'First write wins' }
                ]}
                onCommit={(strategy) => onCommit(updateNode(flow, value.id, (node) => ({ ...node, config: { ...node.config, strategy } })), { nodeIds: [value.id] })}
              />
              <Field label="Output path" value={value.config?.outputPath || 'value'} onCommit={(outputPath) => onCommit(updateNode(flow, value.id, (node) => ({ ...node, config: { ...node.config, outputPath } })), { nodeIds: [value.id] })} />
            </>
          )}
          {(REQUEST_NODE_KINDS.has(value.kind) || ['subflow', 'delay', 'fail'].includes(value.kind)) && (
            <>
              <div className="flow-inspector-section-title">Execution policy</div>
              <SelectField
                label="Side effect"
                value={value.policy?.sideEffect || (REQUEST_NODE_KINDS.has(value.kind) || value.kind === 'subflow' ? 'once' : 'none')}
                options={[
                  { value: 'none', label: 'No side effect' },
                  { value: 'read-only', label: 'Read only' },
                  { value: 'idempotent', label: 'Idempotent write' },
                  { value: 'once', label: 'Once only' }
                ]}
                onCommit={(sideEffect) => onCommit(updatePolicy(flow, value.id, { sideEffect }), { nodeIds: [value.id] })}
              />
              <SelectField
                label="Resume behavior"
                value={value.policy?.resume || 'reuse'}
                options={[
                  { value: 'reuse', label: 'Reuse checkpoint result' },
                  { value: 'rerun', label: 'Run again' },
                  { value: 'forbid', label: 'Forbid resume' }
                ]}
                onCommit={(resume) => onCommit(updatePolicy(flow, value.id, { resume }), { nodeIds: [value.id] })}
              />
              <CheckboxField label="Allow replay of once-only work" checked={value.policy?.allowReplay} onCommit={(allowReplay) => onCommit(updatePolicy(flow, value.id, { allowReplay }), { nodeIds: [value.id] })} />
              <CheckboxField label="Allow retry" checked={value.policy?.allowRetry} onCommit={(allowRetry) => onCommit(updatePolicy(flow, value.id, { allowRetry }), { nodeIds: [value.id] })} />
              <div className="flow-inspector-grid">
                <Field type="number" label="Max attempts" value={value.policy?.retry?.maxAttempts || 1} onCommit={(maxAttempts) => onCommit(updateRetryPolicy(flow, value.id, { maxAttempts }), { nodeIds: [value.id] })} />
                <Field type="number" label="Backoff (ms)" value={value.policy?.retry?.backoffMs || 0} onCommit={(backoffMs) => onCommit(updateRetryPolicy(flow, value.id, { backoffMs }), { nodeIds: [value.id] })} />
              </div>
              <SelectField
                label="Backoff strategy"
                value={value.policy?.retry?.strategy || 'fixed'}
                options={[
                  { value: 'fixed', label: 'Fixed' },
                  { value: 'linear', label: 'Linear' },
                  { value: 'exponential', label: 'Exponential' }
                ]}
                onCommit={(strategy) => onCommit(updateRetryPolicy(flow, value.id, { strategy }), { nodeIds: [value.id] })}
              />
            </>
          )}
          {REQUEST_NODE_KINDS.has(value.kind) && <BindingEditor flow={flow} node={value} onCommit={onCommit} />}
        </>
      )}

      {entity.type === 'frame' && (
        <>
          <Field label="Name" value={value.name} onCommit={(name) => onCommit(updateFrame(flow, value.id, { name }), { frameIds: [value.id] })} />
          <div className="flow-inspector-grid">
            <Field type="number" label="Width" value={value.size.width} onCommit={(width) => onCommit(updateFrame(flow, value.id, { size: { ...value.size, width } }), { frameIds: [value.id] })} />
            <Field type="number" label="Height" value={value.size.height} onCommit={(height) => onCommit(updateFrame(flow, value.id, { size: { ...value.size, height } }), { frameIds: [value.id] })} />
          </div>
        </>
      )}

      {entity.type === 'control-edge' && (
        <>
          <SelectField
            label="Route port"
            value={value.sourcePort || 'control-out'}
            options={[
              { value: 'control-out', label: 'Success / default' },
              { value: 'true', label: 'Condition true' },
              { value: 'false', label: 'Condition false' },
              { value: 'failure', label: 'Failure route' },
              ...Array.from({ length: 8 }, (_, index) => ({ value: `branch-${index}`, label: `Fork branch ${index + 1}` })),
              { value: 'default', label: 'Condition fallback' }
            ]}
            onCommit={(sourcePort) => onCommit(updateControlEdge(flow, value.id, { sourcePort }), { topology: true, controlEdgeIds: [value.id] })}
          />
          <Field label="Label" value={value.label || ''} onCommit={(label) => onCommit(updateControlEdge(flow, value.id, { label }), { controlEdgeIds: [value.id] })} />
          <Field label="Condition" multiline value={value.condition || ''} onCommit={(condition) => onCommit(updateControlEdge(flow, value.id, { condition }), { controlEdgeIds: [value.id] })} />
        </>
      )}

      {entity.type === 'data-edge' && (
        <>
          <Field label="Source path" value={value.source.path} onCommit={(path) => onCommit(updateDataEdge(flow, value.id, { source: { path } }), { dataEdgeIds: [value.id] })} />
          <Field label="Target path" value={value.target.path} onCommit={(path) => onCommit(updateDataEdge(flow, value.id, { target: { path } }), { dataEdgeIds: [value.id] })} />
          <Field label="Transform" multiline value={value.transform || ''} onCommit={(transform) => onCommit(updateDataEdge(flow, value.id, { transform }), { dataEdgeIds: [value.id] })} />
        </>
      )}
    </aside>
  );
};

export default Inspector;
