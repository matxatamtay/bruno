import React, { useEffect, useState } from 'react';
import { IconPlus, IconTrash } from '@tabler/icons';
import { createEntityId, updateNode } from '../model';
import { formatRequestValue, parseEditedRequestValue } from '../request-shape';

const updateDynamicNode = (flow, nodeId, updater) => updateNode(flow, nodeId, (node) => ({
  ...node,
  config: {
    ...node.config,
    ...updater(node.config || {})
  }
}));

const DynamicOptionRow = ({ flow, node, option, selected, onCommit }) => {
  const [label, setLabel] = useState(option.label || 'Case');
  const [value, setValue] = useState(formatRequestValue(option.value));
  useEffect(() => setLabel(option.label || 'Case'), [option.label]);
  useEffect(() => setValue(formatRequestValue(option.value)), [option.value]);
  const commit = (updates) => onCommit(updateDynamicNode(flow, node.id, (config) => ({
    options: (config.options || []).map((candidate) => candidate.id === option.id ? { ...candidate, ...updates } : candidate)
  })), { nodeIds: [node.id] });
  return (
    <div className={`flow-dynamic-option-row ${selected ? 'selected' : ''}`}>
      <input
        type="radio"
        name={`dynamic-option-${node.id}`}
        checked={selected}
        onChange={() => onCommit(updateDynamicNode(flow, node.id, () => ({ selectedOptionId: option.id })), { nodeIds: [node.id] })}
        aria-label={`Select ${option.label}`}
      />
      <div>
        <input value={label} onChange={(event) => setLabel(event.target.value)} onBlur={() => commit({ label: label.trim() || 'Case' })} aria-label="Case label" />
        <textarea value={value} onChange={(event) => setValue(event.target.value)} onBlur={() => commit({ value: parseEditedRequestValue(value, option.value) })} rows={2} aria-label={`${option.label} value`} />
      </div>
      <button
        type="button"
        title={`Delete ${option.label}`}
        onClick={() => onCommit(updateDynamicNode(flow, node.id, (config) => {
          const options = (config.options || []).filter((candidate) => candidate.id !== option.id);
          return {
            options,
            selectedOptionId: config.selectedOptionId === option.id ? (options[0]?.id || '') : config.selectedOptionId
          };
        }), { nodeIds: [node.id] })}
      >
        <IconTrash size={13} />
      </button>
    </div>
  );
};

const DynamicDataEditor = ({ flow, node, onCommit }) => {
  const options = Array.isArray(node.config?.options) ? node.config.options : [];
  const selectedId = node.config?.selectedOptionId || options[0]?.id || '';
  const addOption = () => {
    const option = { id: createEntityId('option'), label: `Case ${options.length + 1}`, value: {} };
    onCommit(updateDynamicNode(flow, node.id, (config) => ({
      options: [...(config.options || []), option],
      selectedOptionId: config.selectedOptionId || option.id
    })), { nodeIds: [node.id] });
  };
  return (
    <div className="flow-dynamic-editor">
      <div className="flow-inspector-section-title">Dynamic data cases</div>
      <div className="flow-empty-copy">These options appear directly on the canvas. Clicking one changes the value injected into every connected request preview and run.</div>
      {options.map((option) => (
        <DynamicOptionRow key={option.id} flow={flow} node={node} option={option} selected={selectedId === option.id} onCommit={onCommit} />
      ))}
      <button type="button" className="flow-primary-button flow-dynamic-add" onClick={addOption}><IconPlus size={13} /> Add case</button>
    </div>
  );
};

export default DynamicDataEditor;
