const { createHash, randomUUID } = require('node:crypto');
const { compileFlow, serializeFlowDocument, validateFlowDefinition } = require('@usebruno/flow-core');

const FORBIDDEN_PATHS = new Set(['/revision', '/uid', '/schemaVersion', '/workspace', '/workspace/uid']);
const MAX_OPERATIONS = 100;

const clone = (value) => typeof structuredClone === 'function'
  ? structuredClone(value)
  : JSON.parse(JSON.stringify(value));

const decodePointerPart = (part) => part.replace(/~1/g, '/').replace(/~0/g, '~');

const parsePointer = (pointer) => {
  if (typeof pointer !== 'string' || !pointer.startsWith('/')) throw new Error(`Invalid JSON pointer: ${pointer}`);
  if (FORBIDDEN_PATHS.has(pointer) || [...FORBIDDEN_PATHS].some((prefix) => pointer.startsWith(`${prefix}/`))) {
    throw new Error(`Flow patch cannot modify protected path ${pointer}`);
  }
  return pointer.slice(1).split('/').map(decodePointerPart);
};

const resolveParent = (document, parts) => {
  if (parts.length === 0) throw new Error('Flow patch must target a child path');
  let parent = document;
  for (const part of parts.slice(0, -1)) {
    if (!parent || typeof parent !== 'object' || !(part in parent)) throw new Error(`Flow patch path does not exist: /${parts.join('/')}`);
    parent = parent[part];
  }
  return { parent, key: parts.at(-1) };
};

const applyFlowPatchOperations = (flow, operations) => {
  if (!Array.isArray(operations) || operations.length === 0) throw new TypeError('Flow patch requires operations');
  if (operations.length > MAX_OPERATIONS) throw new Error(`Flow patch exceeds ${MAX_OPERATIONS} operations`);
  const next = clone(flow);
  operations.forEach((operation, index) => {
    const op = String(operation?.op || '');
    if (!['add', 'replace', 'remove'].includes(op)) throw new Error(`Unsupported flow patch operation at index ${index}: ${op}`);
    const parts = parsePointer(operation.path);
    const { parent, key } = resolveParent(next, parts);
    if (Array.isArray(parent)) {
      if (key === '-' && op === 'add') {
        parent.push(clone(operation.value));
        return;
      }
      const arrayIndex = Number(key);
      if (!Number.isInteger(arrayIndex) || arrayIndex < 0 || arrayIndex > parent.length) throw new Error(`Invalid array index in ${operation.path}`);
      if (op === 'remove') {
        if (arrayIndex >= parent.length) throw new Error(`Flow patch path does not exist: ${operation.path}`);
        parent.splice(arrayIndex, 1);
      } else if (op === 'add') {
        parent.splice(arrayIndex, 0, clone(operation.value));
      } else {
        if (arrayIndex >= parent.length) throw new Error(`Flow patch path does not exist: ${operation.path}`);
        parent[arrayIndex] = clone(operation.value);
      }
      return;
    }
    if (!parent || typeof parent !== 'object') throw new Error(`Flow patch parent is not an object: ${operation.path}`);
    if (op === 'remove') {
      if (!(key in parent)) throw new Error(`Flow patch path does not exist: ${operation.path}`);
      delete parent[key];
    } else {
      if (op === 'replace' && !(key in parent)) throw new Error(`Flow patch path does not exist: ${operation.path}`);
      parent[key] = clone(operation.value);
    }
  });
  return next;
};

const hashOperations = (operations) => createHash('sha256').update(JSON.stringify(operations)).digest('hex');

class FlowPatchPreviewStore {
  constructor({ ttlMs = 10 * 60_000, now = () => Date.now(), idFactory = randomUUID } = {}) {
    this.ttlMs = Math.max(60_000, Math.min(30 * 60_000, Number(ttlMs) || 10 * 60_000));
    this.now = now;
    this.idFactory = idFactory;
    this.previews = new Map();
  }

  prune() {
    const now = this.now();
    for (const [id, preview] of this.previews) {
      if (preview.expiresAt <= now || preview.used) this.previews.delete(id);
    }
  }

  create({ workspaceUid, flowUid, relativePath, expectedRevision, operations, proposedRevision }) {
    this.prune();
    const previewId = this.idFactory();
    const preview = {
      previewId,
      workspaceUid,
      flowUid,
      relativePath,
      expectedRevision,
      operationsHash: hashOperations(operations),
      proposedRevision,
      expiresAt: this.now() + this.ttlMs,
      used: false
    };
    this.previews.set(previewId, preview);
    return preview;
  }

  consume({ previewId, workspaceUid, flowUid, relativePath, expectedRevision, operations }) {
    this.prune();
    const preview = this.previews.get(String(previewId || ''));
    if (!preview) throw new Error('Flow patch preview is missing or expired; create a new preview');
    const matches = preview.workspaceUid === workspaceUid
      && preview.flowUid === flowUid
      && preview.relativePath === relativePath
      && preview.expectedRevision === expectedRevision
      && preview.operationsHash === hashOperations(operations);
    if (!matches) throw new Error('Flow patch apply does not match the approved preview');
    preview.used = true;
    this.previews.delete(preview.previewId);
    return preview;
  }
}

const analyzePatchedFlow = (flow) => {
  const serialized = serializeFlowDocument(flow);
  const validationIssues = validateFlowDefinition(serialized.flow);
  const compiled = validationIssues.length === 0 ? compileFlow(serialized.flow) : null;
  return {
    flow: serialized.flow,
    revision: serialized.flow.revision,
    validationIssues,
    diagnostics: compiled?.diagnostics || []
  };
};

module.exports = {
  FlowPatchPreviewStore,
  analyzePatchedFlow,
  applyFlowPatchOperations,
  hashOperations
};
