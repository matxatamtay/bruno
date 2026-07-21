const path = require('node:path');
const net = require('node:net');
const { randomUUID } = require('node:crypto');
const {
  compileFlow,
  normalizeFlowDefinition,
  validateFlowDefinition
} = require('@usebruno/flow-core');
const { BrunoWorkspaceCatalog } = require('./workspace-catalog');
const { BrunoRequestContextResolver, environmentProjection } = require('./request-context-resolver');
const { redactMcpValue } = require('./redaction');
const {
  FlowPatchPreviewStore,
  analyzePatchedFlow,
  applyFlowPatchOperations
} = require('./flow-patch');

const REQUEST_KINDS = new Set(['http', 'graphql', 'websocket', 'grpc-unary', 'sse']);
const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./
];
const BLOCKED_METADATA_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal', 'metadata.google.com']);

const withTimeout = async (promise, timeoutMs, label) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error(`${label} timed out after ${timeoutMs}ms`);
      error.code = 'BRUNO_MCP_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const hostnameMatches = (hostname, pattern) => {
  if (pattern === '*') return true;
  if (pattern.startsWith('*.')) return hostname === pattern.slice(2) || hostname.endsWith(`.${pattern.slice(2)}`);
  return hostname === pattern;
};

const normalizeHostname = (hostname) => String(hostname || '')
  .trim()
  .toLowerCase()
  .replace(/^\[|\]$/g, '');

const isPrivateHostname = (hostname) => {
  const normalized = normalizeHostname(hostname);
  if (normalized === 'localhost' || normalized === '::1') return true;
  if (net.isIPv4(normalized)) return PRIVATE_IPV4.some((pattern) => pattern.test(normalized));
  if (net.isIPv6(normalized)) return normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
  return false;
};

const assertUrlAllowed = (rawUrl, config) => {
  const value = String(rawUrl || '').trim();
  if (!value) return;
  if (/{{|}}|\$\{/.test(value)) {
    if (!config.allowDynamicHosts) {
      const error = new Error('Dynamic request hosts are disabled by Bruno MCP policy');
      error.code = 'BRUNO_MCP_DYNAMIC_HOST_FORBIDDEN';
      throw error;
    }
    return;
  }
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return;
  let url;
  try { url = new URL(value); } catch {
    const error = new Error(`Request URL is invalid: ${value}`);
    error.code = 'BRUNO_MCP_URL_INVALID';
    throw error;
  }
  if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
    const error = new Error(`Protocol ${url.protocol} is not allowed by Bruno MCP`);
    error.code = 'BRUNO_MCP_PROTOCOL_FORBIDDEN';
    throw error;
  }
  const hostname = normalizeHostname(url.hostname);
  if (BLOCKED_METADATA_HOSTS.has(hostname)) {
    const error = new Error(`Metadata host ${hostname} is blocked by Bruno MCP`);
    error.code = 'BRUNO_MCP_METADATA_HOST_FORBIDDEN';
    throw error;
  }
  if (isPrivateHostname(hostname) && !config.allowPrivateHosts) {
    const error = new Error(`Private host ${hostname} is blocked by Bruno MCP policy`);
    error.code = 'BRUNO_MCP_PRIVATE_HOST_FORBIDDEN';
    throw error;
  }
  if (!config.allowedHosts.some((pattern) => hostnameMatches(hostname, pattern))) {
    const error = new Error(`Host ${hostname} is not in the Bruno MCP allowlist`);
    error.code = 'BRUNO_MCP_HOST_FORBIDDEN';
    throw error;
  }
};

const sideEffectSummary = (flow) => {
  const nodes = flow.nodes.filter((node) => REQUEST_KINDS.has(node.kind) || node.kind === 'subflow').map((node) => ({
    node_id: node.id,
    semantic_key: node.semanticKey,
    kind: node.kind,
    side_effect: node.policy?.sideEffect || (node.kind === 'subflow' ? 'once' : 'once'),
    retry_attempts: Number(node.policy?.retry?.maxAttempts || flow.defaults?.retry?.maxAttempts || 1),
    allow_retry: node.policy?.allowRetry === true,
    allow_replay: node.policy?.allowReplay === true
  }));
  return {
    request_nodes: nodes.length,
    once_only_nodes: nodes.filter((node) => node.side_effect === 'once').map((node) => node.node_id),
    idempotent_nodes: nodes.filter((node) => node.side_effect === 'idempotent').map((node) => node.node_id),
    nodes
  };
};

class McpRunRepository {
  constructor({ now = () => new Date(), maxRecords = 500 } = {}) {
    this.now = now;
    this.maxRecords = Math.max(10, Math.min(5000, Number(maxRecords) || 500));
    this.records = new Map();
  }

  create({ runId, workspaceUid, flowUid }) {
    while (this.records.size >= this.maxRecords) {
      const terminal = [...this.records.entries()].find(([, record]) => ['success', 'failed', 'cancelled'].includes(record.status));
      const oldestKey = terminal?.[0] || this.records.keys().next().value;
      if (!oldestKey) break;
      this.records.delete(oldestKey);
    }
    const record = {
      run_id: runId,
      workspace_uid: workspaceUid,
      flow_uid: flowUid,
      status: 'queued',
      created_at: this.now().toISOString(),
      updated_at: this.now().toISOString(),
      events: [],
      result: null,
      error: null
    };
    this.records.set(runId, record);
    return record;
  }

  update(runId, patch) {
    const record = this.records.get(runId);
    if (!record) return null;
    Object.assign(record, patch, { updated_at: this.now().toISOString() });
    return record;
  }

  get(runId) {
    const record = this.records.get(String(runId || ''));
    if (!record) {
      const error = new Error(`Run ${runId} was not found`);
      error.code = 'BRUNO_MCP_RUN_NOT_FOUND';
      throw error;
    }
    return record;
  }

  project(record, { includeEvents = false } = {}) {
    return redactMcpValue({
      run_id: record.run_id,
      workspace_uid: record.workspace_uid,
      flow_uid: record.flow_uid,
      status: record.status,
      created_at: record.created_at,
      updated_at: record.updated_at,
      result: record.result,
      error: record.error,
      ...(includeEvents ? { events: record.events } : {})
    });
  }
}

class BrunoMcpAutomationFacade {
  constructor({
    flowPersistenceService,
    flowRuntimeService,
    requestExecutionService,
    configProvider,
    idFactory = randomUUID,
    now = () => new Date(),
    patchPreviews = new FlowPatchPreviewStore()
  } = {}) {
    if (!flowPersistenceService || !flowRuntimeService || !requestExecutionService) {
      throw new TypeError('BrunoMcpAutomationFacade requires flow persistence, flow runtime, and request execution services');
    }
    this.flowPersistenceService = flowPersistenceService;
    this.flowRuntimeService = flowRuntimeService;
    this.requestExecutionService = requestExecutionService;
    this.configProvider = configProvider;
    this.idFactory = idFactory;
    this.now = now;
    this.patchPreviews = patchPreviews;
    this.catalog = new BrunoWorkspaceCatalog({ configProvider });
    this.requestContextResolver = new BrunoRequestContextResolver();
    this.runs = new McpRunRepository({ now });
  }

  getConfig() {
    return this.configProvider();
  }

  status() {
    const config = this.getConfig();
    return {
      status: 'ok',
      product: 'Bruno Automation Platform',
      mcp_version: 1,
      endpoint: `http://${config.host}:${config.port}/mcp`,
      loopback_only: !config.allowRemote,
      permission_profile: config.permissionProfile,
      allowed_workspace_count: config.allowedWorkspaces.length,
      allowed_host_count: config.allowedHosts.length
    };
  }

  listWorkspaces() {
    return this.catalog.listWorkspaces();
  }

  resolveWorkspace(input) {
    return this.catalog.resolveWorkspace(input);
  }

  async listFlows(input = {}) {
    const workspace = this.resolveWorkspace(input);
    const flows = await this.flowPersistenceService.getStore(workspace.path).listFlows();
    return { workspace_uid: workspace.uid, flows: redactMcpValue(flows) };
  }

  async resolveFlow(input = {}) {
    const flowUid = input.flow_uid;
    const relativePath = input.relative_path;
    const candidates = [];
    const workspaces = input.workspace_uid || input.workspace_path || this.getConfig().allowedWorkspaces.length === 1
      ? [this.resolveWorkspace(input)]
      : this.getConfig().allowedWorkspaces;
    for (const workspace of workspaces) {
      const store = this.flowPersistenceService.getStore(workspace.path);
      const catalog = await store.listFlows();
      const entry = relativePath
        ? catalog.find((candidate) => candidate.relativePath === relativePath)
        : catalog.find((candidate) => candidate.uid === flowUid);
      if (entry?.status === 'valid') candidates.push({ workspace, store, entry });
    }
    if (candidates.length > 1) {
      const error = new Error(`Flow ${flowUid || relativePath || ''} is ambiguous across allowed workspaces; specify workspace_uid`);
      error.code = 'BRUNO_MCP_FLOW_AMBIGUOUS';
      throw error;
    }
    if (candidates.length === 0) {
      const error = new Error(`Flow ${flowUid || relativePath || ''} was not found in the allowed workspaces`);
      error.code = 'BRUNO_MCP_FLOW_NOT_FOUND';
      throw error;
    }
    const [{ workspace, store, entry }] = candidates;
    const record = await store.readFlow(entry.relativePath);
    return { workspace, record };
  }

  async getFlow(input = {}) {
    const { workspace, record } = await this.resolveFlow(input);
    return redactMcpValue({
      workspace_uid: workspace.uid,
      relative_path: record.relativePath,
      revision: record.flow.revision,
      flow: record.flow
    });
  }

  async listRequests(input = {}) {
    const workspace = this.resolveWorkspace(input);
    const requests = await this.catalog.listRequests(workspace, { query: input.query, limit: input.limit });
    return { workspace_uid: workspace.uid, count: requests.length, requests };
  }

  async getRequest(input = {}) {
    const workspace = this.resolveWorkspace(input);
    return this.catalog.getRequest(workspace, input);
  }

  async validateFlow(input = {}) {
    const { workspace, record } = await this.resolveFlow(input);
    const flow = normalizeFlowDefinition(record.flow);
    const issues = validateFlowDefinition(flow);
    const compiled = issues.length === 0 ? compileFlow(flow) : null;
    return redactMcpValue({
      workspace_uid: workspace.uid,
      flow_uid: flow.uid,
      revision: flow.revision,
      valid: issues.length === 0 && !(compiled?.diagnostics || []).some((diagnostic) => diagnostic.severity === 'error'),
      validation_issues: issues,
      compiler_diagnostics: compiled?.diagnostics || []
    });
  }

  async prepareFlowRun(input = {}) {
    const { workspace, record } = await this.resolveFlow(input);
    const validation = await this.validateFlow({ workspace_uid: workspace.uid, flow_uid: record.flow.uid });
    const catalog = await this.catalog.resolveFlowRequestCatalog(workspace, record.flow);
    catalog.forEach((asset) => assertUrlAllowed(asset.item?.request?.url || asset.item?.request?.endpoint, this.getConfig()));
    return redactMcpValue({
      workspace_uid: workspace.uid,
      flow_uid: record.flow.uid,
      revision: record.flow.revision,
      valid: validation.valid,
      input_schema: record.flow.inputSchema || { type: 'object', properties: {} },
      request_count: catalog.length,
      side_effect_summary: sideEffectSummary(record.flow),
      wait_modes: ['start', 'complete'],
      resource_template: 'bruno://run/{runId}'
    });
  }

  async previewResolvedRequest(input = {}) {
    const { workspace, record } = await this.resolveFlow(input);
    const requestCatalog = await this.catalog.resolveFlowRequestCatalog(workspace, record.flow);
    const result = await this.flowRuntimeService.previewRequest({
      flow: record.flow,
      nodeId: input.node_id,
      workspacePath: workspace.path,
      requestCatalog,
      inputs: input.inputs || {},
      environmentValues: {}
    });
    return redactMcpValue({ workspace_uid: workspace.uid, flow_uid: record.flow.uid, ...result });
  }

  async runFlow(input = {}) {
    const { workspace, record } = await this.resolveFlow(input);
    const config = this.getConfig();
    const requestCatalog = await this.catalog.resolveFlowRequestCatalog(workspace, record.flow);
    requestCatalog.forEach((asset) => assertUrlAllowed(asset.item?.request?.url || asset.item?.request?.endpoint, config));
    const runId = String(input.run_id || this.idFactory());
    const waitMode = ['start', 'complete'].includes(input.wait_mode) ? input.wait_mode : 'start';
    const runRecord = this.runs.create({ runId, workspaceUid: workspace.uid, flowUid: record.flow.uid });
    runRecord.status = 'running';
    const execution = this.flowRuntimeService.run({
      runId,
      flow: record.flow,
      workspacePath: workspace.path,
      requestCatalog,
      inputs: input.inputs || {},
      environmentValues: {},
      dataset: input.dataset
    });
    runRecord.promise = execution.then((result) => {
      this.runs.update(runId, {
        status: result.status,
        result,
        events: result.events || [],
        error: result.error || null
      });
      return result;
    }).catch((error) => {
      this.runs.update(runId, {
        status: 'failed',
        error: { code: error.code || 'BRUNO_MCP_FLOW_RUN_FAILED', message: error.message || String(error) }
      });
      throw error;
    });
    if (waitMode === 'complete') {
      await withTimeout(runRecord.promise, config.requestTimeoutMs, `Flow run ${runId}`);
      return this.getRun({ run_id: runId });
    }
    return {
      run_id: runId,
      flow_uid: record.flow.uid,
      status: 'running',
      resource: `bruno://run/${encodeURIComponent(runId)}`,
      events_resource: `bruno://run/${encodeURIComponent(runId)}/events`
    };
  }

  cancelRun(input = {}) {
    const record = this.runs.get(input.run_id);
    const cancellation = this.flowRuntimeService.cancel(record.run_id);
    if (cancellation.cancelled) this.runs.update(record.run_id, { status: 'cancelling' });
    return { run_id: record.run_id, ...cancellation };
  }

  getRun(input = {}) {
    return this.runs.project(this.runs.get(input.run_id));
  }

  getRunEvents(input = {}) {
    const record = this.runs.get(input.run_id);
    const afterSequence = Math.max(0, Number(input.after_sequence) || 0);
    return redactMcpValue({
      run_id: record.run_id,
      status: record.status,
      events: (record.events || []).filter((event) => Number(event.sequence || 0) > afterSequence)
    });
  }

  async resolveRequestContext(workspace, input = {}) {
    let request = null;
    if (!input.collection_path || !input.item_pathname) {
      request = await this.catalog.getRequest(workspace, input);
    }
    const collectionPath = input.collection_path || request.collection_path;
    const itemPathname = input.item_pathname || request.item_pathname;
    const context = await this.requestContextResolver.resolve({
      workspace,
      collectionPath,
      itemPathname,
      input
    });
    return { context, collectionPath, itemPathname };
  }

  async prepareRequest(input = {}) {
    const workspace = this.resolveWorkspace(input);
    const { context, collectionPath, itemPathname } = await this.resolveRequestContext(workspace, input);
    const method = String(context.preparedRequest.method || context.item?.request?.method || '').toUpperCase();
    const resolvedUrl = context.preparedRequest.url || context.item?.request?.url || context.item?.request?.endpoint || '';
    assertUrlAllowed(resolvedUrl, this.getConfig());
    return redactMcpValue({
      uid: context.item.uid,
      name: context.item.name,
      type: context.item.type,
      method,
      source_url: context.item?.request?.url || context.item?.request?.endpoint || '',
      resolved_url: resolvedUrl,
      workspace_uid: workspace.uid,
      collection_path: collectionPath,
      item_pathname: itemPathname,
      side_effect: ['GET', 'HEAD', 'OPTIONS'].includes(method) ? 'read-only' : 'once',
      ready: context.unresolvedVariables.length === 0,
      unresolved_variables: context.unresolvedVariables,
      selected_environment: environmentProjection(context.environment),
      available_environments: context.availableEnvironments,
      active_global_environment: context.activeGlobalEnvironment,
      runtime_variable_names: Object.keys(context.runtimeVariables),
      prompt_variable_names: Object.keys(context.promptVariables)
    });
  }

  async runRequest(input = {}) {
    const workspace = this.resolveWorkspace(input);
    const { context, collectionPath, itemPathname } = await this.resolveRequestContext(workspace, input);
    const method = String(context.preparedRequest.method || context.item?.request?.method || '').toUpperCase();
    const resolvedUrl = context.preparedRequest.url || context.item?.request?.url || context.item?.request?.endpoint || '';
    assertUrlAllowed(resolvedUrl, this.getConfig());

    const hasSideEffects = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    if (hasSideEffects && input.allow_side_effects !== true) {
      const error = new Error(`Request method ${method || 'UNKNOWN'} may have side effects; retry with allow_side_effects=true after approval`);
      error.code = 'BRUNO_MCP_SIDE_EFFECT_APPROVAL_REQUIRED';
      error.statusCode = 403;
      throw error;
    }

    const correlationId = input.correlation_id || this.idFactory();
    const requestGuard = ({ url, method: guardedMethod }) => {
      assertUrlAllowed(url, this.getConfig());
      const normalizedMethod = String(guardedMethod || '').toUpperCase();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(normalizedMethod) && input.allow_side_effects !== true) {
        const error = new Error(`Request method ${normalizedMethod || 'UNKNOWN'} may have side effects; retry with allow_side_effects=true after approval`);
        error.code = 'BRUNO_MCP_SIDE_EFFECT_APPROVAL_REQUIRED';
        error.statusCode = 403;
        throw error;
      }
    };
    const execution = await withTimeout(this.requestExecutionService.executeWithLegacy({
      workspaceContext: { uid: workspace.uid, pathname: workspace.path },
      collection: context.collection,
      item: context.item,
      environmentContext: context.environment,
      runtimeVariables: context.runtimeVariables,
      executionContext: {
        source: 'mcp',
        correlationId,
        runInBackground: true,
        parentExecutionMode: 'mcp-request',
        requestGuard
      }
    }), this.getConfig().requestTimeoutMs, `Request ${context.item.name || context.item.uid}`);
    return redactMcpValue({
      ...(execution.result || execution),
      request_context: {
        correlation_id: correlationId,
        workspace_uid: workspace.uid,
        collection_path: collectionPath,
        item_pathname: itemPathname,
        method,
        resolved_url: resolvedUrl,
        selected_environment: environmentProjection(context.environment),
        runtime_variable_names: Object.keys(context.runtimeVariables)
      }
    });
  }

  async previewFlowPatch(input = {}) {
    const { workspace, record } = await this.resolveFlow(input);
    if (!input.expected_revision) throw new TypeError('expected_revision is required');
    if (input.expected_revision !== record.flow.revision) {
      const error = new Error(`Flow revision conflict: expected ${input.expected_revision}, actual ${record.flow.revision}`);
      error.code = 'FLOW_REVISION_CONFLICT';
      throw error;
    }
    const patched = applyFlowPatchOperations(record.flow, input.operations);
    const analyzed = analyzePatchedFlow(patched);
    const errors = [
      ...analyzed.validationIssues,
      ...analyzed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    ];
    const preview = errors.length === 0 ? this.patchPreviews.create({
      workspaceUid: workspace.uid,
      flowUid: record.flow.uid,
      relativePath: record.relativePath,
      expectedRevision: input.expected_revision,
      operations: input.operations,
      proposedRevision: analyzed.revision
    }) : null;
    return redactMcpValue({
      workspace_uid: workspace.uid,
      flow_uid: record.flow.uid,
      relative_path: record.relativePath,
      expected_revision: input.expected_revision,
      proposed_revision: analyzed.revision,
      valid: errors.length === 0,
      preview_id: preview?.previewId || null,
      expires_at: preview ? new Date(preview.expiresAt).toISOString() : null,
      validation_issues: analyzed.validationIssues,
      compiler_diagnostics: analyzed.diagnostics,
      side_effect_summary: sideEffectSummary(analyzed.flow),
      operation_count: input.operations.length
    });
  }

  async applyFlowPatch(input = {}) {
    if (input.approved !== true) {
      const error = new Error('Flow patch apply requires approved=true after reviewing a preview');
      error.code = 'BRUNO_MCP_APPROVAL_REQUIRED';
      throw error;
    }
    const { workspace, record } = await this.resolveFlow(input);
    if (!input.expected_revision) throw new TypeError('expected_revision is required');
    this.patchPreviews.consume({
      previewId: input.preview_id,
      workspaceUid: workspace.uid,
      flowUid: record.flow.uid,
      relativePath: record.relativePath,
      expectedRevision: input.expected_revision,
      operations: input.operations
    });
    const patched = analyzePatchedFlow(applyFlowPatchOperations(record.flow, input.operations));
    const errors = [
      ...patched.validationIssues,
      ...patched.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')
    ];
    if (errors.length > 0) throw new Error('Flow patch is no longer valid');
    const saved = await this.flowPersistenceService.saveFlow({
      workspacePath: workspace.path,
      relativePath: record.relativePath,
      flow: patched.flow,
      expectedRevision: input.expected_revision
    });
    return redactMcpValue({
      workspace_uid: workspace.uid,
      flow_uid: saved.flow.uid,
      relative_path: saved.relativePath,
      previous_revision: input.expected_revision,
      revision: saved.flow.revision,
      applied: true
    });
  }
}

module.exports = {
  BrunoMcpAutomationFacade,
  McpRunRepository,
  assertUrlAllowed,
  hostnameMatches,
  normalizeHostname,
  isPrivateHostname,
  sideEffectSummary,
  withTimeout
};
