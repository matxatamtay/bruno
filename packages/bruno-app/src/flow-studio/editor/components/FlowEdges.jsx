import React, { memo } from 'react';
import { BaseEdge, EdgeLabelRenderer, getBezierPath } from '@xyflow/react';

const edgePath = (props) => getBezierPath({
  sourceX: props.sourceX,
  sourceY: props.sourceY,
  sourcePosition: props.sourcePosition,
  targetX: props.targetX,
  targetY: props.targetY,
  targetPosition: props.targetPosition
});

const gradientId = (prefix, id) => `${prefix}-${String(id).replace(/[^A-Za-z0-9_-]/g, '-')}`;

export const FlowControlEdge = memo((props) => {
  const [path, labelX, labelY] = edgePath(props);
  const active = ['activated', 'failure'].includes(props.data?.runtime?.status);
  const gradient = gradientId('flow-control-gradient', props.id);
  return (
    <>
      <defs>
        <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#6d5dfc" stopOpacity="0.2" />
          <stop offset="55%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#22d3ee" />
        </linearGradient>
      </defs>
      <BaseEdge
        path={path}
        markerEnd={props.markerEnd}
        className={props.selected ? 'flow-control-edge flow-edge-selected' : 'flow-control-edge'}
      />
      {active && <BaseEdge path={path} markerEnd={props.markerEnd} className={`flow-runtime-edge flow-runtime-control-edge ${props.data?.runtime?.status === 'failure' ? 'flow-runtime-failure-edge' : ''}`} style={{ stroke: `url(#${gradient})` }} />}
      {props.label && (
        <EdgeLabelRenderer>
          <div className="flow-edge-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
            {props.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
});
FlowControlEdge.displayName = 'FlowControlEdge';

export const FlowDataEdge = memo((props) => {
  const [path, labelX, labelY] = edgePath(props);
  const active = props.data?.runtime?.status === 'resolved';
  const gradient = gradientId('flow-data-gradient', props.id);
  return (
    <>
      <defs>
        <linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0f9f8f" stopOpacity="0.2" />
          <stop offset="55%" stopColor="#2dd4bf" />
          <stop offset="100%" stopColor="#84cc16" />
        </linearGradient>
      </defs>
      <BaseEdge
        path={path}
        className={props.selected ? 'flow-data-edge flow-edge-selected' : 'flow-data-edge'}
      />
      {active && <BaseEdge path={path} className="flow-runtime-edge flow-runtime-data-edge" style={{ stroke: `url(#${gradient})` }} />}
      <EdgeLabelRenderer>
        <div className="flow-edge-label flow-data-label nodrag nopan" style={{ transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)` }}>
          {props.label || 'data'}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});
FlowDataEdge.displayName = 'FlowDataEdge';

export const flowEdgeTypes = {
  flowControl: FlowControlEdge,
  flowData: FlowDataEdge
};
