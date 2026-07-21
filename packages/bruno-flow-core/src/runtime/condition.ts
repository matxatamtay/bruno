import type { FlowDefinition } from '../types';
import { getPathValue, resolveOutputValue, type FlowRuntimeOutputs } from './value';

export interface FlowConditionContext {
  flow: FlowDefinition;
  inputs?: Record<string, unknown>;
  dataset?: unknown;
  outputs: FlowRuntimeOutputs;
  results?: Record<string, Record<string, unknown>>;
  error?: { message?: string; code?: string; status?: string } | null;
}

const splitLogical = (source: string, operator: '||' | '&&'): string[] => {
  const parts: string[] = [];
  let quote = '';
  let escaped = false;
  let start = 0;
  for (let index = 0; index < source.length - 1; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = '';
      continue;
    }
    if (char === '"' || char === '\'') {
      quote = char;
      continue;
    }
    if (source.slice(index, index + 2) === operator) {
      parts.push(source.slice(start, index).trim());
      start = index + 2;
      index += 1;
    }
  }
  if (parts.length === 0) return [source.trim()];
  parts.push(source.slice(start).trim());
  return parts;
};

const parseLiteral = (source: string): { matched: boolean; value?: unknown } => {
  const trimmed = source.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith('\'') && trimmed.endsWith('\''))) {
    return { matched: true, value: trimmed.slice(1, -1).replace(/\\(['"\\])/g, '$1') };
  }
  if (trimmed === 'true') return { matched: true, value: true };
  if (trimmed === 'false') return { matched: true, value: false };
  if (trimmed === 'null') return { matched: true, value: null };
  if (trimmed === 'undefined') return { matched: true, value: undefined };
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return { matched: true, value: Number(trimmed) };
  return { matched: false };
};

const nodeByReference = (context: FlowConditionContext, reference: string) => context.flow.nodes.find((node) => (
  node.id === reference || node.semanticKey === reference
));

export const resolveConditionReference = (reference: string, context: FlowConditionContext): unknown => {
  const path = reference.trim().replace(/^\$\.?/, '');
  if (!path) return undefined;
  if (path === 'inputs') return context.inputs;
  if (path.startsWith('inputs.')) return getPathValue(context.inputs, path.slice('inputs.'.length));
  if (path === 'dataset') return context.dataset;
  if (path.startsWith('dataset.')) return getPathValue(context.dataset, path.slice('dataset.'.length));
  if (path === 'error') return context.error;
  if (path.startsWith('error.')) return getPathValue(context.error, path.slice('error.'.length));
  if (path.startsWith('results.')) {
    const [, nodeReference, ...parts] = path.split('.');
    const node = nodeByReference(context, nodeReference);
    return getPathValue(context.results?.[node?.id || nodeReference], parts.join('.'));
  }
  if (path.startsWith('nodes.')) {
    const [, nodeReference, ...parts] = path.split('.');
    const node = nodeByReference(context, nodeReference);
    if (!node) return undefined;
    const outputPath = parts.join('.') || 'value';
    return resolveOutputValue(context.outputs, node.id, outputPath)?.value;
  }
  const inputValue = getPathValue(context.inputs, path);
  if (inputValue !== undefined) return inputValue;
  return getPathValue(context.dataset, path);
};

const operand = (source: string, context: FlowConditionContext, preferReference = false): unknown => {
  const literal = parseLiteral(source);
  if (literal.matched) return literal.value;
  const resolved = resolveConditionReference(source, context);
  if (resolved !== undefined || preferReference) return resolved;
  return source.trim();
};

const compare = (left: unknown, operator: string, right: unknown): boolean => {
  switch (operator) {
    case '===': return left === right;
    case '!==': return left !== right;
    case '==': return left == right;
    case '!=': return left != right;
    case '>': return Number(left) > Number(right);
    case '>=': return Number(left) >= Number(right);
    case '<': return Number(left) < Number(right);
    case '<=': return Number(left) <= Number(right);
    case 'contains': {
      if (Array.isArray(left)) return left.includes(right);
      return String(left ?? '').includes(String(right ?? ''));
    }
    default: return false;
  }
};

const evaluateAtomic = (source: string, context: FlowConditionContext): boolean => {
  const trimmed = source.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('!') && !trimmed.startsWith('!=')) return !evaluateAtomic(trimmed.slice(1), context);
  const match = trimmed.match(/^(.+?)\s*(===|!==|==|!=|>=|<=|>|<|\bcontains\b)\s*(.+)$/);
  if (match) return compare(operand(match[1], context, true), match[2], operand(match[3], context));
  return Boolean(operand(trimmed, context, true));
};

export const evaluateFlowCondition = (expression: string | undefined, context: FlowConditionContext): boolean => {
  const source = String(expression || '').trim();
  if (!source) return true;
  const orParts = splitLogical(source, '||');
  if (orParts.length > 1) return orParts.some((part) => evaluateFlowCondition(part, context));
  const andParts = splitLogical(source, '&&');
  if (andParts.length > 1) return andParts.every((part) => evaluateFlowCondition(part, context));
  return evaluateAtomic(source, context);
};
