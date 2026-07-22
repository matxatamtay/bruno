const http = require('node:http');
const { timingSafeEqual, createHash } = require('node:crypto');
const { McpServer, ResourceTemplate } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { normalizeMcpConfig } = require('./config');
const { McpTokenStore } = require('./token-store');
const { redactMcpValue, safeMcpError } = require('./redaction');
const { BrunoMcpAutomationFacade } = require('./automation-facade');
const { createMcpClientConfigurations } = require('./client-config');
const { buildWorkspaceDirectory, createWorkspaceActivator, createWorkspaceManager } = require('./workspace-directory');

const MAX_BODY_BYTES = 4 * 1024 * 1024;
const jsonText = (value) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });

const parseJsonBody = async (request) => {
  let total = 0;
  const chunks = [];
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      const error = new Error(`Bruno MCP request exceeds ${MAX_BODY_BYTES} bytes`);
      error.code = 'BRUNO_MCP_REQUEST_TOO_LARGE';
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return undefined;
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
};

const tokenMatches = (candidate, expected) => {
  const left = Buffer.from(String(candidate || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};

const bearerToken = (request) => {
  const match = String(request.headers.authorization || '').match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
};

const requestClientKey = (request, token) => {
  const fingerprint = createHash('sha256').update(String(token || '')).digest('hex').slice(0, 16);
  return `${request.socket.remoteAddress || 'unknown'}:${fingerprint}`;
};

const commonWorkspaceSchema = {
  workspace_uid: z.string().min(1).optional(),
  workspace_path: z.string().min(1).optional()
};
const nameFilterSchema = {
  name_ilike: z.string().min(1).optional(),
  name_regex: z.string().min(1).optional()
};
const collectionSchema = { ...commonWorkspaceSchema, collection_path: z.string().min(1) };
const requestReferenceSchema = {
  ...commonWorkspaceSchema,
  request_uid: z.string().min(1).optional(),
  collection_path: z.string().min(1).optional(),
  item_pathname: z.string().min(1).optional()
};
const mutationSchema = {
  definition: z.record(z.string(), z.unknown()).optional(),
  changes: z.record(z.string(), z.unknown()).optional(),
  set: z.record(z.string(), z.unknown()).optional(),
  unset: z.array(z.string().min(1)).optional()
};
const executionSchema = {
  ...requestReferenceSchema,
  environment_uid: z.string().min(1).optional(),
  environment_name: z.string().min(1).optional(),
  runtime_variables: z.record(z.string(), z.unknown()).optional(),
  prompt_variables: z.record(z.string(), z.unknown()).optional()
};

const registerBrunoMcpTools = (mcp, { facade, onCall }) => {
  const register = (name, description, inputSchema, handler, annotations = {}) => {
    mcp.registerTool(name, {
      description,
      inputSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        ...annotations
      }
    }, async (args = {}) => {
      const startedAt = Date.now();
      try {
        const result = await handler(args);
        onCall?.({ tool: name, args, result, error: null, durationMs: Date.now() - startedAt });
        return jsonText(result);
      } catch (error) {
        onCall?.({ tool: name, args, result: null, error, durationMs: Date.now() - startedAt });
        return { isError: true, ...jsonText({ error: safeMcpError(error) }) };
      }
    });
  };

  register('bruno_status', 'Return Bruno Desktop MCP capabilities.', {}, () => facade.status(), { readOnlyHint: true, idempotentHint: true });
  register('bruno_list_workspaces', 'List every workspace Bruno currently manages (the same set shown in Manage Workspaces), marking which one is current. Filter by name with name_ilike (case-insensitive substring) and/or name_regex. An explicit workspace_path can also be passed directly to every tool, including a path outside this list — the app will open it and switch to it automatically.', nameFilterSchema, (args) => facade.listWorkspaces(args), { readOnlyHint: true, idempotentHint: true });
  register('bruno_list_discovery_workspaces', 'List the workspace paths manually configured in Preferences → MCP for discovery. These are not necessarily open/managed in the app yet; use bruno_add_workspace to bring one into Manage Workspaces. Supports the same name_ilike/name_regex filters as bruno_list_workspaces.', nameFilterSchema, (args) => facade.listDiscoveryWorkspaces(args), { readOnlyHint: true, idempotentHint: true });
  register('bruno_add_workspace', 'Register an existing workspace folder (one containing a workspace.yml) into Manage Workspaces, without changing which workspace is currently active.', { workspace_path: z.string().min(1) }, (args) => facade.addWorkspace(args));
  register('bruno_create_workspace', 'Scaffold a brand-new Bruno workspace in an empty (or new) folder and register it into Manage Workspaces.', {
    location: z.string().min(1),
    name: z.string().min(1),
    folder_name: z.string().optional()
  }, (args) => facade.createWorkspace(args));

  register('bruno_list_collections', 'Find Bruno collections under a workspace.', { ...commonWorkspaceSchema, query: z.string().optional() }, (args) => facade.listCollections(args), { readOnlyHint: true, idempotentHint: true });
  register('bruno_get_collection', 'Get a complete collection definition including overview/config, inherited request settings, every collection settings tab, items, and environments.', collectionSchema, (args) => facade.getCollection(args), { readOnlyHint: true, idempotentHint: true });
  register('bruno_create_collection', 'Create a .bru or OpenCollection YAML collection.', {
    ...commonWorkspaceSchema,
    location: z.string().optional(),
    name: z.string().min(1),
    folder_name: z.string().optional(),
    format: z.enum(['bru', 'yml']).optional(),
    bruno_config: z.record(z.string(), z.unknown()).optional(),
    root: z.record(z.string(), z.unknown()).optional()
  }, (args) => facade.createCollection(args));
  register('bruno_update_collection', 'Replace, merge, set, or remove any collection root/config field. Supports every Collection Settings tab.', {
    ...collectionSchema,
    name: z.string().optional(),
    ...mutationSchema
  }, (args) => facade.updateCollection(args));
  register('bruno_update_collection_tab', 'Edit one current Collection Settings tab: overview, headers, vars, auth, script, tests, docs, presets, proxy, client-certificates, or protobuf.', {
    ...collectionSchema,
    tab: z.string().min(1),
    value: z.unknown()
  }, (args) => facade.updateCollectionTab(args));
  register('bruno_clone_collection', 'Clone a complete collection, including folders, requests, environments, dotenv files, and collection configuration.', {
    ...collectionSchema,
    target_location: z.string().optional(),
    folder_name: z.string().optional(),
    name: z.string().optional()
  }, (args) => facade.cloneCollection(args));
  register('bruno_move_collection', 'Move or rename a complete collection directory and optionally change its display name.', {
    ...collectionSchema,
    target_location: z.string().optional(),
    folder_name: z.string().optional(),
    name: z.string().optional()
  }, (args) => facade.moveCollection(args));
  register('bruno_delete_collection', 'Delete a collection directory and all of its contents.', collectionSchema, (args) => facade.deleteCollection(args), { destructiveHint: true });
  register('bruno_resequence_items', 'Set collection sidebar ordering by updating seq on requests and folders.', {
    ...collectionSchema,
    items: z.array(z.object({ path: z.string().min(1), seq: z.number() }))
  }, (args) => facade.resequenceItems(args));
  register('bruno_list_collection_items', 'Get the complete nested folder/request tree for a collection.', collectionSchema, (args) => facade.listCollectionItems(args), { readOnlyHint: true, idempotentHint: true });

  register('bruno_get_folder', 'Get a complete folder definition including headers, vars, auth, scripts, tests, docs, name, and sequence.', { ...collectionSchema, folder_path: z.string() }, (args) => facade.getFolder(args), { readOnlyHint: true, idempotentHint: true });
  register('bruno_create_folder', 'Create a collection folder with an optional complete folder definition.', {
    ...collectionSchema,
    parent_path: z.string().optional(),
    folder_name: z.string().min(1),
    name: z.string().optional(),
    seq: z.number().optional(),
    definition: z.record(z.string(), z.unknown()).optional()
  }, (args) => facade.createFolder(args));
  register('bruno_update_folder', 'Replace, merge, set, or remove any folder field.', { ...collectionSchema, folder_path: z.string(), ...mutationSchema }, (args) => facade.updateFolder(args));
  register('bruno_update_folder_tab', 'Edit one Folder Settings tab: headers, vars, auth, script, tests, docs, or settings.', { ...collectionSchema, folder_path: z.string(), tab: z.string().min(1), value: z.unknown() }, (args) => facade.updateFolderTab(args));
  register('bruno_delete_folder', 'Delete a folder and all nested requests.', { ...collectionSchema, folder_path: z.string().min(1) }, (args) => facade.deleteFolder(args), { destructiveHint: true });
  register('bruno_move_item', 'Move or rename a request or folder inside a collection.', { ...collectionSchema, source_path: z.string().min(1), target_folder: z.string().optional(), new_filename: z.string().optional() }, (args) => facade.moveItem(args));

  register('bruno_list_requests', 'List requests across a workspace or one collection.', { ...commonWorkspaceSchema, collection_path: z.string().optional(), limit: z.number().int().min(1).max(10000).optional() }, (args) => facade.listRequests(args), { readOnlyHint: true, idempotentHint: true });
  register('bruno_search_requests', 'Search requests by name, type, method, URL, collection, or pathname.', { ...commonWorkspaceSchema, collection_path: z.string().optional(), query: z.string().min(1), limit: z.number().int().min(1).max(10000).optional() }, (args) => facade.searchRequests(args), { readOnlyHint: true, idempotentHint: true });
  register('bruno_get_request', 'Get the complete editable request definition, including name and every persisted request tab and field. Values are not reduced to a read-only projection.', requestReferenceSchema, (args) => facade.getRequest(args), { readOnlyHint: true, idempotentHint: true });
  register('bruno_create_request', 'Create HTTP, GraphQL, gRPC, WebSocket, or SSE request. Pass definition to set every field in one call.', {
    ...collectionSchema,
    folder_path: z.string().optional(),
    name: z.string().min(1),
    filename: z.string().optional(),
    type: z.string().optional(),
    method: z.string().optional(),
    url: z.string().optional(),
    seq: z.number().optional(),
    definition: z.record(z.string(), z.unknown()).optional()
  }, (args) => facade.createRequest(args));
  register('bruno_update_request', 'Replace, deep-merge, set, or unset any request field, and optionally rename/move its file. This is the universal editor for all present and future request fields.', {
    ...requestReferenceSchema,
    name: z.string().optional(),
    new_item_pathname: z.string().optional(),
    ...mutationSchema
  }, (args) => facade.updateRequest(args));
  register('bruno_update_request_tab', 'Edit one request tab directly. Supports params, body, headers/metadata, auth, vars, script, assert, tests, docs, GraphQL query, gRPC/WebSocket message, examples, app, and settings.', {
    ...requestReferenceSchema,
    tab: z.string().min(1),
    value: z.unknown()
  }, (args) => facade.updateRequestTab(args));
  register('bruno_duplicate_request', 'Duplicate a request with all tabs and examples preserved.', { ...requestReferenceSchema, name: z.string().optional(), filename: z.string().optional(), folder_path: z.string().optional() }, (args) => facade.duplicateRequest(args));
  register('bruno_delete_request', 'Delete a request file.', requestReferenceSchema, (args) => facade.deleteRequest(args), { destructiveHint: true });

  register('bruno_list_environments', 'List complete collection environments and their variable definitions.', collectionSchema, (args) => facade.listEnvironments(args), { readOnlyHint: true, idempotentHint: true });
  register('bruno_get_environment', 'Get one complete environment definition.', {
    ...collectionSchema,
    environment_uid: z.string().optional(),
    environment_name: z.string().optional(),
    environment_filename: z.string().optional()
  }, (args) => facade.getEnvironment(args), { readOnlyHint: true, idempotentHint: true });
  register('bruno_create_environment', 'Create a collection environment with variables, types, descriptions, annotations, colors, and secret flags.', {
    ...collectionSchema,
    name: z.string().min(1),
    filename: z.string().optional(),
    definition: z.record(z.string(), z.unknown()).optional()
  }, (args) => facade.createEnvironment(args));
  register('bruno_update_environment', 'Replace, merge, set, or unset any environment field or variable.', {
    ...collectionSchema,
    environment_uid: z.string().optional(),
    environment_name: z.string().optional(),
    environment_filename: z.string().optional(),
    name: z.string().optional(),
    new_filename: z.string().optional(),
    ...mutationSchema
  }, (args) => facade.updateEnvironment(args));
  register('bruno_delete_environment', 'Delete a collection environment.', {
    ...collectionSchema,
    environment_uid: z.string().optional(),
    environment_name: z.string().optional(),
    environment_filename: z.string().optional()
  }, (args) => facade.deleteEnvironment(args), { destructiveHint: true });

  register('bruno_get_dotenv', 'Read a collection .env file as raw content and variables.', { ...collectionSchema, filename: z.string().optional() }, (args) => facade.getDotEnv(args), { readOnlyHint: true, idempotentHint: true });
  register('bruno_set_dotenv', 'Create or replace a collection .env file from raw content or a variables object.', { ...collectionSchema, filename: z.string().optional(), content: z.string().optional(), variables: z.record(z.string(), z.unknown()).optional() }, (args) => facade.setDotEnv(args));
  register('bruno_delete_dotenv', 'Delete a collection .env file.', { ...collectionSchema, filename: z.string().optional() }, (args) => facade.deleteDotEnv(args), { destructiveHint: true });

  register('bruno_prepare_request', 'Resolve a request through normal Bruno collection, folder, environment, dotenv, runtime, and prompt-variable precedence without sending it.', executionSchema, (args) => facade.prepareRequest(args), { readOnlyHint: true, idempotentHint: true });
  register('bruno_run_request', 'Run any Bruno request through the normal desktop execution engine. POST/PUT/PATCH/DELETE do not require a separate MCP policy approval. Returns the complete stored run result.', {
    ...executionSchema,
    run_id: z.string().optional(),
    correlation_id: z.string().optional(),
    wait_mode: z.enum(['start', 'complete']).optional()
  }, (args) => facade.runRequest(args));
  register('bruno_get_request_run', 'Get a previously started request run and its complete result.', { run_id: z.string().min(1) }, (args) => facade.getRequestRun(args), { readOnlyHint: true, idempotentHint: true });
  register('bruno_list_request_runs', 'List request runs retained by the current Bruno desktop process.', { limit: z.number().int().min(1).max(1000).optional() }, (args) => facade.listRequestRuns(args), { readOnlyHint: true, idempotentHint: true });
};

const registerBrunoMcpResources = (mcp, facade) => {
  mcp.registerResource(
    'bruno-request-run',
    new ResourceTemplate('bruno://request-run/{runId}', { list: undefined }),
    { description: 'Complete Bruno request run result', mimeType: 'application/json' },
    async (uri, variables) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(facade.getRequestRun({ run_id: variables.runId })) }] })
  );
};

class BrunoMcpServerManager {
  constructor({ appDataPath, getPreferences, savePreferences, requestExecutionService, mainWindow = null, workspaceWatcher = null, tokenStore, stdioLaunch, now = () => new Date() } = {}) {
    this.appDataPath = appDataPath;
    this.getPreferences = getPreferences;
    this.savePreferences = savePreferences;
    this.mainWindow = mainWindow;
    this.workspaceWatcher = workspaceWatcher;
    this.now = now;
    this.server = null;
    this.startedAt = null;
    this.config = normalizeMcpConfig(getPreferences());
    this.tokenStore = tokenStore || new McpTokenStore({ directory: `${appDataPath}/bruno-mcp` });
    this.stdioLaunch = stdioLaunch || { command: process.execPath, args: ['--mcp-stdio'] };
    const getMainWindow = () => this.mainWindow;
    const configProvider = () => ({ ...this.config, workspaces: buildWorkspaceDirectory() });
    this.facade = new BrunoMcpAutomationFacade({
      requestExecutionService,
      configProvider,
      now,
      onWorkspaceResolved: createWorkspaceActivator({ getMainWindow, workspaceWatcher: this.workspaceWatcher }),
      workspaceManager: createWorkspaceManager({ getMainWindow, workspaceWatcher: this.workspaceWatcher, configProvider })
    });
    this.clients = new Map();
    this.activeToken = null;
    this.lastError = null;
    this.operationQueue = Promise.resolve();
    this.restarting = false;
    this.connectionEvents = [];
    this.maxConnectionEvents = 200;
    this.eventSeq = 0;
  }

  // Records one MCP tool call for the "Connections" viewer: which tool, from where, how long
  // it took, and its (redacted) request/response. Kept as a bounded in-memory ring buffer and
  // pushed to the renderer in real time.
  _recordCall({ tool, args, result, error, durationMs, remoteAddress, remotePort }) {
    const entry = {
      id: `mcpcall_${++this.eventSeq}`,
      timestamp: this.now().toISOString(),
      tool,
      source: `${remoteAddress || 'unknown'}:${remotePort ?? '?'}`,
      durationMs,
      status: error ? 'error' : 'success',
      request: redactMcpValue(args ?? {}, {}),
      response: error ? null : redactMcpValue(result ?? null, {}),
      error: error ? safeMcpError(error) : null
    };
    this.connectionEvents.push(entry);
    if (this.connectionEvents.length > this.maxConnectionEvents) this.connectionEvents.shift();
    if (this.mainWindow && !this.mainWindow.isDestroyed?.()) {
      this.mainWindow.webContents.send('main:mcp-connection-event', entry);
    }
    return entry;
  }

  getConnectionEvents() {
    return this.connectionEvents;
  }

  // Serializes start/stop/restart so overlapping preference saves (or a restart racing the
  // initial launch) can't leave two listeners fighting for the same port or double-close a server.
  _enqueue(operation) {
    const run = this.operationQueue.then(operation, operation);
    this.operationQueue = run.then(() => undefined, () => undefined);
    return run;
  }

  // Node's server.listen() callback only fires on success; without an explicit timeout a bind
  // that neither succeeds nor errors (observed on macOS when the OS silently withholds the
  // local-network permission a signed app needs) leaves start() hanging forever.
  _listen(server) {
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        server.off('error', onError);
        server.off('listening', onListening);
      };
      const onError = (error) => {
        cleanup(); reject(error);
      };
      const onListening = () => {
        cleanup(); resolve();
      };
      const timer = setTimeout(() => {
        cleanup();
        server.close();
        reject(new Error(`Bruno MCP timed out binding to ${this.config.host}:${this.config.port}. Another process may be using this port, or macOS may be withholding local network permission for Bruno.`));
      }, 5000);
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(this.config.port, this.config.host);
    });
  }

  setMainWindow(mainWindow) { this.mainWindow = mainWindow; }
  emitStatus() {
    if (!this.mainWindow || this.mainWindow.isDestroyed?.()) return;
    this.mainWindow.webContents.send('main:mcp-status', this.getStatus());
  }

  start() { return this._enqueue(() => this._doStart()); }
  stop() { return this._enqueue(() => this._doStop()); }
  restart() { return this._enqueue(() => this._doRestart()); }

  async _doStart() {
    if (this.server) return this.getStatus();
    this.config = normalizeMcpConfig(this.getPreferences());
    if (!this.config.enabled) return this.getStatus();
    try {
      this.activeToken = (await this.tokenStore.ensure()).token;
      const server = await this._createAndBindServer();
      this.server = server;
      this.startedAt = this.now().toISOString();
      this.lastError = null;
    } catch (error) {
      this.lastError = error;
      console.error('Bruno MCP failed to start:', error?.message || error);
      this.emitStatus();
      throw error;
    }
    this.emitStatus();
    return this.getStatus();
  }

  async _createAndBindServer() {
    const server = http.createServer(async (request, response) => {
      try {
        const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
        if (requestUrl.pathname === '/healthz') {
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          response.end(JSON.stringify({ status: 'ok', product: 'Bruno Desktop MCP' }));
          return;
        }
        if (requestUrl.pathname !== '/mcp') {
          response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: { code: 'BRUNO_MCP_NOT_FOUND', message: 'Bruno MCP endpoint is /mcp' } }));
          return;
        }
        if (request.method !== 'POST') {
          response.writeHead(405, { 'allow': 'POST', 'content-type': 'application/json; charset=utf-8' });
          response.end(JSON.stringify({ error: { code: 'BRUNO_MCP_METHOD_NOT_ALLOWED', message: 'Use HTTP POST for Bruno MCP' } }));
          return;
        }
        const token = bearerToken(request);
        if (!tokenMatches(token, this.activeToken)) {
          const error = new Error('Bruno MCP authentication failed');
          error.code = 'BRUNO_MCP_UNAUTHORIZED';
          error.statusCode = 401;
          throw error;
        }
        const clientKey = requestClientKey(request, token);
        this.clients.set(clientKey, { remoteAddress: request.socket.remoteAddress, lastSeenAt: this.now().toISOString() });
        const body = await parseJsonBody(request);
        const mcp = new McpServer({ name: 'Bruno Desktop', version: '2.0.0' });
        registerBrunoMcpTools(mcp, {
          facade: this.facade,
          onCall: (call) => this._recordCall({
            ...call,
            remoteAddress: request.socket.remoteAddress,
            remotePort: request.socket.remotePort
          })
        });
        registerBrunoMcpResources(mcp, this.facade);
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        response.on('close', () => {
          transport.close().catch(() => null);
          mcp.close().catch(() => null);
        });
        await mcp.connect(transport);
        await transport.handleRequest(request, response, body);
      } catch (error) {
        if (response.headersSent) return;
        const statusCode = error?.statusCode || 500;
        if (statusCode === 401) response.setHeader('www-authenticate', 'Bearer realm="Bruno MCP"');
        response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ error: safeMcpError(error) }));
      }
    });
    await this._listen(server);
    return server;
  }

  async _doStop() {
    if (!this.server) return this.getStatus();
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceCloseTimer);
        resolve();
      };
      server.close(finish);
      // A client (e.g. a stdio bridge left connected to an AI agent) can hold an idle
      // keep-alive socket open indefinitely; server.close() waits for it by design. Force
      // remaining sockets shut after a grace period so stop()/restart() always completes.
      const forceCloseTimer = setTimeout(() => server.closeAllConnections?.(), 2000);
    });
    this.startedAt = null;
    this.clients.clear();
    this.activeToken = null;
    this.emitStatus();
    return this.getStatus();
  }

  async _doRestart() {
    this.restarting = true;
    this.emitStatus();
    try {
      await this._doStop();
      this.config = normalizeMcpConfig(this.getPreferences());
      if (this.config.enabled) await this._doStart();
    } finally {
      // Reset and re-emit together, after start/stop settle either way, so a failed restart
      // still leaves listeners with a final running/stopped status instead of a stale
      // "restarting" snapshot.
      this.restarting = false;
      this.emitStatus();
    }
    return this.getStatus();
  }

  get endpoint() { return `http://${this.config.host}:${this.config.port}/mcp`; }
  getStatus() {
    const running = Boolean(this.server);
    return {
      enabled: this.config.enabled,
      running,
      state: this.restarting ? 'restarting' : (running ? 'running' : 'stopped'),
      endpoint: this.endpoint,
      host: this.config.host,
      port: this.config.port,
      workspaceCount: buildWorkspaceDirectory().length,
      connectedClients: this.clients.size,
      startedAt: this.startedAt,
      error: this.lastError?.message || null
    };
  }

  getClientConfigurations() {
    return createMcpClientConfigurations({ endpoint: this.endpoint });
  }

  async applyPreferences(preferences) {
    this.config = normalizeMcpConfig(preferences);
    await this.savePreferences(preferences);
    return this.restart();
  }

  async preferencesChanged(preferences) {
    this.config = normalizeMcpConfig(preferences); return this.restart();
  }

  async rotateToken({ reveal = false } = {}) {
    const record = await this.tokenStore.rotate();
    this.activeToken = record.token;
    this.clients.clear();
    const result = { ...(await this.tokenStore.metadata()), clientsDisconnected: true };
    if (reveal) result.token = record.token;
    return result;
  }

  async disconnectClients() { return { disconnected: true, ...(await this.rotateToken({ reveal: true })) }; }
}

const assertHostHeaderSafe = () => true;

module.exports = {
  BrunoMcpServerManager,
  assertHostHeaderSafe,
  bearerToken,
  jsonText,
  parseJsonBody,
  registerBrunoMcpResources,
  registerBrunoMcpTools,
  requestClientKey,
  tokenMatches
};
