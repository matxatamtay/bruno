import type { JsonValue } from '../types';

export const REDACTED_RUNTIME_VALUE = '[REDACTED]';
export const SENSITIVE_RUNTIME_KEY_PATTERN = /(^|[-_.])(authorization|cookie|set-cookie|password|passwd|secret|token|api[-_.]?key|client[-_.]?secret)([-_.]|$)/i;

export type FlowProvenanceKind = 'input' | 'environment' | 'binding' | 'response' | 'extractor' | 'merge' | 'transform' | 'subflow' | 'checkpoint';

export interface FlowProvenanceEntry {
  kind: FlowProvenanceKind;
  nodeId?: string;
  sourceNodeId?: string;
  edgeId?: string;
  path?: string;
  detail?: string;
}

export interface FlowRuntimeValue<T = unknown> {
  value: T;
  secret: boolean;
  provenance: FlowProvenanceEntry[];
}

export type FlowNodeOutput = Record<string, FlowRuntimeValue>;
export type FlowRuntimeOutputs = Map<string, FlowNodeOutput>;

const isObject = (value: unknown): value is Record<string, unknown> => (
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const cloneValue = <T>(value: T): T => {
  if (value === undefined || value === null || typeof value !== 'object') return value;
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
};

export const createRuntimeValue = <T>(
  value: T,
  options: { secret?: boolean; provenance?: FlowProvenanceEntry[] } = {}
): FlowRuntimeValue<T> => ({
  value,
  secret: Boolean(options.secret),
  provenance: [...(options.provenance || [])]
});

export const appendProvenance = <T>(
  runtimeValue: FlowRuntimeValue<T>,
  entry: FlowProvenanceEntry,
  secret = runtimeValue.secret
): FlowRuntimeValue<T> => ({
  value: runtimeValue.value,
  secret,
  provenance: [...runtimeValue.provenance, entry]
});

export const getPathValue = (value: unknown, path = ''): unknown => {
  if (!path || path === 'value' || path === '$') return value;
  const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
  let cursor = value;
  for (const part of parts) {
    if (cursor === null || cursor === undefined) return undefined;
    if (Array.isArray(cursor) && /^\d+$/.test(part)) {
      cursor = cursor[Number(part)];
    } else if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cursor;
};

export const setPathValue = (target: unknown, path: string, value: unknown): unknown => {
  if (!path || path === 'value' || path === '$') return cloneValue(value);
  const root: Record<string, unknown> = isObject(target) ? cloneValue(target) : {};
  const parts = path.replace(/^\$\.?/, '').split('.').filter(Boolean);
  let cursor = root;
  parts.forEach((part, index) => {
    if (index === parts.length - 1) {
      cursor[part] = cloneValue(value);
      return;
    }
    const next = cursor[part];
    cursor[part] = isObject(next) ? cloneValue(next) : {};
    cursor = cursor[part] as Record<string, unknown>;
  });
  return root;
};

export const resolveOutputValue = (
  outputs: FlowRuntimeOutputs,
  nodeId: string,
  path = 'value'
): FlowRuntimeValue | undefined => {
  const nodeOutput = outputs.get(nodeId);
  if (!nodeOutput) return undefined;
  if (nodeOutput[path]) return nodeOutput[path];
  if (nodeOutput.value) {
    const nested = getPathValue(nodeOutput.value.value, path);
    if (nested !== undefined) {
      return createRuntimeValue(nested, {
        secret: nodeOutput.value.secret,
        provenance: nodeOutput.value.provenance
      });
    }
  }
  const rootKey = Object.keys(nodeOutput).find((candidate) => path.startsWith(`${candidate}.`));
  if (!rootKey) return undefined;
  const nested = getPathValue(nodeOutput[rootKey].value, path.slice(rootKey.length + 1));
  if (nested === undefined) return undefined;
  return createRuntimeValue(nested, {
    secret: nodeOutput[rootKey].secret,
    provenance: nodeOutput[rootKey].provenance
  });
};

const mergeObjects = (left: unknown, right: unknown, path: string, conflicts: string[]): unknown => {
  if (!isObject(left) || !isObject(right)) {
    if (left !== undefined && right !== undefined && JSON.stringify(left) !== JSON.stringify(right)) conflicts.push(path || '$');
    return cloneValue(right);
  }
  const result: Record<string, unknown> = cloneValue(left);
  Object.entries(right).forEach(([key, value]) => {
    const childPath = path ? `${path}.${key}` : key;
    result[key] = key in result ? mergeObjects(result[key], value, childPath, conflicts) : cloneValue(value);
  });
  return result;
};

export interface MergeRuntimeResult extends FlowRuntimeValue {
  conflicts: string[];
}

export const mergeRuntimeValues = (
  values: FlowRuntimeValue[],
  options: { strategy?: 'last-write-wins' | 'first-write-wins' } = {}
): MergeRuntimeResult => {
  const strategy = options.strategy || 'last-write-wins';
  const ordered = strategy === 'first-write-wins' ? [...values].reverse() : values;
  const conflicts: string[] = [];
  let merged: unknown = {};
  ordered.forEach((runtimeValue) => {
    merged = mergeObjects(merged, runtimeValue.value, '', conflicts);
  });
  return {
    value: merged,
    secret: values.some((runtimeValue) => runtimeValue.secret),
    provenance: values.flatMap((runtimeValue) => runtimeValue.provenance),
    conflicts: [...new Set(conflicts)]
  };
};

export const safeProjectUnknown = (
  value: unknown,
  key = '',
  depth = 0,
  seen = new WeakSet<object>()
): unknown => {
  if (SENSITIVE_RUNTIME_KEY_PATTERN.test(key)) return REDACTED_RUNTIME_VALUE;
  if (value === null || value === undefined || typeof value !== 'object') return value;
  if (depth >= 12) return '[TRUNCATED]';
  if (seen.has(value as object)) return '[CIRCULAR]';
  seen.add(value as object);
  if (Array.isArray(value)) {
    return value.map((entry) => safeProjectUnknown(entry, key, depth + 1, seen));
  }
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, childValue]) => [
    childKey,
    safeProjectUnknown(childValue, childKey, depth + 1, seen)
  ]));
};

export const safeProjectRuntimeValue = (runtimeValue: FlowRuntimeValue | undefined): unknown => {
  if (!runtimeValue) return undefined;
  return runtimeValue.secret ? REDACTED_RUNTIME_VALUE : safeProjectUnknown(runtimeValue.value);
};

export const safeProjectOutputs = (outputs: FlowRuntimeOutputs): Record<string, Record<string, unknown>> => {
  const projection: Record<string, Record<string, unknown>> = {};
  outputs.forEach((nodeOutput, nodeId) => {
    projection[nodeId] = Object.fromEntries(Object.entries(nodeOutput).map(([path, runtimeValue]) => [
      path,
      {
        value: safeProjectRuntimeValue(runtimeValue),
        secret: runtimeValue.secret,
        provenance: runtimeValue.provenance
      }
    ]));
  });
  return projection;
};

export const toJsonValue = (value: unknown): JsonValue => value as JsonValue;
