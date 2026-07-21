import { countBindings, DATA_NODE_KINDS, REQUEST_NODE_KINDS } from './model';
import { getRuntimeForControlEdge, getRuntimeForDataEdge, getRuntimeForNode } from './runtime-projection';
import { getIssuesForEntity } from './validation';

const searchTextForNode = (node) => [
  node.name,
  node.semanticKey,
  node.kind,
  node.requestRef?.collectionPath,
  node.requestRef?.itemPathname,
  node.requestRef?.expectedMethod
].filter(Boolean).join(' ').toLowerCase();

const projectNodeType = (node) => {
  if (REQUEST_NODE_KINDS.has(node.kind)) return 'flowRequest';
  if (DATA_NODE_KINDS.has(node.kind)) return 'flowInput';
  return 'flowControlNode';
};

export class FlowGraphProjection {
  constructor() {
    this.nodeCache = new Map();
    this.frameCache = new Map();
    this.controlEdgeCache = new Map();
    this.dataEdgeCache = new Map();
  }

  project(flow, validation, searchQuery = '', runtimeProjection = null) {
    const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const activeNodeIds = new Set(flow.nodes.map((node) => node.id));
    const activeFrameIds = new Set(flow.frames.map((frame) => frame.id));
    const activeControlEdgeIds = new Set(flow.controlEdges.map((edge) => edge.id));
    const activeDataEdgeIds = new Set(flow.dataEdges.map((edge) => edge.id));

    const frames = flow.frames.map((frame) => {
      const issues = getIssuesForEntity(validation, frame.id);
      const cache = this.frameCache.get(frame.id);
      const issueSignature = issues.map((issue) => issue.message).join('|');
      if (cache?.entity === frame && cache.issueSignature === issueSignature) return cache.value;
      const value = {
        id: frame.id,
        type: 'flowFrame',
        position: frame.position,
        data: { entity: frame, issueCount: issues.length },
        style: { width: frame.size.width, height: frame.size.height },
        zIndex: -10
      };
      this.frameCache.set(frame.id, { entity: frame, issueSignature, value });
      return value;
    });

    const nodes = flow.nodes.map((node) => {
      const issues = getIssuesForEntity(validation, node.id);
      const issueSignature = issues.map((issue) => issue.message).join('|');
      const searchMatch = Boolean(normalizedSearch && searchTextForNode(node).includes(normalizedSearch));
      const runtime = getRuntimeForNode(runtimeProjection, node.id);
      const cache = this.nodeCache.get(node.id);
      if (cache?.entity === node && cache.issueSignature === issueSignature && cache.searchMatch === searchMatch && cache.runtime === runtime) return cache.value;
      const value = {
        id: node.id,
        type: projectNodeType(node),
        position: node.position,
        parentId: node.frameId,
        extent: node.frameId ? 'parent' : undefined,
        data: {
          entity: node,
          issueCount: issues.length,
          bindingCount: countBindings(node),
          searchMatch,
          runtime
        }
      };
      this.nodeCache.set(node.id, { entity: node, issueSignature, searchMatch, runtime, value });
      return value;
    });

    const controlEdges = flow.controlEdges.map((edge) => {
      const issues = getIssuesForEntity(validation, edge.id);
      const issueSignature = issues.map((issue) => issue.message).join('|');
      const runtime = getRuntimeForControlEdge(runtimeProjection, edge.id);
      const cache = this.controlEdgeCache.get(edge.id);
      if (cache?.entity === edge && cache.issueSignature === issueSignature && cache.runtime === runtime) return cache.value;
      const value = {
        id: edge.id,
        type: 'flowControl',
        source: edge.sourceNodeId,
        target: edge.targetNodeId,
        sourceHandle: edge.sourcePort || 'control-out',
        targetHandle: edge.targetPort || 'control-in',
        label: edge.label || (edge.sourcePort && edge.sourcePort !== 'control-out' ? edge.sourcePort : undefined),
        data: { entity: edge, issueCount: issues.length, runtime }
      };
      this.controlEdgeCache.set(edge.id, { entity: edge, issueSignature, runtime, value });
      return value;
    });

    const dataEdges = flow.dataEdges.map((edge) => {
      const issues = getIssuesForEntity(validation, edge.id);
      const issueSignature = issues.map((issue) => issue.message).join('|');
      const runtime = getRuntimeForDataEdge(runtimeProjection, edge.id);
      const cache = this.dataEdgeCache.get(edge.id);
      if (cache?.entity === edge && cache.issueSignature === issueSignature && cache.runtime === runtime) return cache.value;
      const value = {
        id: edge.id,
        type: 'flowData',
        source: edge.source.nodeId,
        target: edge.target.nodeId,
        sourceHandle: 'data-out',
        targetHandle: 'data-in',
        label: `${edge.source.path} → ${edge.target.path}`,
        data: { entity: edge, issueCount: issues.length, runtime }
      };
      this.dataEdgeCache.set(edge.id, { entity: edge, issueSignature, runtime, value });
      return value;
    });

    [...this.nodeCache.keys()].forEach((id) => { if (!activeNodeIds.has(id)) this.nodeCache.delete(id); });
    [...this.frameCache.keys()].forEach((id) => { if (!activeFrameIds.has(id)) this.frameCache.delete(id); });
    [...this.controlEdgeCache.keys()].forEach((id) => { if (!activeControlEdgeIds.has(id)) this.controlEdgeCache.delete(id); });
    [...this.dataEdgeCache.keys()].forEach((id) => { if (!activeDataEdgeIds.has(id)) this.dataEdgeCache.delete(id); });

    const completedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    return {
      nodes: [...frames, ...nodes],
      edges: [...controlEdges, ...dataEdges],
      durationMs: completedAt - startedAt
    };
  }
}
