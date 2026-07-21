import React, { memo } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import { IconAlertTriangle, IconBraces, IconDatabase, IconGitBranch, IconPlayerPlay, IconSquare, IconWorld } from '@tabler/icons';
import { formatRequestValue } from '../request-shape';

const NodeShell = ({ children, issueCount, searchMatch, runtime, className = '' }) => {
  const runtimeStatus = runtime?.status || 'idle';
  return (
    <div
      className={`flow-node-shell ${searchMatch ? 'flow-node-search-match' : ''} ${issueCount ? 'flow-node-invalid' : ''} flow-node-runtime-${runtimeStatus} ${className}`}
      data-runtime-status={runtimeStatus}
    >
      {children}
      {runtimeStatus !== 'idle' && <span className={`flow-node-runtime-chip flow-node-runtime-chip-${runtimeStatus}`}>{runtimeStatus}</span>}
      {issueCount > 0 && (
        <span className="flow-node-issue" title={`${issueCount} validation issue(s)`}>
          <IconAlertTriangle size={13} strokeWidth={1.8} /> {issueCount}
        </span>
      )}
    </div>
  );
};

const ROOT_PATH = String.fromCharCode(36);

const readPath = (value, path) => {
  const normalized = String(path || 'value').replace(/^value(?:\.|$)/, '');
  if (!normalized) return value;
  return normalized.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).reduce((current, part) => current?.[part], value);
};

const selectedDynamicValue = (flow, sourceNodeId, sourcePath) => {
  const source = flow?.nodes?.find((candidate) => candidate.id === sourceNodeId);
  if (source?.kind !== 'dynamic-data') return null;
  const options = Array.isArray(source.config?.options) ? source.config.options : [];
  const selected = options.find((option) => option.id === source.config?.selectedOptionId) || options[0];
  return selected ? { label: selected.label, value: readPath(selected.value, sourcePath) } : null;
};

const compactRequestFields = (shape) => [
  ...(shape?.pathParams || []).map((field) => ({ channel: 'path', key: field.name, value: field.value })),
  ...(shape?.query || []).map((field) => ({ channel: 'query', key: field.name, value: field.value })),
  ...(shape?.bodyFields || []).filter((field) => field.key !== ROOT_PATH).map((field) => ({ channel: 'body', key: field.key, value: field.value }))
];

export const FlowRequestNode = memo(({ data }) => {
  const node = data.entity;
  const method = node.requestRef?.expectedMethod || node.kind.replace('-unary', '');
  const asset = node.config?.asset || {};
  const fields = compactRequestFields(data.requestShape).slice(0, 5);
  const configuredCount = Object.values(node.config?.requestOverrides || {}).reduce((total, values) => total + Object.keys(values || {}).length, 0) + (data.bindingCount || 0);
  return (
    <NodeShell issueCount={data.issueCount} searchMatch={data.searchMatch} runtime={data.runtime} className="flow-request-node">
      <Handle id="control-in" type="target" position={Position.Left} className="flow-control-handle" />
      <Handle id="data-in" type="target" position={Position.Top} className="flow-data-handle" />
      <div className="flow-node-kicker"><span>{method}</span><span>{configuredCount} configured</span></div>
      <div className="flow-node-title">{node.name || node.semanticKey}</div>
      <div className="flow-node-meta">{asset.collectionName || node.requestRef?.collectionPath}</div>
      <div className="flow-node-meta flow-node-path">{asset.itemName || node.requestRef?.itemPathname}</div>
      {fields.length > 0 && (
        <div className="flow-request-node-fields">
          {fields.map((field) => {
            const directBinding = node.config?.bindings?.[field.channel]?.[field.key];
            const rootBinding = field.channel === 'body' ? node.config?.bindings?.body?.[ROOT_PATH] : null;
            const binding = directBinding || rootBinding;
            const directOverride = node.config?.requestOverrides?.[field.channel]?.[field.key];
            const rootOverride = field.channel === 'body' ? node.config?.requestOverrides?.body?.[ROOT_PATH] : undefined;
            const override = directOverride !== undefined
              ? directOverride
              : (rootOverride !== undefined ? readPath(rootOverride, field.key) : undefined);
            const dynamicRoot = binding ? selectedDynamicValue(data.flow, binding.sourceNodeId, binding.sourcePath) : null;
            const dynamic = dynamicRoot && rootBinding && !directBinding
              ? { ...dynamicRoot, value: readPath(dynamicRoot.value, field.key) }
              : dynamicRoot;
            const value = dynamic?.value ?? override ?? field.value;
            const source = dynamic?.label || (binding ? data.flow?.nodes?.find((candidate) => candidate.id === binding.sourceNodeId)?.name : (override !== undefined ? 'flow' : 'request'));
            return (
              <div key={`${field.channel}:${field.key}`}>
                <span>{field.key}</span>
                <code>{formatRequestValue(value) || 'empty'}</code>
                <small>{source}</small>
              </div>
            );
          })}
          {compactRequestFields(data.requestShape).length > fields.length && <div className="flow-request-node-more">+{compactRequestFields(data.requestShape).length - fields.length} more</div>}
        </div>
      )}
      <Handle id="control-out" type="source" position={Position.Right} className="flow-control-handle" />
      <Handle id="failure" type="source" position={Position.Bottom} className="flow-control-handle flow-failure-handle" title="Failure route" />
    </NodeShell>
  );
});
FlowRequestNode.displayName = 'FlowRequestNode';

const inputIcon = (kind) => {
  if (kind === 'environment-input') return <IconWorld size={15} />;
  if (kind === 'dataset-input') return <IconDatabase size={15} />;
  return <IconBraces size={15} />;
};

export const FlowInputNode = memo(({ data }) => {
  const node = data.entity;
  const value = node.config?.value ?? node.config?.variable ?? node.config?.datasetPath ?? node.config?.fieldName ?? '';
  const options = node.kind === 'dynamic-data' && Array.isArray(node.config?.options) ? node.config.options : [];
  const selectedOptionId = node.config?.selectedOptionId || options[0]?.id;
  return (
    <NodeShell issueCount={data.issueCount} searchMatch={data.searchMatch} runtime={data.runtime} className={`flow-input-node ${node.kind === 'dynamic-data' ? 'flow-dynamic-data-node' : ''}`}>
      <div className="flow-node-kicker"><span className="inline-flex items-center gap-1">{inputIcon(node.kind)} input</span></div>
      <div className="flow-node-title">{node.name || node.semanticKey}</div>
      {node.kind === 'dynamic-data' ? (
        <div className="flow-dynamic-options nodrag nowheel">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={selectedOptionId === option.id ? 'active' : ''}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                data.onDynamicOptionSelect?.(node.id, option.id);
              }}
              title={formatRequestValue(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : <div className="flow-node-meta flow-node-path">{String(value || node.config?.outputPath || 'value')}</div>}
      <Handle id="data-out" type="source" position={Position.Right} className="flow-data-handle" />
    </NodeShell>
  );
});
FlowInputNode.displayName = 'FlowInputNode';

const controlMeta = (node) => {
  if (node.kind === 'condition') return node.config?.expression || 'condition';
  if (node.kind === 'fork') return node.config?.joinNodeId ? `join → ${node.config.joinNodeId}` : 'select join';
  if (node.kind === 'join') return `${node.config?.mode || 'all'} join`;
  if (node.kind === 'delay') return `${Number(node.config?.milliseconds || 0)} ms`;
  if (node.kind === 'subflow') return node.config?.relativePath || node.config?.flowUid || 'select flow';
  if (node.kind === 'checkpoint') return node.config?.mode || 'pause';
  if (node.kind === 'fail') return node.config?.code || 'FLOW_FAILED';
  return '';
};

export const FlowControlNode = memo(({ data }) => {
  const node = data.entity;
  const isStart = node.kind === 'start';
  const isEnd = node.kind === 'end';
  const isCondition = node.kind === 'condition';
  const isFork = node.kind === 'fork';
  const isFail = node.kind === 'fail';
  const hasFailureRoute = ['delay', 'subflow', 'checkpoint'].includes(node.kind);
  const branchCount = Math.max(2, Math.min(8, Number(node.config?.branchCount || 2)));
  const className = `flow-control-node-card flow-control-node-${node.kind}`;
  return (
    <NodeShell issueCount={data.issueCount} searchMatch={data.searchMatch} runtime={data.runtime} className={className}>
      {!isStart && <Handle id="control-in" type="target" position={Position.Left} className="flow-control-handle" />}
      <div className="flow-control-node-icon">{isStart ? <IconPlayerPlay size={16} /> : (isEnd ? <IconSquare size={15} /> : <IconGitBranch size={15} />)}</div>
      <div className="flow-control-node-copy">
        <div className="flow-node-title">{node.name || node.kind}</div>
        {controlMeta(node) && <div className="flow-node-meta flow-node-path">{controlMeta(node)}</div>}
      </div>
      {isCondition && (
        <>
          <Handle id="true" type="source" position={Position.Right} className="flow-control-handle flow-route-handle flow-route-true" style={{ top: '32%' }} title="True route" />
          <Handle id="false" type="source" position={Position.Right} className="flow-control-handle flow-route-handle flow-route-false" style={{ top: '72%' }} title="False route" />
        </>
      )}
      {isFork && Array.from({ length: branchCount }, (_, index) => (
        <Handle
          key={`branch-${index}`}
          id={`branch-${index}`}
          type="source"
          position={Position.Right}
          className="flow-control-handle flow-route-handle"
          style={{ top: `${((index + 1) / (branchCount + 1)) * 100}%` }}
          title={`Branch ${index + 1}`}
        />
      ))}
      {!isEnd && !isCondition && !isFork && !isFail && <Handle id="control-out" type="source" position={Position.Right} className="flow-control-handle" />}
      {(isFail || hasFailureRoute) && <Handle id="failure" type="source" position={Position.Bottom} className="flow-control-handle flow-failure-handle" title="Failure route" />}
    </NodeShell>
  );
});
FlowControlNode.displayName = 'FlowControlNode';

export const FlowFrameNode = memo(({ data, selected }) => (
  <div className={`flow-frame-node ${data.issueCount ? 'flow-frame-invalid' : ''}`}>
    <NodeResizer minWidth={260} minHeight={180} isVisible={selected} />
    <div className="flow-frame-title">{data.entity.name}</div>
  </div>
));
FlowFrameNode.displayName = 'FlowFrameNode';

export const flowNodeTypes = {
  flowRequest: FlowRequestNode,
  flowInput: FlowInputNode,
  flowControlNode: FlowControlNode,
  flowFrame: FlowFrameNode
};
