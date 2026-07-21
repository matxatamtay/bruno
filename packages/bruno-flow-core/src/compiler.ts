import { normalizeFlowDefinition } from './parser';
import type { CompiledFlow, CompiledFlowNode, CompilerDiagnostic, FlowDefinition, FlowDefinitionInput } from './types';

const pushUnique = (target: string[], value: string): void => {
  if (!target.includes(value)) target.push(value);
};

export const compileFlow = (
  input: FlowDefinitionInput | FlowDefinition | Record<string, unknown>
): CompiledFlow => {
  const flow = normalizeFlowDefinition(input);
  const diagnostics: CompilerDiagnostic[] = [];
  const nodes: Record<string, CompiledFlowNode> = {};

  flow.nodes.forEach((node) => {
    nodes[node.id] = {
      id: node.id,
      semanticKey: node.semanticKey,
      kind: node.kind,
      incomingControlEdgeIds: [],
      outgoingControlEdgeIds: [],
      incomingDataEdgeIds: [],
      outgoingDataEdgeIds: []
    };
  });

  flow.controlEdges.forEach((edge) => {
    pushUnique(nodes[edge.sourceNodeId].outgoingControlEdgeIds, edge.id);
    pushUnique(nodes[edge.targetNodeId].incomingControlEdgeIds, edge.id);
  });

  flow.dataEdges.forEach((edge) => {
    pushUnique(nodes[edge.source.nodeId].outgoingDataEdgeIds, edge.id);
    pushUnique(nodes[edge.target.nodeId].incomingDataEdgeIds, edge.id);
  });

  const explicitStarts = flow.nodes.filter((node) => node.kind === 'start').map((node) => node.id);
  const entryNodeIds = explicitStarts.length > 0
    ? explicitStarts
    : flow.nodes.filter((node) => nodes[node.id].incomingControlEdgeIds.length === 0).map((node) => node.id);

  if (explicitStarts.length === 0) {
    diagnostics.push({ severity: 'warning', code: 'FLOW_NO_START_NODE', message: 'Flow has no explicit start node' });
  }
  if (explicitStarts.length > 1) {
    diagnostics.push({ severity: 'warning', code: 'FLOW_MULTIPLE_START_NODES', message: 'Flow has multiple start nodes' });
  }
  if (!flow.nodes.some((node) => node.kind === 'end')) {
    diagnostics.push({ severity: 'warning', code: 'FLOW_NO_END_NODE', message: 'Flow has no explicit end node' });
  }

  const indegree = new Map(flow.nodes.map((node) => [node.id, nodes[node.id].incomingControlEdgeIds.length]));
  const queue = flow.nodes
    .filter((node) => indegree.get(node.id) === 0)
    .sort((left, right) => left.semanticKey.localeCompare(right.semanticKey) || left.id.localeCompare(right.id))
    .map((node) => node.id);
  const nodeOrder: string[] = [];

  while (queue.length > 0) {
    const nodeId = queue.shift() as string;
    nodeOrder.push(nodeId);
    flow.controlEdges
      .filter((edge) => edge.sourceNodeId === nodeId)
      .sort((left, right) => left.id.localeCompare(right.id))
      .forEach((edge) => {
        const next = (indegree.get(edge.targetNodeId) || 0) - 1;
        indegree.set(edge.targetNodeId, next);
        if (next === 0) {
          queue.push(edge.targetNodeId);
          queue.sort((left, right) => {
            const leftNode = flow.nodes.find((node) => node.id === left);
            const rightNode = flow.nodes.find((node) => node.id === right);
            return String(leftNode?.semanticKey || left).localeCompare(String(rightNode?.semanticKey || right)) || left.localeCompare(right);
          });
        }
      });
  }

  if (nodeOrder.length !== flow.nodes.length) {
    diagnostics.push({
      severity: 'warning',
      code: 'FLOW_CONTROL_CYCLE',
      message: 'Control graph contains a cycle; runtime cycle policy is not implemented yet'
    });
    flow.nodes.forEach((node) => {
      if (!nodeOrder.includes(node.id)) nodeOrder.push(node.id);
    });
  }

  const reachable = new Set<string>();
  const pending = [...entryNodeIds];
  while (pending.length > 0) {
    const nodeId = pending.shift() as string;
    if (reachable.has(nodeId)) continue;
    reachable.add(nodeId);
    flow.controlEdges
      .filter((edge) => edge.sourceNodeId === nodeId)
      .forEach((edge) => pending.push(edge.targetNodeId));
  }

  flow.nodes.forEach((node) => {
    const outgoing = flow.controlEdges.filter((edge) => edge.sourceNodeId === node.id);
    const successEdges = outgoing.filter((edge) => edge.sourcePort !== 'failure');
    const failureEdges = outgoing.filter((edge) => edge.sourcePort === 'failure');
    if (!reachable.has(node.id)) {
      diagnostics.push({
        severity: 'warning',
        code: 'FLOW_UNREACHABLE_NODE',
        message: `Node ${node.semanticKey} is unreachable from an entry node`,
        nodeId: node.id
      });
    }
    if (node.kind === 'fork') {
      const joinNodeId = String(node.config?.joinNodeId || '');
      const joinNode = flow.nodes.find((candidate) => candidate.id === joinNodeId);
      if (!joinNodeId || joinNode?.kind !== 'join') {
        diagnostics.push({
          severity: 'error',
          code: 'FLOW_FORK_JOIN_REQUIRED',
          message: `Fork ${node.semanticKey} must reference a join node`,
          nodeId: node.id
        });
      }
      if (joinNode?.kind === 'join' && joinNode.config?.mode === 'quorum') {
        const quorum = Number(joinNode.config?.quorum ?? Math.ceil(successEdges.length / 2));
        if (!Number.isInteger(quorum) || quorum < 1 || quorum > successEdges.length) {
          diagnostics.push({
            severity: 'error',
            code: 'FLOW_JOIN_QUORUM_OUT_OF_RANGE',
            message: `Join ${joinNode.semanticKey} quorum must be between 1 and ${successEdges.length}`,
            nodeId: joinNode.id
          });
        }
      }
      const minimumBranches = node.config?.datasetMode === 'for-each' ? 1 : 2;
      if (successEdges.length < minimumBranches) {
        diagnostics.push({
          severity: 'error',
          code: 'FLOW_FORK_BRANCH_COUNT',
          message: `Fork ${node.semanticKey} requires at least ${minimumBranches} success branch(es)`,
          nodeId: node.id
        });
      }
    } else if (node.kind === 'condition') {
      if (successEdges.length === 0) {
        diagnostics.push({ severity: 'error', code: 'FLOW_CONDITION_ROUTE_REQUIRED', message: `Condition ${node.semanticKey} has no routes`, nodeId: node.id });
      }
    } else if (successEdges.length > 1) {
      diagnostics.push({
        severity: 'error',
        code: 'FLOW_IMPLICIT_FAN_OUT',
        message: `Node ${node.semanticKey} has multiple success routes; use a fork node`,
        nodeId: node.id
      });
    }
    if (failureEdges.length > 1 && failureEdges.some((edge) => !edge.condition)) {
      diagnostics.push({
        severity: 'error',
        code: 'FLOW_AMBIGUOUS_FAILURE_ROUTE',
        message: `Node ${node.semanticKey} has ambiguous failure routes`,
        nodeId: node.id
      });
    }
    if (node.kind === 'join' && nodes[node.id].incomingControlEdgeIds.length < 2) {
      diagnostics.push({
        severity: 'warning',
        code: 'FLOW_JOIN_SINGLE_INPUT',
        message: `Join ${node.semanticKey} has fewer than two incoming branches`,
        nodeId: node.id
      });
    }
    if (node.kind === 'subflow' && !node.config?.relativePath && !node.config?.flowUid) {
      diagnostics.push({
        severity: 'error',
        code: 'FLOW_SUBFLOW_REFERENCE_REQUIRED',
        message: `Subflow ${node.semanticKey} requires relativePath or flowUid`,
        nodeId: node.id
      });
    }
  });

  return {
    compilerVersion: 1,
    flowUid: flow.uid,
    revision: flow.revision,
    entryNodeIds,
    nodeOrder,
    nodes,
    diagnostics
  };
};
