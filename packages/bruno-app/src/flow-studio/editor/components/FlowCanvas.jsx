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
  FLOW_OUTPUT_MIME,
  FLOW_OUTPUT_TEXT_PREFIX,
  REQUEST_NODE_KINDS,
  addConnection,
  addNode,
  createControlNode,
  createInputNode,
  createRequestNodeFromAsset,
  setNodeBinding,
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

const EMPTY_REQUEST_ASSETS = [];
const emptySelection = () => ({ nodeIds: [], frameIds: [], controlEdgeIds: [], dataEdgeIds: [] });

const readFlowOutputPayload = (dataTransfer) => {
  const customPayload = dataTransfer?.getData?.(FLOW_OUTPUT_MIME);
  if (customPayload) return customPayload;
  const textPayload = dataTransfer?.getData?.('text/plain');
  return textPayload?.startsWith(FLOW_OUTPUT_TEXT_PREFIX)
    ? textPayload.slice(FLOW_OUTPUT_TEXT_PREFIX.length)
    : '';
};

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
  runtimeProjection,
  requestAssets = EMPTY_REQUEST_ASSETS
}) => {
  const projectionRef = useRef(new FlowGraphProjection());
  const viewportReadyRef = useRef(Boolean(flow.viewport));
  const activeFlowUidRef = useRef(flow.uid);
  const { screenToFlowPosition, fitView, getNodes } = useReactFlow();
  const selectDynamicOption = useCallback((nodeId, optionId) => {
    onCommit(updateNode(flow, nodeId, (node) => ({
      ...node,
      config: { ...node.config, selectedOptionId: optionId }
    })), { nodeIds: [nodeId] });
  }, [flow, onCommit]);
  const requestShapeByUid = useMemo(() => new Map(requestAssets.map((asset) => [asset.itemUid, asset.requestShape])), [requestAssets]);
  const projectedBase = useMemo(
    () => projectionRef.current.project(flow, validation, searchQuery, runtimeProjection),
    [flow, validation, searchQuery, runtimeProjection]
  );
  const projected = useMemo(() => ({
    ...projectedBase,
    nodes: projectedBase.nodes.map((canvasNode) => {
      const entity = canvasNode.data?.entity;
      return {
        ...canvasNode,
        data: {
          ...canvasNode.data,
          flow,
          requestShape: entity?.requestRef
            ? (requestShapeByUid.get(entity.requestRef.expectedItemUid) || entity.config?.asset?.requestShape || null)
            : null,
          onDynamicOptionSelect: selectDynamicOption
        }
      };
    })
  }), [flow, projectedBase, requestShapeByUid, selectDynamicOption]);
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
    const outputRaw = readFlowOutputPayload(event.dataTransfer);
    if (outputRaw) {
      let output;
      try {
        output = JSON.parse(outputRaw);
      } catch (_) {
        return;
      }
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const targetCanvasNode = getNodes().find((candidate) => {
        if (!REQUEST_NODE_KINDS.has(flow.nodes.find((node) => node.id === candidate.id)?.kind)) return false;
        const width = candidate.measured?.width || candidate.width || 190;
        const height = candidate.measured?.height || candidate.height || 90;
        return position.x >= candidate.position.x && position.x <= candidate.position.x + width
          && position.y >= candidate.position.y && position.y <= candidate.position.y + height;
      });
      if (!targetCanvasNode || !output?.sourceNodeId || !output?.sourcePath || targetCanvasNode.id === output.sourceNodeId) return;
      const leaf = String(output.sourcePath).split(/[.\[\]]+/).filter(Boolean).at(-1) || 'value';
      const key = leaf.replace(/[^a-zA-Z0-9_.-]+/g, '_');
      const next = setNodeBinding(flow, {
        targetNodeId: targetCanvasNode.id,
        channel: 'runtime',
        key,
        sourceNodeId: output.sourceNodeId,
        sourcePath: output.sourcePath
      });
      if (next === flow) return;
      onCommit(next, { topology: true, nodeIds: [targetCanvasNode.id], dataEdgeIds: next.dataEdges.slice(-1).map((edge) => edge.id) });
      onSelectionChange({ ...emptySelection(), nodeIds: [targetCanvasNode.id], focusNonce: Date.now() });
      return;
    }
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
          ? createControlNode(flow, asset.kind, position, { ...asset, name: asset.name })
          : createInputNode(flow, asset.kind, position, { name: asset.name }));
    const next = addNode(flow, node);
    onCommit(next, { topology: true, nodeIds: [node.id] });
    onSelectionChange({ ...emptySelection(), nodeIds: [node.id], focusNonce: Date.now() });
  }, [flow, getNodes, onCommit, onSelectionChange, screenToFlowPosition]);

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
export { readFlowAssetPayload, readFlowOutputPayload };
