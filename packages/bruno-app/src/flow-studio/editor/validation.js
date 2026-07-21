import { compileFlow, validateFlowDefinition } from '@usebruno/flow-core';
import { DATA_NODE_KINDS, REQUEST_NODE_KINDS } from './model';

const issueKey = (issue) => `${issue.path}:${issue.keyword || ''}:${issue.message}`;

const localNodeIssues = (flow, node) => {
  const issues = [];
  if (!node.id) issues.push({ path: `/nodes/${node.id || 'unknown'}/id`, message: 'Node id is required', keyword: 'required' });
  if (!node.semanticKey || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(node.semanticKey)) {
    issues.push({ path: `/nodes/${node.id}/semanticKey`, message: 'Semantic key is invalid', keyword: 'pattern', nodeId: node.id });
  }
  if (!node.position || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) {
    issues.push({ path: `/nodes/${node.id}/position`, message: 'Position must contain finite x and y values', keyword: 'type', nodeId: node.id });
  }
  if (REQUEST_NODE_KINDS.has(node.kind) && !node.requestRef) {
    issues.push({ path: `/nodes/${node.id}/requestRef`, message: 'Request nodes require a request reference', keyword: 'required', nodeId: node.id });
  }
  if (node.frameId && !flow.frames.some((frame) => frame.id === node.frameId)) {
    issues.push({ path: `/nodes/${node.id}/frameId`, message: `Frame ${node.frameId} does not exist`, keyword: 'reference', nodeId: node.id });
  }
  if (DATA_NODE_KINDS.has(node.kind) && !node.config?.outputPath) {
    issues.push({ path: `/nodes/${node.id}/config/outputPath`, message: 'Input nodes require an output path', keyword: 'required', nodeId: node.id });
  }
  if (node.kind === 'condition' && !String(node.config?.expression || '').trim()) {
    issues.push({ path: `/nodes/${node.id}/config/expression`, message: 'Condition requires an expression', keyword: 'required', nodeId: node.id });
  }
  if (node.kind === 'fork') {
    const join = flow.nodes.find((candidate) => candidate.id === node.config?.joinNodeId);
    if (join?.kind !== 'join') issues.push({ path: `/nodes/${node.id}/config/joinNodeId`, message: 'Fork requires a valid join node', keyword: 'reference', nodeId: node.id });
  }
  if (node.kind === 'join' && node.config?.mode === 'quorum') {
    const quorum = Number(node.config?.quorum || 0);
    const branchCounts = flow.nodes
      .filter((candidate) => candidate.kind === 'fork' && candidate.config?.joinNodeId === node.id)
      .map((fork) => flow.controlEdges.filter((edge) => edge.sourceNodeId === fork.id && edge.sourcePort !== 'failure').length)
      .filter((count) => count > 0);
    if (!Number.isInteger(quorum) || quorum < 1) {
      issues.push({ path: `/nodes/${node.id}/config/quorum`, message: 'Join quorum must be a positive integer', keyword: 'minimum', nodeId: node.id });
    } else if (branchCounts.some((count) => quorum > count)) {
      issues.push({ path: `/nodes/${node.id}/config/quorum`, message: `Join quorum cannot exceed ${Math.min(...branchCounts)} branches`, keyword: 'maximum', nodeId: node.id });
    }
  }
  if (node.kind === 'subflow') {
    if (!node.config?.relativePath && !node.config?.flowUid) issues.push({ path: `/nodes/${node.id}/config`, message: 'Subflow requires a flow path or UID', keyword: 'required', nodeId: node.id });
    if (node.config?.datasetMode === 'for-each' && (Number(node.config?.maxItems || 0) < 1 || Number(node.config?.maxItems || 0) > 100)) {
      issues.push({ path: `/nodes/${node.id}/config/maxItems`, message: 'Dataset limit must be between 1 and 100', keyword: 'range', nodeId: node.id });
    }
  }
  if (node.policy?.sideEffect === 'once' && node.policy?.retry?.maxAttempts > 1 && node.policy?.allowRetry !== true) {
    issues.push({ path: `/nodes/${node.id}/policy/retry`, message: 'Once-only side effects need Allow retry before max attempts can exceed 1', keyword: 'policy', severity: 'warning', nodeId: node.id });
  }
  return issues;
};

const localControlEdgeIssues = (flow, edge) => {
  const nodeIds = new Set(flow.nodes.map((node) => node.id));
  const issues = [];
  if (!nodeIds.has(edge.sourceNodeId)) issues.push({ path: `/controlEdges/${edge.id}/sourceNodeId`, message: 'Source node does not exist', keyword: 'reference', edgeId: edge.id });
  if (!nodeIds.has(edge.targetNodeId)) issues.push({ path: `/controlEdges/${edge.id}/targetNodeId`, message: 'Target node does not exist', keyword: 'reference', edgeId: edge.id });
  if (edge.sourceNodeId === edge.targetNodeId) issues.push({ path: `/controlEdges/${edge.id}`, message: 'Self control edges are not allowed', keyword: 'reference', edgeId: edge.id });
  return issues;
};

const localDataEdgeIssues = (flow, edge) => {
  const nodeIds = new Set(flow.nodes.map((node) => node.id));
  const issues = [];
  if (!nodeIds.has(edge.source.nodeId)) issues.push({ path: `/dataEdges/${edge.id}/source/nodeId`, message: 'Source node does not exist', keyword: 'reference', edgeId: edge.id });
  if (!nodeIds.has(edge.target.nodeId)) issues.push({ path: `/dataEdges/${edge.id}/target/nodeId`, message: 'Target node does not exist', keyword: 'reference', edgeId: edge.id });
  if (!edge.source.path) issues.push({ path: `/dataEdges/${edge.id}/source/path`, message: 'Source path is required', keyword: 'required', edgeId: edge.id });
  if (!edge.target.path) issues.push({ path: `/dataEdges/${edge.id}/target/path`, message: 'Target path is required', keyword: 'required', edgeId: edge.id });
  return issues;
};

const duplicateIssues = (flow) => {
  const issues = [];
  const collect = (values, label, path) => {
    const seen = new Set();
    values.forEach((value) => {
      if (seen.has(value)) issues.push({ path, message: `Duplicate ${label}: ${value}`, keyword: 'unique' });
      seen.add(value);
    });
  };
  collect(flow.nodes.map((node) => node.id), 'node id', '/nodes');
  collect(flow.nodes.map((node) => node.semanticKey), 'semantic key', '/nodes');
  collect([
    ...flow.controlEdges.map((edge) => edge.id),
    ...flow.dataEdges.map((edge) => edge.id),
    ...flow.frames.map((frame) => frame.id)
  ], 'graph entity id', '/');
  return issues;
};

const normalizeCompilerDiagnostics = (flow) => {
  try {
    return compileFlow(flow).diagnostics.map((diagnostic) => ({
      path: diagnostic.nodeId ? `/nodes/${diagnostic.nodeId}` : (diagnostic.edgeId ? `/edges/${diagnostic.edgeId}` : '/'),
      message: diagnostic.message,
      keyword: diagnostic.code,
      severity: diagnostic.severity,
      nodeId: diagnostic.nodeId,
      edgeId: diagnostic.edgeId
    }));
  } catch (_) {
    return [];
  }
};

export class IncrementalFlowValidator {
  constructor() {
    this.lastFlow = null;
    this.lastResult = { issues: [], mode: 'full', validatedEntityCount: 0 };
  }

  validateFull(flow) {
    if (!flow) return { issues: [], mode: 'full', validatedEntityCount: 0 };
    const schemaIssues = validateFlowDefinition(flow);
    const issues = [
      ...schemaIssues,
      ...(schemaIssues.length === 0 ? normalizeCompilerDiagnostics(flow) : [])
    ];
    const deduped = [...new Map(issues.map((issue) => [issueKey(issue), issue])).values()];
    this.lastFlow = flow;
    this.lastResult = {
      issues: deduped,
      mode: 'full',
      validatedEntityCount: flow.nodes.length + flow.controlEdges.length + flow.dataEdges.length + flow.frames.length
    };
    return this.lastResult;
  }

  validate(flow, dirty = {}) {
    if (!flow || !this.lastFlow || dirty.all) return this.validateFull(flow);
    const nodeIds = new Set(dirty.nodeIds || []);
    const controlEdgeIds = new Set(dirty.controlEdgeIds || []);
    const dataEdgeIds = new Set(dirty.dataEdgeIds || []);
    const topology = Boolean(dirty.topology);
    const identity = Boolean(dirty.identity);
    const affectedPaths = [
      ...[...nodeIds].map((id) => `/nodes/${id}`),
      ...[...controlEdgeIds].map((id) => `/controlEdges/${id}`),
      ...[...dataEdgeIds].map((id) => `/dataEdges/${id}`)
    ];
    const preserved = this.lastResult.issues.filter((issue) => (
      !affectedPaths.some((path) => issue.path?.startsWith(path))
      && (!(topology || identity) || issue.keyword !== 'unique')
      && (!topology || !String(issue.keyword || '').startsWith('FLOW_'))
    ));
    const issues = [...preserved];
    flow.nodes.filter((node) => nodeIds.has(node.id)).forEach((node) => issues.push(...localNodeIssues(flow, node)));
    flow.controlEdges.filter((edge) => controlEdgeIds.has(edge.id)).forEach((edge) => issues.push(...localControlEdgeIssues(flow, edge)));
    flow.dataEdges.filter((edge) => dataEdgeIds.has(edge.id)).forEach((edge) => issues.push(...localDataEdgeIssues(flow, edge)));
    if (topology || identity) issues.push(...duplicateIssues(flow));
    if (topology) issues.push(...normalizeCompilerDiagnostics(flow));
    const deduped = [...new Map(issues.map((issue) => [issueKey(issue), issue])).values()];
    this.lastFlow = flow;
    this.lastResult = {
      issues: deduped,
      mode: 'incremental',
      validatedEntityCount: nodeIds.size + controlEdgeIds.size + dataEdgeIds.size
    };
    return this.lastResult;
  }
}

export const getIssuesForEntity = (validation, entityId) => validation?.issues?.filter((issue) => (
  issue.nodeId === entityId
  || issue.edgeId === entityId
  || issue.path?.includes(`/${entityId}`)
)) || [];
