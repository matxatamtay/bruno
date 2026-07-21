import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow
} from '@xyflow/react';
import { FlowGraphProjection } from '../graph-projection';
import {
  FLOW_ASSET_MIME,
  FLOW_ASSET_TEXT_PREFIX,
  addConnection,
  addNode,
  createControlNode,
  createInputNode,
  createRequestNodeFromAsset,
  updateFrame,
  updateNode
} from '../model';
import { flowNodeTypes } from './FlowNodes';
import { flowEdgeTypes } from './FlowEdges';

const mergeProjected = (previous, projected) => {
  const previousById = new Map(previous.map((entry) => [entry.id, entry]));
  return projected.map((entry) => {
    const current = previousById.get(entry.id);
    if (current === entry) return current;
    return current ? { ...entry, selected: current.selected } : entry;
  });
};

const emptySelection = () => ({ nodeIds: [], frameIds: [], controlEdgeIds: [], dataEdgeIds: [] });

const readFlowAssetPayload = (dataTransfer) => {
  const customPayload = dataTransfer?.getData?.(FLOW_ASSET_MIME);
  if (customPayload) return customPayload;
  const textPayload = dataTransfer?.getData?.('text/plain');
  return textPayload?.startsWith(FLOW_ASSET_TEXT_PREFIX)
    ? textPayload.slice(FLOW_ASSET_TEXT_PREFIX.length)
    : '';
};

const FlowCanvasInner = ({
  flow,
  validation,
  searchQuery,
  selection,
  onSelectionChange,
  onCommit,
  onReplace,
  onProjectionMeasured,
  runtimeProjection
}) => {
  const projectionRef = useRef(new FlowGraphProjection());
  const viewportReadyRef = useRef(Boolean(flow.viewport));
  const activeFlowUidRef = useRef(flow.uid);
  const { screenToFlowPosition, fitView } = useReactFlow();
  const projected = useMemo(
    () => projectionRef.current.project(flow, validation, searchQuery, runtimeProjection),
    [flow, validation, searchQuery, runtimeProjection]
  );
  const [nodes, setNodes] = useState(projected.nodes);
  const [edges, setEdges] = useState(projected.edges);

  useEffect(() => {
    if (activeFlowUidRef.current !== flow.uid) {
      activeFlowUidRef.current = flow.uid;
      viewportReadyRef.current = Boolean(flow.viewport);
    }
    setNodes((current) => mergeProjected(current, projected.nodes));
    setEdges((current) => mergeProjected(current, projected.edges));
    onProjectionMeasured?.(projected.durationMs);
  }, [projected, onProjectionMeasured]);

  useEffect(() => {
    const selectedNodeIds = new Set([...(selection?.nodeIds || []), ...(selection?.frameIds || [])]);
    const selectedEdgeIds = new Set([...(selection?.controlEdgeIds || []), ...(selection?.dataEdgeIds || [])]);
    setNodes((current) => current.map((node) => node.selected === selectedNodeIds.has(node.id) ? node : { ...node, selected: selectedNodeIds.has(node.id) }));
    setEdges((current) => current.map((edge) => edge.selected === selectedEdgeIds.has(edge.id) ? edge : { ...edge, selected: selectedEdgeIds.has(edge.id) }));
    const selectedNodeId = selection?.nodeIds?.[0] || selection?.frameIds?.[0];
    if (!selectedNodeId || !selection?.focusNonce) return;
    const selectedNode = nodes.find((node) => node.id === selectedNodeId);
    if (selectedNode) fitView({ nodes: [selectedNode], duration: 180, padding: 1.5, maxZoom: 1.25 });
  }, [selection, fitView]);

  const handleNodesChange = useCallback((changes) => {
    setNodes((current) => applyNodeChanges(changes, current));
    const completedResize = changes.find((change) => change.type === 'dimensions' && change.resizing === false && change.dimensions);
    if (completedResize && flow.frames.some((frame) => frame.id === completedResize.id)) {
      onCommit(updateFrame(flow, completedResize.id, {
        size: { width: completedResize.dimensions.width, height: completedResize.dimensions.height }
      }), { frameIds: [completedResize.id] });
    }
  }, [flow, onCommit]);

  const handleEdgesChange = useCallback((changes) => {
    setEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  const handleNodeDragStop = useCallback((_, canvasNode) => {
    if (flow.frames.some((frame) => frame.id === canvasNode.id)) {
      onCommit(updateFrame(flow, canvasNode.id, { position: canvasNode.position }), { frameIds: [canvasNode.id] });
      return;
    }
    onCommit(updateNode(flow, canvasNode.id, { position: canvasNode.position }), { nodeIds: [canvasNode.id] });
  }, [flow, onCommit]);

  const handleConnect = useCallback((connection) => {
    const next = addConnection(flow, connection);
    if (next === flow) return;
    const isData = String(connection.sourceHandle || '').startsWith('data') || String(connection.targetHandle || '').startsWith('data');
    const added = isData ? next.dataEdges[next.dataEdges.length - 1] : next.controlEdges[next.controlEdges.length - 1];
    onCommit(next, {
      topology: true,
      ...(isData ? { dataEdgeIds: [added.id] } : { controlEdgeIds: [added.id] })
    });
  }, [flow, onCommit]);

  const handleSelectionChange = useCallback(({ nodes: selectedNodes = [], edges: selectedEdges = [] }) => {
    const next = emptySelection();
    selectedNodes.forEach((node) => {
      if (node.type === 'flowFrame') next.frameIds.push(node.id);
      else next.nodeIds.push(node.id);
    });
    selectedEdges.forEach((edge) => {
      if (edge.type === 'flowData') next.dataEdgeIds.push(edge.id);
      else next.controlEdgeIds.push(edge.id);
    });
    onSelectionChange(next);
  }, [onSelectionChange]);

  const handleDragOver = useCallback((event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    const raw = readFlowAssetPayload(event.dataTransfer);
    if (!raw) return;
    let asset;
    try {
      asset = JSON.parse(raw);
    } catch (_) {
      return;
    }
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const node = asset.assetType === 'request'
      ? createRequestNodeFromAsset(flow, asset, position)
      : (asset.assetType === 'control'
          ? createControlNode(flow, asset.kind, position, { name: asset.name })
          : createInputNode(flow, asset.kind, position, { name: asset.name }));
    const next = addNode(flow, node);
    onCommit(next, { topology: true, nodeIds: [node.id] });
    onSelectionChange({ ...emptySelection(), nodeIds: [node.id], focusNonce: Date.now() });
  }, [flow, onCommit, onSelectionChange, screenToFlowPosition]);

  const handleMoveEnd = useCallback((_, viewport) => {
    if (!viewport) return;
    if (!viewportReadyRef.current) {
      viewportReadyRef.current = true;
      return;
    }
    if (flow.viewport?.x === viewport.x && flow.viewport?.y === viewport.y && flow.viewport?.zoom === viewport.zoom) return;
    onReplace({ ...flow, viewport }, {});
  }, [flow, onReplace]);

  return (
    <div className="flow-canvas" data-testid="flow-studio-canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={flowNodeTypes}
        edgeTypes={flowEdgeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onNodeDragStop={handleNodeDragStop}
        onConnect={handleConnect}
        onSelectionChange={handleSelectionChange}
        onMoveEnd={handleMoveEnd}
        onDragEnter={handleDragOver}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        defaultViewport={flow.viewport || { x: 0, y: 0, zoom: 1 }}
        minZoom={0.08}
        maxZoom={2}
        fitView={!flow.viewport}
        fitViewOptions={{ padding: 0.3 }}
        onlyRenderVisibleElements
        deleteKeyCode={null}
        multiSelectionKeyCode={['Meta', 'Control']}
        selectionOnDrag
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable nodeStrokeWidth={3} />
      </ReactFlow>
    </div>
  );
};

export default FlowCanvasInner;
export { readFlowAssetPayload };
