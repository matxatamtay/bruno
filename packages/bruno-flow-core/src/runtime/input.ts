import type { FlowDefinition, FlowNode, JsonObject } from '../types';
import {
  createRuntimeValue,
  getPathValue,
  type FlowNodeOutput,
  type FlowRuntimeValue
} from './value';

export interface FlowInputIssue {
  path: string;
  message: string;
  keyword: string;
}

export interface EnvironmentRuntimeEntry {
  value: unknown;
  secret?: boolean;
}

export interface FlowInputContext {
  formValues?: Record<string, unknown>;
  environmentValues?: Record<string, unknown | EnvironmentRuntimeEntry>;
  dataset?: unknown;
}

const typeMatches = (value: unknown, type: unknown): boolean => {
  if (!type) return true;
  if (Array.isArray(type)) return type.some((candidate) => typeMatches(value, candidate));
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  return typeof value === type;
};

export const resolveFlowInputs = (
  inputSchema: JsonObject | undefined,
  supplied: Record<string, unknown> = {}
): { values: Record<string, unknown>; issues: FlowInputIssue[] } => {
  const schema = inputSchema || {};
  const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
  const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
  const values = { ...supplied };
  const issues: FlowInputIssue[] = [];

  Object.entries(properties).forEach(([key, definition]) => {
    if (values[key] === undefined && definition.default !== undefined) values[key] = definition.default;
    if (values[key] === undefined) {
      if (required.has(key)) issues.push({ path: `/${key}`, message: 'is required', keyword: 'required' });
      return;
    }
    if (!typeMatches(values[key], definition.type)) {
      issues.push({ path: `/${key}`, message: `must be ${String(definition.type)}`, keyword: 'type' });
    }
    if (Array.isArray(definition.enum) && !definition.enum.some((candidate) => Object.is(candidate, values[key]))) {
      issues.push({ path: `/${key}`, message: 'must match an allowed value', keyword: 'enum' });
    }
  });

  return { values, issues };
};

const environmentEntry = (value: unknown | EnvironmentRuntimeEntry): EnvironmentRuntimeEntry => {
  if (value && typeof value === 'object' && 'value' in value) return value as EnvironmentRuntimeEntry;
  return { value, secret: false };
};

export const resolveInputNode = (
  flow: FlowDefinition,
  node: FlowNode,
  context: FlowInputContext
): FlowNodeOutput => {
  const outputPath = String(node.config?.outputPath || 'value');
  let runtimeValue: FlowRuntimeValue;

  if (node.kind === 'static-input') {
    runtimeValue = createRuntimeValue(node.config?.value, {
      secret: Boolean(node.config?.secret),
      provenance: [{ kind: 'input', nodeId: node.id, path: outputPath, detail: 'static' }]
    });
  } else if (node.kind === 'form-input') {
    const fieldName = String(node.config?.fieldName || node.semanticKey);
    const resolvedInputs = resolveFlowInputs(flow.inputSchema, context.formValues || {});
    const issue = resolvedInputs.issues.find((candidate) => candidate.path === `/${fieldName}`);
    if (issue) throw new Error(`Form input ${fieldName} ${issue.message}`);
    if (!(fieldName in resolvedInputs.values)) throw new Error(`Form input ${fieldName} is missing`);
    runtimeValue = createRuntimeValue(resolvedInputs.values[fieldName], {
      secret: Boolean(node.config?.secret),
      provenance: [{ kind: 'input', nodeId: node.id, path: fieldName, detail: 'form' }]
    });
  } else if (node.kind === 'environment-input' || node.kind === 'secret-reference') {
    const variable = String(node.config?.variable || node.semanticKey);
    if (!(variable in (context.environmentValues || {}))) throw new Error(`Environment variable ${variable} is missing`);
    const entry = environmentEntry((context.environmentValues || {})[variable]);
    runtimeValue = createRuntimeValue(entry.value, {
      secret: node.kind === 'secret-reference' || Boolean(entry.secret) || Boolean(node.config?.secret),
      provenance: [{ kind: 'environment', nodeId: node.id, path: variable }]
    });
  } else if (node.kind === 'dynamic-data') {
    const options = Array.isArray(node.config?.options) ? node.config.options as Record<string, unknown>[] : [];
    const selectedId = String(node.config?.selectedOptionId || options[0]?.id || '');
    const selected = options.find((option) => String(option.id) === selectedId) || options[0];
    if (!selected) throw new Error(`Dynamic data node ${node.id} has no cases`);
    runtimeValue = createRuntimeValue(selected.value, {
      secret: Boolean(node.config?.secret),
      provenance: [{ kind: 'input', nodeId: node.id, path: outputPath, detail: `dynamic-data:${String(selected.id || '')}` }]
    });
  } else if (node.kind === 'dataset-input') {
    const datasetPath = String(node.config?.datasetPath || '');
    const value = getPathValue(context.dataset, datasetPath);
    if (value === undefined) throw new Error(`Dataset path ${datasetPath || '$'} is missing`);
    runtimeValue = createRuntimeValue(value, {
      secret: Boolean(node.config?.secret),
      provenance: [{ kind: 'input', nodeId: node.id, path: datasetPath, detail: 'dataset' }]
    });
  } else {
    throw new Error(`Node ${node.id} is not an input node`);
  }

  return {
    [outputPath]: runtimeValue,
    ...(outputPath === 'value' ? {} : { value: runtimeValue })
  };
};
