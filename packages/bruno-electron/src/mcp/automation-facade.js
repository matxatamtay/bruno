const { randomUUID } = require('node:crypto');
const { BrunoCollectionService } = require('./collection-service');
const { BrunoRequestContextResolver, environmentProjection } = require('./request-context-resolver');

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

class McpRequestRunRepository {
  constructor({ now = () => new Date(), maxRecords = 1000 } = {}) {
    this.now = now;
    this.maxRecords = maxRecords;
    this.records = new Map();
  }

  create({ runId, request }) {
    while (this.records.size >= this.maxRecords) this.records.delete(this.records.keys().next().value);
    const record = {
      run_id: runId,
      status: 'running',
      created_at: this.now().toISOString(),
      updated_at: this.now().toISOString(),
      request,
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
      const error = new Error(`Request run ${runId} was not found`);
      error.code = 'BRUNO_MCP_REQUEST_RUN_NOT_FOUND';
      throw error;
    }
    return record;
  }

  list({ limit = 100 } = {}) {
    return [...this.records.values()].slice(-Math.max(1, Math.min(1000, Number(limit) || 100))).reverse();
  }

  project(record) {
    return {
      run_id: record.run_id,
      status: record.status,
      created_at: record.created_at,
      updated_at: record.updated_at,
      request: record.request,
      result: record.result,
      legacy_result: record.legacy_result || null,
      error: record.error
    };
  }
}

class BrunoMcpAutomationFacade {
  constructor({ requestExecutionService, configProvider, onWorkspaceResolved, workspaceManager, idFactory = randomUUID, now = () => new Date() } = {}) {
    if (!requestExecutionService) throw new TypeError('BrunoMcpAutomationFacade requires requestExecutionService');
    this.requestExecutionService = requestExecutionService;
    this.configProvider = configProvider;
    this.workspaceManager = workspaceManager;
    this.idFactory = idFactory;
    this.now = now;
    this.collections = new BrunoCollectionService({ configProvider, onWorkspaceResolved });
    this.requestContextResolver = new BrunoRequestContextResolver();
    this.requestRuns = new McpRequestRunRepository({ now });
  }

  getConfig() {
    return this.configProvider?.() || {};
  }

  status() {
    const config = this.getConfig();
    return {
      status: 'ok',
      product: 'Bruno Desktop MCP',
      mcp_version: 2,
      endpoint: `http://${config.host || '127.0.0.1'}:${config.port || 3847}/mcp`,
      workspace_count: (config.workspaces || []).length,
      capabilities: {
        collections: 'full-crud',
        folders: 'full-crud',
        requests: 'full-crud',
        request_tabs: 'full-edit',
        environments: 'full-crud',
        dotenv: 'full-crud',
        request_execution: true,
        flow_studio: false,
        intelligence_suite: false
      }
    };
  }

  listWorkspaces(input) { return { workspaces: this.collections.listWorkspaces(input) }; }
  listDiscoveryWorkspaces(input) { return this.workspaceManager.listDiscoveryWorkspaces(input); }
  addWorkspace(input) { return this.workspaceManager.addWorkspace(input); }
  createWorkspace(input) { return this.workspaceManager.createWorkspace(input); }
  listCollections(input) { return this.collections.listCollections(input); }
  getCollection(input) { return this.collections.getCollection(input); }
  createCollection(input) { return this.collections.createCollection(input); }
  updateCollection(input) { return this.collections.updateCollection(input); }
  updateCollectionTab(input) { return this.collections.updateCollectionTab(input); }
  cloneCollection(input) { return this.collections.cloneCollection(input); }
  moveCollection(input) { return this.collections.moveCollection(input); }
  deleteCollection(input) { return this.collections.deleteCollection(input); }
  resequenceItems(input) { return this.collections.resequenceItems(input); }
  listCollectionItems(input) { return this.collections.listItems(input); }
  getFolder(input) { return this.collections.getFolder(input); }
  createFolder(input) { return this.collections.createFolder(input); }
  updateFolder(input) { return this.collections.updateFolder(input); }
  updateFolderTab(input) { return this.collections.updateFolderTab(input); }
  deleteFolder(input) { return this.collections.deleteFolder(input); }
  moveItem(input) { return this.collections.moveItem(input); }
  listEnvironments(input) { return this.collections.listEnvironments(input); }
  getEnvironment(input) { return this.collections.getEnvironment(input); }
  createEnvironment(input) { return this.collections.createEnvironment(input); }
  updateEnvironment(input) { return this.collections.updateEnvironment(input); }
  deleteEnvironment(input) { return this.collections.deleteEnvironment(input); }
  getDotEnv(input) { return this.collections.getDotEnv(input); }
  setDotEnv(input) { return this.collections.setDotEnv(input); }
  deleteDotEnv(input) { return this.collections.deleteDotEnv(input); }
  listRequests(input) { return this.collections.listRequests(input); }
  searchRequests(input) { return this.collections.listRequests(input); }
  getRequest(input) { return this.collections.getRequest(input); }
  createRequest(input) { return this.collections.createRequest(input); }
  updateRequest(input) { return this.collections.updateRequest(input); }
  updateRequestTab(input) { return this.collections.updateRequestTab(input); }
  deleteRequest(input) { return this.collections.deleteRequest(input); }
  duplicateRequest(input) { return this.collections.duplicateRequest(input); }

  async resolveRequestContext(input = {}) {
    const workspace = await this.collections.resolveWorkspace(input);
    const request = await this.collections.getRequest({ ...input, workspace_path: workspace.path });
    const context = await this.requestContextResolver.resolve({
      workspace,
      collectionPath: request.collection_pathname,
      itemPathname: request.item_pathname,
      input
    });
    return { workspace, request, context };
  }

  async prepareRequest(input = {}) {
    const { workspace, request, context } = await this.resolveRequestContext(input);
    return {
      workspace_uid: workspace.uid,
      workspace_path: workspace.path,
      collection_path: request.collection_path,
      item_pathname: request.item_pathname,
      uid: context.item.uid,
      name: context.item.name,
      type: context.item.type,
      definition: context.item,
      prepared_request: context.preparedRequest,
      ready: context.unresolvedVariables.length === 0,
      unresolved_variables: context.unresolvedVariables,
      selected_environment: context.environment || null,
      selected_environment_summary: environmentProjection(context.environment),
      available_environments: context.availableEnvironments,
      active_global_environment: context.activeGlobalEnvironment,
      runtime_variables: context.runtimeVariables,
      prompt_variables: context.promptVariables
    };
  }

  async executeRequest(input = {}, runId) {
    const { workspace, request, context } = await this.resolveRequestContext(input);
    const prepared = {
      workspace_uid: workspace.uid,
      workspace_path: workspace.path,
      collection_path: request.collection_path,
      item_pathname: request.item_pathname,
      uid: context.item.uid,
      name: context.item.name,
      type: context.item.type,
      selected_environment: context.environment || null,
      runtime_variables: context.runtimeVariables,
      prompt_variables: context.promptVariables,
      prepared_request: context.preparedRequest
    };
    const correlationId = input.correlation_id || runId;
    const execution = await withTimeout(this.requestExecutionService.executeWithLegacy({
      workspaceContext: { uid: workspace.uid, pathname: workspace.path },
      collection: context.collection,
      item: context.item,
      environmentContext: context.environment,
      runtimeVariables: context.runtimeVariables,
      executionContext: {
        source: 'mcp',
        correlationId,
        executionId: runId,
        runInBackground: true,
        parentExecutionMode: 'mcp-request',
        requestGuard: () => true
      }
    }), this.getConfig().requestTimeoutMs || 120000, `Request ${context.item.name || context.item.uid}`);
    return {
      run_id: runId,
      request: prepared,
      result: execution.result || execution,
      legacy_result: execution.legacyResult || null
    };
  }

  async runRequest(input = {}) {
    const runId = String(input.run_id || this.idFactory());
    const waitMode = input.wait_mode === 'start' ? 'start' : 'complete';
    const record = this.requestRuns.create({
      runId,
      request: {
        workspace_uid: input.workspace_uid,
        workspace_path: input.workspace_path,
        collection_path: input.collection_path,
        item_pathname: input.item_pathname,
        request_uid: input.request_uid
      }
    });
    record.promise = this.executeRequest(input, runId).then((execution) => {
      this.requestRuns.update(runId, { status: execution.result?.status || 'success', request: execution.request, result: execution.result, legacy_result: execution.legacy_result });
      return execution;
    }).catch((error) => {
      this.requestRuns.update(runId, { status: 'failed', error: { code: error.code || 'BRUNO_MCP_REQUEST_RUN_FAILED', message: error.message || String(error) } });
      throw error;
    });
    if (waitMode === 'start') {
      return { run_id: runId, status: 'running', resource: `bruno://request-run/${encodeURIComponent(runId)}` };
    }
    await record.promise;
    return this.getRequestRun({ run_id: runId });
  }

  getRequestRun(input = {}) {
    return this.requestRuns.project(this.requestRuns.get(input.run_id));
  }

  listRequestRuns(input = {}) {
    return { runs: this.requestRuns.list(input).map((record) => this.requestRuns.project(record)) };
  }
}

const assertUrlAllowed = () => true;
const hostnameMatches = () => true;
const normalizeHostname = (value) => String(value || '').trim().toLowerCase();
const isPrivateHostname = () => false;

module.exports = {
  BrunoMcpAutomationFacade,
  McpRequestRunRepository,
  assertUrlAllowed,
  hostnameMatches,
  normalizeHostname,
  isPrivateHostname,
  withTimeout
};
