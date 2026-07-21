import React, { memo, useMemo } from 'react';
import {
  Background,
  BaseEdge,
  Handle,
  Position,
  ReactFlow,
  getBezierPath
} from '@xyflow/react';
import { createNodeRuntimeStore, useNodeRuntimeState } from './runtime-store';

const statusLabel = (status) => status.replaceAll('-', ' ');

const Phase0RequestNode = memo(({ id, data }) => {
  const runtime = useNodeRuntimeState(data.runtimeStore, id);
  data.onRender?.(id, runtime);

  return (
    <div
      data-testid={`phase0-node-${id}`}
      data-runtime-status={runtime.status}
      style={{
        width: 150,
        border: runtime.status === 'running' ? '2px solid currentColor' : '1px solid currentColor',
        borderRadius: 8,
        background: 'var(--color-bg, white)',
        padding: 8,
        fontSize: 11
      }}
    >
      <Handle type="target" position={Position.Left} />
      <strong>{data.label}</strong>
      <div>{statusLabel(runtime.status)}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
});

Phase0RequestNode.displayName = 'Phase0RequestNode';

const Phase0FrameNode = memo(({ data }) => (
  <div
    data-testid="phase0-frame"
    style={{
      width: '100%',
      height: '100%',
      border: '2px dashed currentColor',
      borderRadius: 12,
      padding: 10,
      opacity: 0.55,
      fontSize: 12
    }}
  >
    {data.label}
  </div>
));

Phase0FrameNode.displayName = 'Phase0FrameNode';

export const Phase0ControlEdge = memo((props) => {
  const [path] = getBezierPath(props);
  return (
    <g data-testid={`phase0-control-edge-${props.id}`}>
      <BaseEdge path={path} markerEnd={props.markerEnd} style={{ strokeWidth: 2 }} />
    </g>
  );
});

Phase0ControlEdge.displayName = 'Phase0ControlEdge';

const nodeTypes = {
  phase0Request: Phase0RequestNode,
  phase0Frame: Phase0FrameNode
};

const edgeTypes = {
  phase0Control: Phase0ControlEdge
};

export const createPhase0Fixture = ({ nodeCount = 500, runtimeStore, onNodeRender }) => {
  const requestNodes = Array.from({ length: nodeCount }, (_, index) => {
    const column = index % 25;
    const row = Math.floor(index / 25);
    const inFrame = index < 10;

    return {
      id: `node-${index}`,
      type: 'phase0Request',
      position: inFrame
        ? { x: 30 + (index % 5) * 180, y: 50 + Math.floor(index / 5) * 100 }
        : { x: column * 185, y: 360 + row * 100 },
      parentId: inFrame ? 'frame-business-stage' : undefined,
      extent: inFrame ? 'parent' : undefined,
      data: {
        label: `Request ${index}`,
        runtimeStore,
        onRender: onNodeRender
      }
    };
  });

  const nodes = [
    {
      id: 'frame-business-stage',
      type: 'phase0Frame',
      position: { x: 0, y: 0 },
      style: { width: 930, height: 260 },
      data: { label: 'Business stage frame' },
      selectable: true,
      draggable: false
    },
    ...requestNodes
  ];

  const edges = requestNodes.slice(1).map((node, index) => ({
    id: `control-${index}-${index + 1}`,
    type: 'phase0Control',
    source: `node-${index}`,
    target: node.id
  }));

  return { nodes, edges };
};

export const Phase0FlowCanvas = ({
  nodeCount = 500,
  runtimeStore: providedRuntimeStore,
  onNodeRender,
  height = 720
}) => {
  const nodeIds = useMemo(
    () => Array.from({ length: nodeCount }, (_, index) => `node-${index}`),
    [nodeCount]
  );
  const fallbackRuntimeStore = useMemo(() => createNodeRuntimeStore(nodeIds), [nodeIds]);
  const runtimeStore = providedRuntimeStore || fallbackRuntimeStore;
  const fixture = useMemo(
    () => createPhase0Fixture({ nodeCount, runtimeStore, onNodeRender }),
    [nodeCount, runtimeStore, onNodeRender]
  );

  return (
    <div data-testid="phase0-flow-canvas" style={{ width: '100%', height }}>
      <ReactFlow
        nodes={fixture.nodes}
        edges={fixture.edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        onlyRenderVisibleElements={false}
        minZoom={0.05}
        fitView
      >
        <Background gap={24} />
      </ReactFlow>
    </div>
  );
};
