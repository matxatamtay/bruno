import React, { useEffect, useState } from 'react';
import { IconArrowBarToDown, IconArrowBarUp, IconPlus, IconTrash } from '@tabler/icons';
import {
  FLOW_OUTPUT_MIME,
  FLOW_OUTPUT_TEXT_PREFIX,
  getFlowOutputDefinitions,
  removeDataMapping,
  removeFlowOutput,
  setDataMapping,
  upsertFlowOutput
} from '../model';

const schemaDefinitions = (schema = {}) => {
  const required = new Set(schema.required || []);
  return Object.entries(schema.properties || {}).map(([name, definition]) => ({
    name,
    type: definition.type || 'string',
    title: definition.title || name,
    required: required.has(name),
    secret: Boolean(definition.writeOnly)
  }));
};

const inputDefinitions = (flow) => schemaDefinitions(flow?.inputSchema);

const FlowContractEditor = ({ flow, node, onCommit }) => {
  const inputs = inputDefinitions(flow);
  const subflowInputs = schemaDefinitions(node.config?.inputSchema);
  const subflowOutputs = schemaDefinitions(node.config?.outputSchema);
  const outputs = getFlowOutputDefinitions(flow);
  const sourceNodes = flow.nodes.filter((candidate) => !['start', 'end'].includes(candidate.kind));
  const [name, setName] = useState('');
  const [type, setType] = useState('string');
  const [sourceNodeId, setSourceNodeId] = useState(sourceNodes[0]?.id || '');
  const [sourcePath, setSourcePath] = useState('response.body');
  const [required, setRequired] = useState(true);
  const [secret, setSecret] = useState(false);
  useEffect(() => {
    if (!sourceNodes.some((candidate) => candidate.id === sourceNodeId)) setSourceNodeId(sourceNodes[0]?.id || '');
  }, [sourceNodes, sourceNodeId]);

  if (node.kind === 'start') {
    return (
      <div className="flow-contract-editor">
        <div className="flow-inspector-section-title"><IconArrowBarToDown size={14} /> Flow inputs</div>
        {inputs.length === 0 && <div className="flow-empty-copy">Add Form input nodes to declare the reusable flow contract.</div>}
        {inputs.map((input) => (
          <div key={input.name} className="flow-contract-row">
            <strong>{input.name}</strong>
            <span>{input.type}{input.required ? ' · required' : ''}{input.secret ? ' · secret' : ''}</span>
          </div>
        ))}
      </div>
    );
  }

  const dropSource = (event) => {
    event.preventDefault();
    const custom = event.dataTransfer?.getData?.(FLOW_OUTPUT_MIME);
    const text = event.dataTransfer?.getData?.('text/plain') || '';
    const raw = custom || (text.startsWith(FLOW_OUTPUT_TEXT_PREFIX) ? text.slice(FLOW_OUTPUT_TEXT_PREFIX.length) : '');
    if (!raw) return;
    try {
      const dropped = JSON.parse(raw);
      if (dropped.sourceNodeId && dropped.sourcePath) {
        setSourceNodeId(dropped.sourceNodeId);
        setSourcePath(dropped.sourcePath);
        if (!name) setName(String(dropped.sourcePath).split('.').at(-1).replace(/\W+/g, '_'));
      }
    } catch (_) {
      // Ignore foreign drag payloads.
    }
  };
  if (node.kind === 'subflow') {
    const mappings = flow.dataEdges.filter((edge) => edge.target.nodeId === node.id && edge.target.path.startsWith('subflow.input.'));
    const selectedInput = subflowInputs.find((input) => input.name === name);
    const addInput = () => {
      if (!name.trim() || !sourceNodeId) return;
      const targetPath = `subflow.input.${name.trim()}`;
      onCommit(setDataMapping(flow, {
        targetNodeId: node.id,
        targetPath,
        sourceNodeId,
        sourcePath: sourcePath.trim() || 'value',
        required: selectedInput?.required ?? required
      }), { topology: true, nodeIds: [node.id] });
      setName('');
    };
    return (
      <div className="flow-contract-editor">
        <div className="flow-inspector-section-title"><IconArrowBarToDown size={14} /> Subflow contract</div>
        <div className="flow-empty-copy">Map parent values into the child flow inputs. Child outputs are exposed under <code>outputs.*</code> from its End contract.</div>
        {subflowInputs.length > 0 && (
          <details className="flow-contract-details" open>
            <summary>Declared inputs</summary>
            {subflowInputs.map((input) => <div key={input.name}><strong>{input.name}</strong><span>{input.type}{input.required ? ' · required' : ''}{input.secret ? ' · secret' : ''}</span></div>)}
          </details>
        )}
        {subflowOutputs.length > 0 && (
          <details className="flow-contract-details">
            <summary>Declared outputs</summary>
            {subflowOutputs.map((output) => <div key={output.name}><strong>{output.name}</strong><span>{output.type}{output.required ? ' · required' : ''}{output.secret ? ' · secret' : ''}</span></div>)}
          </details>
        )}
        {mappings.length === 0 && <div className="flow-empty-copy">No subflow inputs mapped yet.</div>}
        {mappings.map((edge) => {
          const inputName = edge.target.path.slice('subflow.input.'.length);
          return (
            <div key={edge.id} className="flow-contract-row flow-contract-output-row">
              <span><strong>{inputName}</strong><small>{edge.required ? 'required' : 'optional'}</small></span>
              <code>{edge.source.nodeId}.{edge.source.path}</code>
              <button type="button" title="Remove subflow input" onClick={() => onCommit(removeDataMapping(flow, { targetNodeId: node.id, targetPath: edge.target.path }), { topology: true, nodeIds: [node.id] })}><IconTrash size={13} /></button>
            </div>
          );
        })}
        <div className="flow-binding-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={dropSource}>Drop a response field here to use it as a subflow input</div>
        <div className="flow-output-contract-form">
          <label className="flow-inspector-field"><span>Input name</span>{subflowInputs.length > 0
            ? <select value={name} onChange={(event) => setName(event.target.value)}><option value="">Select declared input</option>{subflowInputs.map((input) => <option key={input.name} value={input.name}>{input.name}{input.required ? ' *' : ''}</option>)}</select>
            : <input value={name} onChange={(event) => setName(event.target.value)} placeholder="email" />}
          </label>
          <label className="flow-inspector-field"><span>Source node</span><select value={sourceNodeId} onChange={(event) => setSourceNodeId(event.target.value)}><option value="">Select node</option>{sourceNodes.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name || candidate.semanticKey}</option>)}</select></label>
          <label className="flow-inspector-field"><span>Source path</span><input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="value" /></label>
          {subflowInputs.length === 0 && <label className="flow-inspector-field flow-inspector-checkbox"><input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} /><span>Required</span></label>}
          <button type="button" className="flow-primary-button" disabled={!name.trim() || !sourceNodeId} onClick={addInput}><IconPlus size={13} /> Map subflow input</button>
        </div>
      </div>
    );
  }

  if (node.kind !== 'end') return null;
  const addOutput = () => {
    if (!name.trim() || !sourceNodeId) return;
    onCommit(upsertFlowOutput(flow, {
      name: name.trim(), type, sourceNodeId, sourcePath: sourcePath.trim() || 'response.body', required, secret
    }), { topology: true, nodeIds: [node.id] });
    setName('');
  };
  return (
    <div className="flow-contract-editor">
      <div className="flow-inspector-section-title"><IconArrowBarUp size={14} /> Flow outputs</div>
      <div className="flow-empty-copy">Outputs form the public contract of reusable subflows. Map each one to a node result.</div>
      {outputs.length === 0 && <div className="flow-empty-copy">No outputs declared yet.</div>}
      {outputs.map((output) => (
        <div key={output.name} className="flow-contract-row flow-contract-output-row">
          <span><strong>{output.name}</strong><small>{output.type}{output.required ? ' · required' : ''}</small></span>
          <code>{output.sourceNodeId}.{output.sourcePath}</code>
          <button type="button" title="Remove flow output" onClick={() => onCommit(removeFlowOutput(flow, output.name), { topology: true, nodeIds: [node.id] })}><IconTrash size={13} /></button>
        </div>
      ))}
      <div className="flow-binding-dropzone" onDragOver={(event) => event.preventDefault()} onDrop={dropSource}>Drop a response field here to publish it as a flow output</div>
      <div className="flow-output-contract-form">
        <label className="flow-inspector-field"><span>Output name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="accessToken" /></label>
        <label className="flow-inspector-field"><span>Type</span><select value={type} onChange={(event) => setType(event.target.value)}><option value="string">String</option><option value="number">Number</option><option value="integer">Integer</option><option value="boolean">Boolean</option><option value="object">Object</option><option value="array">Array</option></select></label>
        <label className="flow-inspector-field"><span>Source node</span><select value={sourceNodeId} onChange={(event) => setSourceNodeId(event.target.value)}><option value="">Select node</option>{sourceNodes.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name || candidate.semanticKey}</option>)}</select></label>
        <label className="flow-inspector-field"><span>Source path</span><input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="response.body.data.token" /></label>
        <label className="flow-inspector-field flow-inspector-checkbox"><input type="checkbox" checked={required} onChange={(event) => setRequired(event.target.checked)} /><span>Required</span></label>
        <label className="flow-inspector-field flow-inspector-checkbox"><input type="checkbox" checked={secret} onChange={(event) => setSecret(event.target.checked)} /><span>Secret</span></label>
        <button type="button" className="flow-primary-button" disabled={!name.trim() || !sourceNodeId} onClick={addOutput}><IconPlus size={13} /> Publish output</button>
      </div>
    </div>
  );
};

export default FlowContractEditor;
