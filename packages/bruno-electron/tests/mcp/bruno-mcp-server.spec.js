const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { FlowPersistenceService } = require('../../src/services/flow-persistence-service');
const { BrunoMcpServerManager } = require('../../src/mcp/server');
const { McpAuditService } = require('../../src/mcp/audit-service');

const getFreePort = () => new Promise((resolve, reject) => {
  const server = http.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});

const createFlow = () => ({
  schemaVersion: 1,
  uid: 'flow_mcp_gate',
  name: 'MCP gate flow',
  workspace: { uid: 'workspace_mcp' },
  defaults: {},
  inputSchema: { type: 'object', properties: { customerId: { type: 'string' } } },
  nodes: [
    { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
    {
      id: 'request_one',
      semanticKey: 'request_one',
      kind: 'http',
      position: { x: 180, y: 0 },
      requestRef: { collectionPath: 'collections/api', itemPathname: 'one.bru', expectedMethod: 'GET' },
      config: {},
      policy: { sideEffect: 'read-only', resume: 'reuse' }
    },
    { id: 'end', semanticKey: 'end', kind: 'end', position: { x: 360, y: 0 }, config: {} }
  ],
  controlEdges: [
    { id: 'start_request', sourceNodeId: 'start', targetNodeId: 'request_one' },
    { id: 'request_end', sourceNodeId: 'request_one', targetNodeId: 'end' }
  ],
  dataEdges: [],
  frames: [],
  metadata: { createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z' }
});

const parseToolText = (result) => JSON.parse(result.content.find((entry) => entry.type === 'text').text);

const connect = async (endpoint, token) => {
  const client = new Client({ name: 'bruno-mcp-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  });
  await client.connect(transport);
  return client;
};

describe('Bruno MCP Streamable HTTP integration', () => {
  let root;
  let workspacePath;
  let manager;
  let preferences;
  let token;
  let rotatedToken;
  let flowPersistenceService;
  let flowRuntimeService;
  let requestExecutionService;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-mcp-server-'));
    workspacePath = path.join(root, 'workspace');
    const collectionPath = path.join(workspacePath, 'collections', 'api');
    fs.mkdirSync(collectionPath, { recursive: true });
    fs.writeFileSync(path.join(collectionPath, 'bruno.json'), '{}');
    fs.writeFileSync(path.join(collectionPath, 'one.bru'), `meta {\n  name: Secret-safe request\n  type: http\n  seq: 1\n}\n\nget {\n  url: https://api.test/users\n  body: none\n  auth: none\n}\n\nheaders {\n  Authorization: Bearer raw-request-secret\n}\n`);

    flowPersistenceService = new FlowPersistenceService();
    await flowPersistenceService.createFlow({ workspacePath, relativePath: 'mcp-gate.flow.yml', flow: createFlow() });
    const port = await getFreePort();
    preferences = {
      general: {},
      mcp: {
        enabled: true,
        host: '127.0.0.1',
        port,
        permissionProfile: 'runner',
        allowedWorkspaces: [{ uid: 'workspace_mcp', name: 'MCP workspace', path: workspacePath }],
        allowedHosts: ['api.test'],
        auditEnabled: true,
        rateLimitPerMinute: 1000
      }
    };
    token = 'test-token-with-at-least-256-bits-1234567890';
    rotatedToken = 'rotated-test-token-with-at-least-256-bits';
    const tokenStore = {
      ensure: jest.fn(async () => ({ token, createdAt: '2026-07-21T00:00:00.000Z', rotatedAt: null })),
      rotate: jest.fn(async () => ({ token: rotatedToken, createdAt: '2026-07-21T00:00:00.000Z', rotatedAt: '2026-07-21T01:00:00.000Z' })),
      metadata: jest.fn(async () => ({ fingerprint: 'fingerprint', createdAt: '2026-07-21T00:00:00.000Z', rotatedAt: null })),
      fingerprint: jest.fn(() => 'fingerprint')
    };
    flowRuntimeService = {
      run: jest.fn(async ({ runId, flow }) => ({
        runId,
        flowUid: flow.uid,
        status: 'success',
        startedAt: '2026-07-21T00:00:00.000Z',
        completedAt: '2026-07-21T00:00:00.010Z',
        durationMs: 10,
        nodeOrder: ['start', 'request_one', 'end'],
        branchOrder: [],
        results: { request_one: { status: 'success', response: { status: 200, body: { token: 'raw-flow-secret', visible: 'ok' } } } },
        previews: {},
        outputs: {},
        journal: {},
        events: [{ schemaVersion: 1, eventId: 'event_1', sequence: 1, timestamp: '2026-07-21T00:00:00.000Z', source: 'flow-runtime', type: 'flow.run.completed', runId, flowUid: flow.uid, payload: { token: 'raw-event-secret' } }]
      })),
      cancel: jest.fn((runId) => ({ runId, cancelled: true })),
      previewRequest: jest.fn(async () => ({ nodeId: 'request_one', preview: { headers: { Authorization: 'raw-preview-secret' } }, bindings: [] }))
    };
    requestExecutionService = {
      executeWithLegacy: jest.fn(async ({ item, runtimeVariables, environmentContext, executionContext }) => {
        await executionContext.requestGuard({ url: item.request.url, method: item.request.method });
        return {
          result: {
            executionId: executionContext.executionId || 'execution_mcp_request',
            status: 'success',
            response: {
              status: 200,
              body: { access_token: 'raw-api-secret', visible: 'ok' }
            },
            tests: [{ name: 'status is 200', passed: true }],
            assertions: []
          },
          item,
          runtimeVariables,
          environmentContext
        };
      })
    };
    manager = new BrunoMcpServerManager({
      appDataPath: root,
      getPreferences: () => preferences,
      savePreferences: jest.fn(async (next) => { preferences = next; }),
      flowPersistenceService,
      flowRuntimeService,
      requestExecutionService,
      tokenStore,
      auditService: new McpAuditService({ directory: path.join(root, 'audit') })
    });
    await manager.start();
  });

  afterEach(async () => {
    await manager?.stop();
    await flowPersistenceService?.closeAll();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('authenticates a client, lists flows, runs a flow, and reads run resources', async () => {
    const client = await connect(manager.endpoint, token);
    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
        'bruno_list_flows', 'bruno_run_flow', 'bruno_cancel_run', 'bruno_preview_flow_patch', 'bruno_apply_flow_patch'
      ]));
      const listed = parseToolText(await client.callTool({ name: 'bruno_list_flows', arguments: { workspace_uid: 'workspace_mcp' } }));
      expect(listed.flows).toEqual(expect.arrayContaining([expect.objectContaining({ uid: 'flow_mcp_gate' })]));

      const run = parseToolText(await client.callTool({
        name: 'bruno_run_flow',
        arguments: { workspace_uid: 'workspace_mcp', flow_uid: 'flow_mcp_gate', wait_mode: 'complete', inputs: { customerId: 'cus_1' } }
      }));
      expect(run.status).toBe('success');
      expect(JSON.stringify(run)).not.toContain('raw-flow-secret');
      expect(run.result.results.request_one.response.body.token).toBe('[REDACTED]');

      const resource = await client.readResource({ uri: `bruno://run/${run.run_id}` });
      const resourceBody = JSON.parse(resource.contents[0].text);
      expect(resourceBody.status).toBe('success');
      expect(JSON.stringify(resourceBody)).not.toContain('raw-event-secret');
      expect(flowRuntimeService.run).toHaveBeenCalledTimes(1);
    } finally {
      await client.close();
    }
  });

  it('redacts request definitions and resolved previews', async () => {
    const client = await connect(manager.endpoint, token);
    try {
      const request = parseToolText(await client.callTool({
        name: 'bruno_get_request',
        arguments: { workspace_uid: 'workspace_mcp', collection_path: 'collections/api', item_pathname: 'one.bru' }
      }));
      expect(JSON.stringify(request)).not.toContain('raw-request-secret');
      const preview = parseToolText(await client.callTool({
        name: 'bruno_preview_resolved_request',
        arguments: { workspace_uid: 'workspace_mcp', flow_uid: 'flow_mcp_gate', node_id: 'request_one' }
      }));
      expect(JSON.stringify(preview)).not.toContain('raw-preview-secret');
      expect(preview.preview.headers.Authorization).toBe('[REDACTED]');
    } finally {
      await client.close();
    }
  });

  it('prepares and runs an API request through the real MCP tool with a structured redacted result', async () => {
    const client = await connect(manager.endpoint, token);
    try {
      const prepared = parseToolText(await client.callTool({
        name: 'bruno_prepare_request',
        arguments: {
          workspace_uid: 'workspace_mcp',
          collection_path: 'collections/api',
          item_pathname: 'one.bru',
          runtime_variables: { user_id: 'usr_42' }
        }
      }));
      expect(prepared).toMatchObject({
        method: 'GET',
        resolved_url: 'https://api.test/users',
        side_effect: 'read-only',
        ready: true,
        runtime_variable_names: ['user_id']
      });

      const result = parseToolText(await client.callTool({
        name: 'bruno_run_request',
        arguments: {
          workspace_uid: 'workspace_mcp',
          collection_path: 'collections/api',
          item_pathname: 'one.bru',
          runtime_variables: { user_id: 'usr_42' }
        }
      }));
      expect(result.status).toBe('success');
      expect(result.response.status).toBe(200);
      expect(result.response.body.visible).toBe('ok');
      expect(result.response.body.access_token).toBe('[REDACTED]');
      expect(result.request_context).toMatchObject({
        method: 'GET',
        resolved_url: 'https://api.test/users',
        runtime_variable_names: ['user_id']
      });
      expect(requestExecutionService.executeWithLegacy).toHaveBeenCalledWith(expect.objectContaining({
        collection: expect.objectContaining({
          pathname: path.join(workspacePath, 'collections', 'api'),
          items: expect.any(Array)
        }),
        item: expect.objectContaining({ name: 'Secret-safe request' }),
        runtimeVariables: { user_id: 'usr_42' },
        executionContext: expect.objectContaining({ source: 'mcp' })
      }));
    } finally {
      await client.close();
    }
  });

  it('denies execution when the permission profile is Read Only', async () => {
    preferences = { ...preferences, mcp: { ...preferences.mcp, permissionProfile: 'read-only' } };
    await manager.preferencesChanged(preferences);
    const client = await connect(manager.endpoint, token);
    try {
      const result = await client.callTool({
        name: 'bruno_run_flow',
        arguments: { workspace_uid: 'workspace_mcp', flow_uid: 'flow_mcp_gate', wait_mode: 'complete' }
      });
      expect(result.isError).toBe(true);
      expect(parseToolText(result).error.code).toBe('BRUNO_MCP_PERMISSION_DENIED');
      expect(flowRuntimeService.run).not.toHaveBeenCalled();
    } finally {
      await client.close();
    }
  });

  it('rejects missing or incorrect bearer authentication', async () => {
    await expect(connect(manager.endpoint, 'wrong-token')).rejects.toThrow();
  });

  it('rate limits authentication failures by remote address so rotating bad tokens cannot bypass the limit', async () => {
    preferences = { ...preferences, mcp: { ...preferences.mcp, rateLimitPerMinute: 10 } };
    await manager.preferencesChanged(preferences);
    const statuses = [];
    for (let index = 0; index < 11; index += 1) {
      const response = await fetch(manager.endpoint, {
        method: 'POST',
        headers: {
          'authorization': `Bearer wrong-token-${index}`,
          'content-type': 'application/json'
        },
        body: '{}'
      });
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10)).toEqual(Array(10).fill(401));
    expect(statuses[10]).toBe(429);
  });

  it('revokes the old bearer token immediately after rotation without restarting the server', async () => {
    const originalClient = await connect(manager.endpoint, token);
    await originalClient.close();
    const rotation = await manager.rotateToken({ reveal: true });
    expect(rotation.token).toBe(rotatedToken);
    await expect(connect(manager.endpoint, token)).rejects.toThrow();
    const rotatedClient = await connect(manager.endpoint, rotatedToken);
    try {
      const status = parseToolText(await rotatedClient.callTool({ name: 'bruno_status', arguments: {} }));
      expect(status.status).toBe('ok');
    } finally {
      await rotatedClient.close();
    }
  });

  it('requires preview approval and revision matching before applying a flow patch', async () => {
    preferences = { ...preferences, mcp: { ...preferences.mcp, permissionProfile: 'editor' } };
    await manager.preferencesChanged(preferences);
    const client = await connect(manager.endpoint, token);
    try {
      const current = parseToolText(await client.callTool({
        name: 'bruno_get_flow',
        arguments: { workspace_uid: 'workspace_mcp', flow_uid: 'flow_mcp_gate' }
      }));
      const operations = [{ op: 'replace', path: '/name', value: 'Patched by MCP' }];
      const preview = parseToolText(await client.callTool({
        name: 'bruno_preview_flow_patch',
        arguments: { workspace_uid: 'workspace_mcp', flow_uid: 'flow_mcp_gate', expected_revision: current.revision, operations }
      }));
      expect(preview.valid).toBe(true);
      const rejected = await client.callTool({
        name: 'bruno_apply_flow_patch',
        arguments: { workspace_uid: 'workspace_mcp', flow_uid: 'flow_mcp_gate', expected_revision: current.revision, preview_id: preview.preview_id, approved: false, operations }
      }).catch((error) => error);
      expect(rejected).toBeDefined();

      const applied = parseToolText(await client.callTool({
        name: 'bruno_apply_flow_patch',
        arguments: { workspace_uid: 'workspace_mcp', flow_uid: 'flow_mcp_gate', expected_revision: current.revision, preview_id: preview.preview_id, approved: true, operations }
      }));
      expect(applied.applied).toBe(true);
      expect(applied.revision).not.toBe(current.revision);
      const saved = await flowPersistenceService.resolveFlowReference({ workspacePath, flowUid: 'flow_mcp_gate' });
      expect(saved.flow.name).toBe('Patched by MCP');
    } finally {
      await client.close();
    }
  });

  it('resolves a flow resource uniquely across multiple allowed workspaces', async () => {
    const secondWorkspace = path.join(root, 'workspace-two');
    fs.mkdirSync(secondWorkspace, { recursive: true });
    preferences = {
      ...preferences,
      mcp: {
        ...preferences.mcp,
        allowedWorkspaces: [
          ...preferences.mcp.allowedWorkspaces,
          { uid: 'workspace_two', name: 'Second workspace', path: secondWorkspace }
        ]
      }
    };
    await manager.preferencesChanged(preferences);
    const client = await connect(manager.endpoint, token);
    try {
      const resource = await client.readResource({ uri: 'bruno://flow/flow_mcp_gate' });
      const body = JSON.parse(resource.contents[0].text);
      expect(body.flow.uid).toBe('flow_mcp_gate');
      expect(body.workspace_uid).toBe('workspace_mcp');
    } finally {
      await client.close();
    }
  });
});
