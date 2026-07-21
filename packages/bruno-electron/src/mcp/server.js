const http = require('node:http');
const { timingSafeEqual, createHash } = require('node:crypto');
const { McpServer, ResourceTemplate } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { normalizeMcpConfig, LOOPBACK_HOSTS } = require('./config');
const { assertScope } = require('./permissions');
const { McpRateLimiter } = require('./rate-limit');
const { McpAuditService } = require('./audit-service');
const { McpTokenStore } = require('./token-store');
const { redactMcpValue, safeMcpError, summarizeMcpArgs } = require('./redaction');
const { BrunoMcpAutomationFacade } = require('./automation-facade');

const MAX_BODY_BYTES = 1024 * 1024;

const jsonText = (value) => ({
  content: [{ type: 'text', text: JSON.stringify(redactMcpValue(value)) }]
});

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
  const header = String(request.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || '';
};

const requestClientKey = (request, token) => {
  const fingerprint = createHash('sha256').update(String(token || '')).digest('hex').slice(0, 16);
  return `${request.socket.remoteAddress || 'unknown'}:${fingerprint}`;
};

const assertHostHeaderSafe = (request, config) => {
  if (config.allowRemote) return;
  const rawHost = String(request.headers.host || '').trim();
  const hostname = rawHost.startsWith('[')
    ? rawHost.slice(0, rawHost.indexOf(']') + 1)
    : rawHost.split(':')[0];
  if (!LOOPBACK_HOSTS.has(hostname)) {
    const error = new Error('Bruno MCP rejected a non-loopback Host header');
    error.code = 'BRUNO_MCP_HOST_HEADER_FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }
};

const commonWorkspaceSchema = {
  workspace_uid: z.string().min(1).optional(),
  workspace_path: z.string().min(1).optional()
};

const commonFlowSchema = {
  ...commonWorkspaceSchema,
  flow_uid: z.string().min(1).optional(),
  relative_path: z.string().min(1).optional()
};

const commonRequestSchema = {
  ...commonWorkspaceSchema,
  request_uid: z.string().min(1).optional(),
  collection_path: z.string().min(1).optional(),
  item_pathname: z.string().min(1).optional()
};

const requestExecutionSchema = {
  ...commonRequestSchema,
  environment_uid: z.string().min(1).optional(),
  environment_name: z.string().min(1).optional(),
  runtime_variables: z.record(z.string(), z.unknown()).optional(),
  prompt_variables: z.record(z.string(), z.unknown()).optional()
};

const registerBrunoMcpTools = (mcp, { facade, config, audit, client }) => {
  const register = (name, definition, handler) => {
    mcp.registerTool(name, definition, async (args = {}) => {
      const startedAt = Date.now();
      try {
        assertScope(config.permissionProfile, definition.scope, name);
        const result = await handler(args);
        await audit.append({
          event: 'mcp.tool.completed',
          tool: name,
          client,
          permissionProfile: config.permissionProfile,
          durationMs: Date.now() - startedAt,
          status: 'success',
          args: summarizeMcpArgs(args)
        });
        return jsonText(result);
      } catch (error) {
        await audit.append({
          event: 'mcp.tool.failed',
          tool: name,
          client,
          permissionProfile: config.permissionProfile,
          durationMs: Date.now() - startedAt,
          status: 'failed',
          error: safeMcpError(error),
          args: summarizeMcpArgs(args)
        });
        return { isError: true, ...jsonText({ error: safeMcpError(error) }) };
      }
    });
  };

  register('bruno_status', {
    description: 'Return safe Bruno MCP status and policy metadata.',
    scope: 'bruno:status',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {}
  }, () => facade.status());

  register('bruno_list_workspaces', {
    description: 'List workspaces explicitly allowed in Bruno MCP preferences.',
    scope: 'bruno:read',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {}
  }, () => ({ workspaces: facade.listWorkspaces() }));

  register('bruno_list_flows', {
    description: 'List Flow Studio flows in an allowed workspace.',
    scope: 'bruno:flow:read',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: commonWorkspaceSchema
  }, (args) => facade.listFlows(args));

  register('bruno_get_flow', {
    description: 'Read one canonical Flow Studio definition with secret-safe projection.',
    scope: 'bruno:flow:read',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: commonFlowSchema
  }, (args) => facade.getFlow(args));

  register('bruno_list_requests', {
    description: 'List requests from an allowed workspace without exposing secrets.',
    scope: 'bruno:read',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: { ...commonWorkspaceSchema, limit: z.number().int().min(1).max(1000).optional() }
  }, (args) => facade.listRequests(args));

  register('bruno_search_requests', {
    description: 'Search requests by name, method, URL, or pathname.',
    scope: 'bruno:read',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: { ...commonWorkspaceSchema, query: z.string().min(1), limit: z.number().int().min(1).max(1000).optional() }
  }, (args) => facade.listRequests(args));

  register('bruno_get_request', {
    description: 'Read one Bruno request using a redacted projection.',
    scope: 'bruno:read',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: commonRequestSchema
  }, (args) => facade.getRequest(args));

  register('bruno_validate_flow', {
    description: 'Validate a persisted Flow Studio flow without network execution.',
    scope: 'bruno:prepare',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: commonFlowSchema
  }, (args) => facade.validateFlow(args));

  register('bruno_get_flow_inputs', {
    description: 'Return the input schema and safe run preparation summary for a flow.',
    scope: 'bruno:prepare',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: commonFlowSchema
  }, (args) => facade.prepareFlowRun(args));

  register('bruno_prepare_flow_run', {
    description: 'Preview validation, request hosts, inputs, and side effects before running a flow.',
    scope: 'bruno:prepare',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: commonFlowSchema
  }, (args) => facade.prepareFlowRun(args));

  register('bruno_get_side_effect_summary', {
    description: 'Return a safe side-effect summary for a persisted flow.',
    scope: 'bruno:prepare',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: commonFlowSchema
  }, async (args) => (await facade.prepareFlowRun(args)).side_effect_summary);

  register('bruno_preview_resolved_request', {
    description: 'Resolve one request node preview without calling the network.',
    scope: 'bruno:prepare',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      ...commonFlowSchema,
      node_id: z.string().min(1),
      inputs: z.record(z.string(), z.unknown()).optional()
    }
  }, (args) => facade.previewResolvedRequest(args));

  register('bruno_prepare_request', {
    description: 'Resolve a request through its real collection, folder, environment, dotenv, and variable context without network execution.',
    scope: 'bruno:prepare',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: requestExecutionSchema
  }, (args) => facade.prepareRequest(args));

  register('bruno_run_request', {
    description: 'Execute one allowlisted Bruno request through the normal desktop RequestExecutionService and return its structured response, tests, assertions, and variable changes.',
    scope: 'bruno:execute:request',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: {
      ...requestExecutionSchema,
      correlation_id: z.string().optional(),
      allow_side_effects: z.boolean().optional()
    }
  }, (args) => facade.runRequest(args));

  register('bruno_run_flow', {
    description: 'Run an allowlisted Flow Studio flow and return a structured run resource.',
    scope: 'bruno:execute:flow',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: {
      ...commonFlowSchema,
      run_id: z.string().optional(),
      inputs: z.record(z.string(), z.unknown()).optional(),
      dataset: z.unknown().optional(),
      wait_mode: z.enum(['start', 'complete']).optional(),
      idempotency_key: z.string().optional()
    }
  }, (args) => facade.runFlow(args));

  register('bruno_cancel_run', {
    description: 'Cancel an active Bruno flow run.',
    scope: 'bruno:execute:flow',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    inputSchema: { run_id: z.string().min(1) }
  }, (args) => facade.cancelRun(args));

  register('bruno_get_run', {
    description: 'Read the safe status and result summary for a Bruno run.',
    scope: 'bruno:run:read',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: { run_id: z.string().min(1) }
  }, (args) => facade.getRun(args));

  register('bruno_get_run_events', {
    description: 'Read redacted run events after an optional sequence number.',
    scope: 'bruno:run:read',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      run_id: z.string().min(1),
      after_sequence: z.number().int().min(0).optional(),
      limit: z.number().int().min(1).max(5000).optional()
    }
  }, (args) => facade.getRunEvents(args));

  register('bruno_preview_flow_patch', {
    description: 'Preview and validate a revision-safe Flow Studio JSON patch. This never writes.',
    scope: 'bruno:flow:write:preview',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      ...commonFlowSchema,
      expected_revision: z.string().min(1),
      operations: z.array(z.object({
        op: z.enum(['add', 'replace', 'remove']),
        path: z.string().min(1),
        value: z.unknown().optional()
      })).min(1).max(100)
    }
  }, (args) => facade.previewFlowPatch(args));

  register('bruno_apply_flow_patch', {
    description: 'Apply an approved previewed Flow Studio patch with an expected revision guard.',
    scope: 'bruno:flow:write',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    inputSchema: {
      ...commonFlowSchema,
      expected_revision: z.string().min(1),
      preview_id: z.string().min(1),
      approved: z.literal(true),
      operations: z.array(z.object({
        op: z.enum(['add', 'replace', 'remove']),
        path: z.string().min(1),
        value: z.unknown().optional()
      })).min(1).max(100)
    }
  }, (args) => facade.applyFlowPatch(args));
};

const registerBrunoMcpResources = (mcp, facade) => {
  mcp.registerResource(
    'bruno-run',
    new ResourceTemplate('bruno://run/{runId}', { list: undefined }),
    { description: 'Safe Bruno run status and result summary', mimeType: 'application/json' },
    async (uri, variables) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(facade.getRun({ run_id: variables.runId })) }]
    })
  );
  mcp.registerResource(
    'bruno-run-events',
    new ResourceTemplate('bruno://run/{runId}/events', { list: undefined }),
    { description: 'Redacted Bruno run events', mimeType: 'application/json' },
    async (uri, variables) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(facade.getRunEvents({ run_id: variables.runId })) }]
    })
  );
  mcp.registerResource(
    'bruno-flow',
    new ResourceTemplate('bruno://flow/{flowUid}', { list: undefined }),
    { description: 'Canonical redacted Flow Studio definition', mimeType: 'application/json' },
    async (uri, variables) => ({
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await facade.getFlow({ flow_uid: variables.flowUid })) }]
    })
  );
};

class BrunoMcpServerManager {
  constructor({
    appDataPath,
    getPreferences,
    savePreferences,
    flowPersistenceService,
    flowRuntimeService,
    requestExecutionService,
    mainWindow = null,
    tokenStore,
    auditService,
    now = () => new Date()
  } = {}) {
    this.appDataPath = appDataPath;
    this.getPreferences = getPreferences;
    this.savePreferences = savePreferences;
    this.mainWindow = mainWindow;
    this.now = now;
    this.server = null;
    this.startedAt = null;
    this.config = normalizeMcpConfig(getPreferences());
    this.tokenStore = tokenStore || new McpTokenStore({ directory: `${appDataPath}/bruno-mcp` });
    this.audit = auditService || new McpAuditService({ directory: `${appDataPath}/bruno-mcp`, enabled: this.config.auditEnabled, now });
    this.rateLimiter = new McpRateLimiter({ limit: this.config.rateLimitPerMinute });
    this.authRateLimiter = new McpRateLimiter({ limit: this.config.rateLimitPerMinute });
    this.facade = new BrunoMcpAutomationFacade({
      flowPersistenceService,
      flowRuntimeService,
      requestExecutionService,
      configProvider: () => this.config,
      now
    });
    this.clients = new Map();
    this.activeToken = null;
  }

  setMainWindow(mainWindow) {
    this.mainWindow = mainWindow;
  }

  emitStatus() {
    if (!this.mainWindow || this.mainWindow.isDestroyed?.()) return;
    this.mainWindow.webContents.send('main:mcp-status', this.getStatus());
  }

  async start() {
    if (this.server) return this.getStatus();
    this.config = normalizeMcpConfig(this.getPreferences());
    if (!this.config.enabled) return this.getStatus();
    const tokenRecord = await this.tokenStore.ensure();
    this.activeToken = tokenRecord.token;
    this.audit.enabled = this.config.auditEnabled;
    this.rateLimiter = new McpRateLimiter({ limit: this.config.rateLimitPerMinute });
    this.authRateLimiter = new McpRateLimiter({ limit: this.config.rateLimitPerMinute });
    const server = http.createServer(async (request, response) => {
      try {
        assertHostHeaderSafe(request, this.config);
        const requestUrl = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
        if (requestUrl.pathname === '/healthz') {
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          response.end(JSON.stringify({ status: 'ok', product: 'Bruno MCP', loopbackOnly: !this.config.allowRemote }));
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
        const remoteAddress = request.socket.remoteAddress || 'unknown';
        this.authRateLimiter.consume(remoteAddress);
        const token = bearerToken(request);
        if (!tokenMatches(token, this.activeToken)) {
          const error = new Error('Bruno MCP authentication failed');
          error.code = 'BRUNO_MCP_UNAUTHORIZED';
          error.statusCode = 401;
          throw error;
        }
        const clientKey = requestClientKey(request, token);
        this.rateLimiter.consume(clientKey);
        this.clients.set(clientKey, { remoteAddress: request.socket.remoteAddress, lastSeenAt: this.now().toISOString() });
        const body = await parseJsonBody(request);
        const mcp = new McpServer({ name: 'Bruno Automation Platform', version: '1.0.0' });
        registerBrunoMcpTools(mcp, {
          facade: this.facade,
          config: this.config,
          audit: this.audit,
          client: { key: clientKey, remoteAddress: request.socket.remoteAddress }
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
        if (error?.retryAfterMs) response.setHeader('retry-after', String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))));
        response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
        response.end(JSON.stringify({ error: safeMcpError(error) }));
        await this.audit.append({ event: 'mcp.http.failed', status: 'failed', error: safeMcpError(error), remoteAddress: request.socket.remoteAddress });
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.config.port, this.config.host, resolve);
    });
    this.server = server;
    this.startedAt = this.now().toISOString();
    await this.audit.append({ event: 'mcp.server.started', endpoint: this.endpoint, permissionProfile: this.config.permissionProfile });
    this.emitStatus();
    return this.getStatus();
  }

  async stop() {
    if (!this.server) return this.getStatus();
    const server = this.server;
    this.server = null;
    await new Promise((resolve) => server.close(resolve));
    await this.audit.append({ event: 'mcp.server.stopped' });
    this.startedAt = null;
    this.clients.clear();
    this.activeToken = null;
    this.emitStatus();
    return this.getStatus();
  }

  async restart() {
    await this.stop();
    this.config = normalizeMcpConfig(this.getPreferences());
    if (this.config.enabled) return this.start();
    return this.getStatus();
  }

  get endpoint() {
    return `http://${this.config.host}:${this.config.port}/mcp`;
  }

  getStatus() {
    return {
      enabled: this.config.enabled,
      running: Boolean(this.server),
      endpoint: this.endpoint,
      host: this.config.host,
      port: this.config.port,
      loopbackOnly: !this.config.allowRemote,
      permissionProfile: this.config.permissionProfile,
      allowedWorkspaceCount: this.config.allowedWorkspaces.length,
      allowedHostCount: this.config.allowedHosts.length,
      connectedClients: this.clients.size,
      startedAt: this.startedAt
    };
  }

  async applyPreferences(preferences) {
    this.config = normalizeMcpConfig(preferences);
    await this.savePreferences(preferences);
    return this.restart();
  }

  async preferencesChanged(preferences) {
    this.config = normalizeMcpConfig(preferences);
    return this.restart();
  }

  async rotateToken({ reveal = false } = {}) {
    const record = await this.tokenStore.rotate();
    this.activeToken = record.token;
    this.clients.clear();
    await this.audit.append({ event: 'mcp.token.rotated', fingerprint: this.tokenStore.fingerprint(record.token) });
    const result = { ...(await this.tokenStore.metadata()), clientsDisconnected: true };
    if (reveal) result.token = record.token;
    return result;
  }

  async disconnectClients() {
    const result = await this.rotateToken({ reveal: true });
    return { disconnected: true, ...result };
  }

  listAudit(options) {
    return this.audit.list(options);
  }
}

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
