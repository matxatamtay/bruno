import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import flowSchemaV1Json from './schema/flow-schema-v1.schema.json';
import { FlowValidationError } from './errors';
import type { FlowDefinition, FlowValidationIssue } from './types';

export const flowSchemaV1 = flowSchemaV1Json;

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: false
});

const validateSchemaV1 = ajv.compile(flowSchemaV1Json);

const formatAjvIssue = (error: ErrorObject): FlowValidationIssue => ({
  path: error.instancePath || '/',
  message: error.message || 'is invalid',
  keyword: error.keyword
});

const findDuplicates = (values: string[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  values.forEach((value) => {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  });
  return [...duplicates];
};

const FORBIDDEN_PERSISTED_KEYS = new Set([
  'runtimeState',
  'runtimeStatus',
  'executionState',
  'resolvedSecret',
  'resolvedSecrets',
  'responseBody',
  'runHistory',
  'lastRunResult'
]);

const validateForbiddenKeys = (value: unknown, path: string, issues: FlowValidationIssue[]): void => {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateForbiddenKeys(entry, `${path}/${index}`, issues));
    return;
  }

  if (!value || typeof value !== 'object') return;

  Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
    const entryPath = `${path}/${key}`;
    if (FORBIDDEN_PERSISTED_KEYS.has(key)) {
      issues.push({ path: entryPath, message: 'must not persist runtime state or resolved secret data', keyword: 'forbidden' });
    }
    validateForbiddenKeys(entry, entryPath, issues);
  });
};

const validateSemanticReferences = (flow: FlowDefinition): FlowValidationIssue[] => {
  const issues: FlowValidationIssue[] = [];
  const nodeIds = new Set(flow.nodes.map((node) => node.id));
  const frameIds = new Set(flow.frames.map((frame) => frame.id));

  findDuplicates(flow.nodes.map((node) => node.id)).forEach((id) => {
    issues.push({ path: '/nodes', message: `contains duplicate node id ${id}`, keyword: 'unique' });
  });
  findDuplicates(flow.nodes.map((node) => node.semanticKey)).forEach((semanticKey) => {
    issues.push({ path: '/nodes', message: `contains duplicate semanticKey ${semanticKey}`, keyword: 'unique' });
  });
  findDuplicates([
    ...flow.controlEdges.map((edge) => edge.id),
    ...flow.dataEdges.map((edge) => edge.id),
    ...flow.frames.map((frame) => frame.id)
  ]).forEach((id) => {
    issues.push({ path: '/', message: `contains duplicate graph entity id ${id}`, keyword: 'unique' });
  });

  flow.nodes.forEach((node, index) => {
    if (node.frameId && !frameIds.has(node.frameId)) {
      issues.push({ path: `/nodes/${index}/frameId`, message: `references missing frame ${node.frameId}`, keyword: 'reference' });
    }
  });

  flow.frames.forEach((frame, index) => {
    if (frame.parentFrameId && !frameIds.has(frame.parentFrameId)) {
      issues.push({ path: `/frames/${index}/parentFrameId`, message: `references missing frame ${frame.parentFrameId}`, keyword: 'reference' });
    }
    if (frame.parentFrameId === frame.id) {
      issues.push({ path: `/frames/${index}/parentFrameId`, message: 'cannot reference itself', keyword: 'reference' });
    }
  });

  flow.controlEdges.forEach((edge, index) => {
    if (!nodeIds.has(edge.sourceNodeId)) {
      issues.push({ path: `/controlEdges/${index}/sourceNodeId`, message: `references missing node ${edge.sourceNodeId}`, keyword: 'reference' });
    }
    if (!nodeIds.has(edge.targetNodeId)) {
      issues.push({ path: `/controlEdges/${index}/targetNodeId`, message: `references missing node ${edge.targetNodeId}`, keyword: 'reference' });
    }
  });

  flow.dataEdges.forEach((edge, index) => {
    if (!nodeIds.has(edge.source.nodeId)) {
      issues.push({ path: `/dataEdges/${index}/source/nodeId`, message: `references missing node ${edge.source.nodeId}`, keyword: 'reference' });
    }
    if (!nodeIds.has(edge.target.nodeId)) {
      issues.push({ path: `/dataEdges/${index}/target/nodeId`, message: `references missing node ${edge.target.nodeId}`, keyword: 'reference' });
    }
  });

  validateForbiddenKeys(flow, '', issues);
  return issues;
};

export const validateFlowDefinition = (flow: FlowDefinition): FlowValidationIssue[] => {
  const valid = validateSchemaV1(flow);
  const issues = valid ? [] : (validateSchemaV1.errors || []).map(formatAjvIssue);
  return [...issues, ...validateSemanticReferences(flow)];
};

export const assertValidFlowDefinition = (flow: FlowDefinition): FlowDefinition => {
  const issues = validateFlowDefinition(flow);
  if (issues.length > 0) {
    throw new FlowValidationError(issues);
  }
  return flow;
};
