import type { FlowDataEdge, FlowDefinition, FlowNode } from '../types';
import {
  REDACTED_RUNTIME_VALUE,
  SENSITIVE_RUNTIME_KEY_PATTERN,
  appendProvenance,
  createRuntimeValue,
  getPathValue,
  resolveOutputValue,
  safeProjectUnknown,
  setPathValue,
  type FlowProvenanceEntry,
  type FlowRuntimeOutputs,
  type FlowRuntimeValue
} from './value';

const clone = <T>(value: T): T => {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

const scalarString = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

const upsertListValue = (
  list: unknown,
  name: string,
  value: unknown,
  type?: 'query' | 'path'
): unknown[] => {
  const entries = Array.isArray(list) ? clone(list) as Record<string, unknown>[] : [];
  const index = entries.findIndex((entry) => entry.name === name || entry.key === name);
  const next = {
    ...(index >= 0 ? entries[index] : {}),
    uid: index >= 0 ? entries[index].uid : undefined,
    name,
    value: scalarString(value),
    enabled: true,
    ...(type ? { type } : {})
  };
  if (next.uid === undefined) delete next.uid;
  if (index >= 0) entries[index] = next;
  else entries.push(next);
  return entries;
};

const parseJsonBody = (body: unknown): unknown => {
  if (!body || typeof body !== 'object') return {};
  const bodyRecord = body as Record<string, unknown>;
  if (bodyRecord.mode === 'json') {
    if (typeof bodyRecord.json === 'string' && bodyRecord.json.trim()) {
      try {
        return JSON.parse(bodyRecord.json);
      } catch {
        return {};
      }
    }
    if (bodyRecord.json && typeof bodyRecord.json === 'object') return clone(bodyRecord.json);
  }
  return clone(bodyRecord);
};

const injectBody = (request: Record<string, unknown>, path: string, value: unknown): void => {
  const existingBody = request.body;
  const nextBodyValue = path === '$' || !path
    ? clone(value)
    : setPathValue(parseJsonBody(existingBody), path, value);
  if (existingBody && typeof existingBody === 'object' && (existingBody as Record<string, unknown>).mode === 'json') {
    request.body = {
      ...(existingBody as Record<string, unknown>),
      json: JSON.stringify(nextBodyValue)
    };
  } else {
    request.body = { mode: 'json', json: JSON.stringify(nextBodyValue) };
  }
};

export const applyBindingTransform = (runtimeValue: FlowRuntimeValue, transform?: string): FlowRuntimeValue => {
  const normalized = String(transform || '').trim();
  if (!normalized || normalized === 'identity') return runtimeValue;
  let value: unknown;
  switch (normalized) {
    case 'string': value = scalarString(runtimeValue.value); break;
    case 'number': value = Number(runtimeValue.value); break;
    case 'boolean': value = Boolean(runtimeValue.value); break;
    case 'json-stringify': value = JSON.stringify(runtimeValue.value); break;
    case 'json-parse': value = typeof runtimeValue.value === 'string' ? JSON.parse(runtimeValue.value) : runtimeValue.value; break;
    default: throw new Error(`Unsupported data transform: ${normalized}`);
  }
  return appendProvenance(createRuntimeValue(value, {
    secret: runtimeValue.secret,
    provenance: runtimeValue.provenance
  }), { kind: 'transform', detail: normalized });
};

export interface ResolvedBindingProjection {
  edgeId: string;
  sourceNodeId: string;
  sourcePath: string;
  targetPath: string;
  secret: boolean;
  value: unknown;
  provenance: FlowProvenanceEntry[];
}

export interface ResolvedRequestPreview {
  method: string | null;
  url: string | null;
  pathParams: Record<string, unknown>;
  query: Record<string, unknown>;
  headers: Record<string, unknown>;
  body: unknown;
  runtimeVariables: Record<string, unknown>;
  provenance: Record<string, FlowProvenanceEntry[]>;
  taint: Record<string, boolean>;
}

const previewList = (entries: unknown, type?: 'query' | 'path'): Record<string, unknown> => Object.fromEntries((Array.isArray(entries) ? entries : [])
  .filter((entry) => entry && typeof entry === 'object' && (entry as Record<string, unknown>).enabled !== false)
  .filter((entry) => !type || (type === 'query'
    ? (entry as Record<string, unknown>).type !== 'path'
    : (entry as Record<string, unknown>).type === 'path'))
  .map((entry) => {
    const record = entry as Record<string, unknown>;
    return [String(record.name || record.key || ''), record.value];
  })
  .filter(([key]) => key));

const redactPath = (value: unknown, path: string): unknown => (
  path === '$' || !path ? REDACTED_RUNTIME_VALUE : setPathValue(value, path, REDACTED_RUNTIME_VALUE)
);

const createPreview = (
  item: Record<string, unknown>,
  runtimeVariables: Record<string, unknown>,
  taint: Record<string, boolean>,
  provenance: Record<string, FlowProvenanceEntry[]>
): ResolvedRequestPreview => {
  const request = ((item.draft as Record<string, unknown> | undefined)?.request || item.request || {}) as Record<string, unknown>;
  const pathParams = safeProjectUnknown(previewList(request.params, 'path')) as Record<string, unknown>;
  const query = safeProjectUnknown(previewList(request.params, 'query')) as Record<string, unknown>;
  const headers = safeProjectUnknown(previewList(request.headers)) as Record<string, unknown>;
  let body = safeProjectUnknown(parseJsonBody(request.body));
  const safeRuntimeVariables = safeProjectUnknown(runtimeVariables) as Record<string, unknown>;

  Object.entries(taint).forEach(([targetPath, secret]) => {
    if (!secret) return;
    const [, channel, ...parts] = targetPath.split('.');
    const key = parts.join('.');
    if (targetPath.startsWith('runtime.')) {
      safeRuntimeVariables[targetPath.slice('runtime.'.length)] = REDACTED_RUNTIME_VALUE;
    }
    if (channel === 'path') pathParams[key] = REDACTED_RUNTIME_VALUE;
    if (channel === 'query') query[key] = REDACTED_RUNTIME_VALUE;
    if (channel === 'header') headers[key] = REDACTED_RUNTIME_VALUE;
    if (channel === 'body') body = redactPath(body, key);
  });

  return {
    method: typeof request.method === 'string' ? request.method : null,
    url: typeof request.url === 'string' ? request.url : null,
    pathParams,
    query,
    headers,
    body,
    runtimeVariables: safeRuntimeVariables,
    provenance,
    taint
  };
};

const resolveEdgeValue = (edge: FlowDataEdge, outputs: FlowRuntimeOutputs): FlowRuntimeValue | undefined => {
  const source = resolveOutputValue(outputs, edge.source.nodeId, edge.source.path);
  return source ? applyBindingTransform(source, edge.transform) : undefined;
};

export const resolveRequestBindings = ({
  flow,
  node,
  item,
  outputs
}: {
  flow: FlowDefinition;
  node: FlowNode;
  item: Record<string, unknown>;
  outputs: FlowRuntimeOutputs;
}): {
  item: Record<string, unknown>;
  runtimeVariables: Record<string, unknown>;
  preview: ResolvedRequestPreview;
  bindings: ResolvedBindingProjection[];
} => {
  const resolvedItem = clone(item);
  const draft = resolvedItem.draft as Record<string, unknown> | undefined;
  const request = clone(((draft?.request || resolvedItem.request || {}) as Record<string, unknown>));
  if (draft) resolvedItem.draft = { ...draft, request };
  else resolvedItem.request = request;

  const runtimeVariables: Record<string, unknown> = {};
  const provenance: Record<string, FlowProvenanceEntry[]> = {};
  const taint: Record<string, boolean> = {};
  const bindings: ResolvedBindingProjection[] = [];
  const overrides = (node.config?.requestOverrides || {}) as Record<string, Record<string, unknown>>;

  Object.entries(overrides).forEach(([channel, values]) => {
    Object.entries(values || {}).forEach(([key, value]) => {
      const targetPath = channel === 'runtime' ? `runtime.${key}` : `request.${channel}.${key}`;
      if (channel === 'runtime') runtimeVariables[key] = clone(value);
      else if (channel === 'query') request.params = upsertListValue(request.params, key, value, 'query');
      else if (channel === 'path') request.params = upsertListValue(request.params, key, value, 'path');
      else if (channel === 'header') request.headers = upsertListValue(request.headers, key, value);
      else if (channel === 'body') injectBody(request, key, value);
      else return;

      const secret = SENSITIVE_RUNTIME_KEY_PATTERN.test(targetPath);
      provenance[targetPath] = [{
        kind: 'input',
        nodeId: node.id,
        path: targetPath,
        detail: 'node-local override'
      }];
      taint[targetPath] = secret;
    });
  });

  flow.dataEdges
    .filter((edge) => edge.target.nodeId === node.id && (edge.target.path.startsWith('request.') || edge.target.path.startsWith('runtime.')))
    .forEach((edge) => {
      const runtimeValue = resolveEdgeValue(edge, outputs);
      if (!runtimeValue) {
        if (edge.required !== false) throw new Error(`Required binding ${edge.target.path} has no value`);
        return;
      }
      const [root, channel, ...parts] = edge.target.path.split('.');
      const key = root === 'runtime' ? [channel, ...parts].join('.') : parts.join('.');
      if (!key) throw new Error(`Binding target ${edge.target.path} is invalid`);
      if (root === 'runtime') runtimeVariables[key] = runtimeValue.value;
      else if (channel === 'query') request.params = upsertListValue(request.params, key, runtimeValue.value, 'query');
      else if (channel === 'path') request.params = upsertListValue(request.params, key, runtimeValue.value, 'path');
      else if (channel === 'header') request.headers = upsertListValue(request.headers, key, runtimeValue.value);
      else if (channel === 'body') injectBody(request, key, runtimeValue.value);
      else throw new Error(`Unsupported request binding channel: ${channel}`);

      const secret = runtimeValue.secret || SENSITIVE_RUNTIME_KEY_PATTERN.test(edge.target.path);
      const bindingProvenance = [...runtimeValue.provenance, {
        kind: 'binding' as const,
        nodeId: node.id,
        sourceNodeId: edge.source.nodeId,
        edgeId: edge.id,
        path: edge.target.path
      }];
      provenance[edge.target.path] = bindingProvenance;
      taint[edge.target.path] = secret;
      bindings.push({
        edgeId: edge.id,
        sourceNodeId: edge.source.nodeId,
        sourcePath: edge.source.path,
        targetPath: edge.target.path,
        secret,
        value: secret ? REDACTED_RUNTIME_VALUE : safeProjectUnknown(runtimeValue.value),
        provenance: bindingProvenance
      });
    });

  return {
    item: resolvedItem,
    runtimeVariables,
    preview: createPreview(resolvedItem, runtimeVariables, taint, provenance),
    bindings
  };
};

export const extractResponseValue = (
  node: FlowNode,
  outputs: FlowRuntimeOutputs,
  incomingEdges: FlowDataEdge[]
): FlowRuntimeValue => {
  const sourceNodeId = String(node.config?.sourceNodeId || incomingEdges[0]?.source.nodeId || '');
  const sourcePath = String(node.config?.sourcePath || incomingEdges[0]?.source.path || 'response.body');
  if (!sourceNodeId) throw new Error(`Response extractor ${node.id} has no source request`);
  const source = resolveOutputValue(outputs, sourceNodeId, sourcePath);
  if (!source) throw new Error(`Response extractor ${node.id} could not resolve ${sourceNodeId}.${sourcePath}`);
  const incomingEdge = incomingEdges[0];
  const transformedSource = incomingEdge
    ? appendProvenance(applyBindingTransform(source, incomingEdge.transform), {
        kind: 'binding',
        nodeId: node.id,
        sourceNodeId,
        edgeId: incomingEdge.id,
        path: incomingEdge.target.path
      })
    : source;
  const valuePath = String(node.config?.path || '');
  const value = valuePath ? getPathValue(transformedSource.value, valuePath) : transformedSource.value;
  if (value === undefined) throw new Error(`Response extractor ${node.id} path ${valuePath || '$'} is missing`);
  return createRuntimeValue(value, {
    secret: transformedSource.secret || Boolean(node.config?.secret) || SENSITIVE_RUNTIME_KEY_PATTERN.test(valuePath),
    provenance: [...transformedSource.provenance, {
      kind: 'extractor',
      nodeId: node.id,
      sourceNodeId,
      path: valuePath || '$'
    }]
  });
};
