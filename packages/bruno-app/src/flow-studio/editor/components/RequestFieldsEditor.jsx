import React, { useEffect, useMemo, useState } from 'react';
import { IconArrowBackUp, IconBraces, IconLink } from '@tabler/icons';
import {
  FLOW_OUTPUT_MIME,
  FLOW_OUTPUT_TEXT_PREFIX,
  removeNodeBinding,
  removeNodeRequestOverride,
  setNodeBinding,
  setNodeRequestOverride
} from '../model';
import { formatRequestValue, parseEditedRequestValue } from '../request-shape';

const sourcePathForNode = (node) => node?.config?.outputPath || (node?.requestRef ? 'response.body' : 'value');

const readDroppedOutput = (dataTransfer) => {
  const raw = dataTransfer?.getData?.(FLOW_OUTPUT_MIME);
  const text = dataTransfer?.getData?.('text/plain') || '';
  const payload = raw || (text.startsWith(FLOW_OUTPUT_TEXT_PREFIX) ? text.slice(FLOW_OUTPUT_TEXT_PREFIX.length) : '');
  if (!payload) return null;
  try {
    return JSON.parse(payload);
  } catch (_) {
    return null;
  }
};

const canonicalFields = (shape, channel) => {
  if (channel === 'body') return shape.bodyFields || [];
  const source = channel === 'path' ? shape.pathParams : shape[channel] || [];
  return source.map((entry) => ({ key: entry.name, value: entry.value }));
};

const mergedFields = (node, shape, channel) => {
  const defaults = canonicalFields(shape, channel);
  const byKey = new Map(defaults.map((entry) => [entry.key, entry]));
  Object.keys(node?.config?.requestOverrides?.[channel] || {}).forEach((key) => {
    if (!byKey.has(key)) byKey.set(key, { key, value: undefined });
  });
  Object.keys(node?.config?.bindings?.[channel] || {}).forEach((key) => {
    if (!byKey.has(key)) byKey.set(key, { key, value: undefined });
  });
  return [...byKey.values()];
};

const FieldRow = ({ flow, node, channel, field, onCommit }) => {
  const override = node.config?.requestOverrides?.[channel]?.[field.key];
  const hasOverride = Object.prototype.hasOwnProperty.call(node.config?.requestOverrides?.[channel] || {}, field.key);
  const binding = node.config?.bindings?.[channel]?.[field.key];
  const mode = binding ? 'node' : (hasOverride ? 'literal' : 'request');
  const sources = flow.nodes.filter((candidate) => candidate.id !== node.id && !['start', 'end', 'condition', 'fork', 'join', 'delay', 'checkpoint', 'fail'].includes(candidate.kind));
  const [literalDraft, setLiteralDraft] = useState(formatRequestValue(hasOverride ? override : field.value));
  const [sourcePathDraft, setSourcePathDraft] = useState(binding?.sourcePath || 'value');
  useEffect(() => setLiteralDraft(formatRequestValue(hasOverride ? override : field.value)), [field.value, hasOverride, override]);
  useEffect(() => setSourcePathDraft(binding?.sourcePath || 'value'), [binding?.sourcePath]);

  const commitFlow = (next) => onCommit(next, { topology: true, nodeIds: [node.id] });
  const clearField = () => {
    const withoutBinding = removeNodeBinding(flow, { targetNodeId: node.id, channel, key: field.key });
    commitFlow(removeNodeRequestOverride(withoutBinding, { targetNodeId: node.id, channel, key: field.key }));
  };
  const setMode = (nextMode) => {
    if (nextMode === 'request') {
      clearField();
      return;
    }
    if (nextMode === 'literal') {
      commitFlow(setNodeRequestOverride(flow, {
        targetNodeId: node.id,
        channel,
        key: field.key,
        value: hasOverride ? override : field.value
      }));
      return;
    }
    const source = sources[0];
    if (!source) return;
    commitFlow(setNodeBinding(flow, {
      targetNodeId: node.id,
      channel,
      key: field.key,
      sourceNodeId: source.id,
      sourcePath: sourcePathForNode(source)
    }));
  };
  const commitLiteral = () => {
    commitFlow(setNodeRequestOverride(flow, {
      targetNodeId: node.id,
      channel,
      key: field.key,
      value: parseEditedRequestValue(literalDraft, field.value)
    }));
  };
  const setSource = (sourceNodeId, sourcePath = null) => {
    const source = sources.find((candidate) => candidate.id === sourceNodeId);
    if (!source) return;
    commitFlow(setNodeBinding(flow, {
      targetNodeId: node.id,
      channel,
      key: field.key,
      sourceNodeId,
      sourcePath: sourcePath || binding?.sourcePath || sourcePathForNode(source)
    }));
  };
  const drop = (event) => {
    event.preventDefault();
    event.stopPropagation();
    const payload = readDroppedOutput(event.dataTransfer);
    if (!payload?.sourceNodeId || !payload?.sourcePath || payload.sourceNodeId === node.id) return;
    commitFlow(setNodeBinding(flow, {
      targetNodeId: node.id,
      channel,
      key: field.key,
      sourceNodeId: payload.sourceNodeId,
      sourcePath: payload.sourcePath
    }));
  };

  return (
    <div className={`flow-request-field-row flow-request-field-${mode}`} onDragOver={(event) => event.preventDefault()} onDrop={drop}>
      <div className="flow-request-field-name">
        <strong>{field.key}</strong>
        <small>{channel}</small>
      </div>
      <select aria-label={`${channel} ${field.key} source`} value={mode} onChange={(event) => setMode(event.target.value)}>
        <option value="request">Request default</option>
        <option value="literal">Flow value</option>
        <option value="node" disabled={sources.length === 0}>Data node</option>
      </select>
      {mode === 'request' && <code className="flow-request-field-default">{formatRequestValue(field.value) || 'empty'}</code>}
      {mode === 'literal' && (
        <textarea
          aria-label={`${channel} ${field.key} value`}
          value={literalDraft}
          onChange={(event) => setLiteralDraft(event.target.value)}
          onBlur={commitLiteral}
          rows={channel === 'body' ? 2 : 1}
        />
      )}
      {mode === 'node' && (
        <div className="flow-request-field-source">
          <select aria-label={`${channel} ${field.key} data node`} value={binding?.sourceNodeId || ''} onChange={(event) => setSource(event.target.value)}>
            <option value="">Select data node</option>
            {sources.map((source) => <option key={source.id} value={source.id}>{source.name || source.semanticKey}</option>)}
          </select>
          <input
            aria-label={`${channel} ${field.key} source path`}
            value={sourcePathDraft}
            onChange={(event) => setSourcePathDraft(event.target.value)}
            onBlur={() => binding?.sourceNodeId && setSource(binding.sourceNodeId, sourcePathDraft.trim() || 'value')}
          />
        </div>
      )}
      {mode !== 'request' && <button type="button" title={`Reset ${field.key}`} onClick={clearField}><IconArrowBackUp size={13} /></button>}
    </div>
  );
};

const groups = [
  ['path', 'Path parameters'],
  ['query', 'Query parameters'],
  ['header', 'Headers'],
  ['body', 'Body fields']
];

const RequestFieldsEditor = ({ flow, node, shape, onCommit }) => {
  const visibleGroups = useMemo(() => groups.map(([channel, label]) => ({
    channel,
    label,
    fields: mergedFields(node, shape, channel)
  })).filter((group) => group.fields.length > 0), [node, shape]);

  if (!node) return null;

  return (
    <div className="flow-request-fields-editor">
      <div className="flow-request-fields-help"><IconLink size={13} /> Every field can keep the Bruno default, use a flow-local value, or receive data from another node. Drop a response field directly onto a row.</div>
      {visibleGroups.length === 0 && <div className="flow-empty-copy">This request has no path, query, header, or body fields.</div>}
      {visibleGroups.map((group) => (
        <section key={group.channel} className="flow-request-field-group">
          <div className="flow-request-field-group-title"><IconBraces size={13} /> {group.label}<span>{group.fields.length}</span></div>
          {group.fields.map((field) => (
            <FieldRow key={`${group.channel}:${field.key}`} flow={flow} node={node} channel={group.channel} field={field} onCommit={onCommit} />
          ))}
        </section>
      ))}
    </div>
  );
};

export default RequestFieldsEditor;
