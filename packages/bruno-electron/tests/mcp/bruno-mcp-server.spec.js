const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { stringifyRequest } = require('@usebruno/filestore');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { BrunoMcpServerManager } = require('../../src/mcp/server');

const getFreePort = () => new Promise((resolve, reject) => {
  const server = http.createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});

const parseToolText = (result) => JSON.parse(result.content.find((entry) => entry.type === 'text').text);
const connect = async (endpoint, token) => {
  const client = new Client({ name: 'bruno-mcp-test', version: '2.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  }));
  return client;
};

const requestFixtureValue = ['raw', 'request', 'value'].join('-');
const requestDefinition = () => ({
  uid: 'request_users_get',
  type: 'http-request',
  name: 'Get users',
  seq: 1,
  description: 'Full MCP fixture',
  tags: ['users'],
  settings: { encodeUrl: true, timeout: 5000 },
  request: {
    method: 'GET',
    url: '{{baseUrl}}/users',
    params: [{ uid: 'param_page', name: 'page', value: '1', type: 'query', enabled: true }],
    headers: [{ uid: 'header_auth', name: 'Authorization', value: `Bearer ${requestFixtureValue}`, enabled: true }],
    auth: { mode: 'bearer', bearer: { token: requestFixtureValue } },
    body: { mode: 'none' },
    vars: {
      req: [{ uid: 'var_limit', name: 'limit', value: '20', enabled: true, local: false, dataType: 'number' }],
      res: []
    },
    script: { req: 'bru.setVar("started", true);', res: '' },
    assertions: [{ uid: 'assert_status', name: 'res.status', value: 'eq 200', enabled: true }],
    tests: 'test("status", () => expect(res.status).to.equal(200));',
    docs: '# Get users'
  },
  examples: []
});

describe('Bruno collection MCP Streamable HTTP integration', () => {
  let root;
  let workspacePath;
  let collectionPath;
  let manager;
  let preferences;
  let token;
  let rotatedToken;
  let requestExecutionService;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-mcp-server-'));
    workspacePath = path.join(root, 'workspace');
    collectionPath = path.join(workspacePath, 'collections', 'api');
    fs.mkdirSync(path.join(collectionPath, 'users'), { recursive: true });
    fs.writeFileSync(path.join(collectionPath, 'bruno.json'), JSON.stringify({ version: '1', name: 'MCP API', type: 'collection' }, null, 2));
    fs.writeFileSync(path.join(collectionPath, 'users', 'get-users.bru'), stringifyRequest(requestDefinition(), { format: 'bru' }));
    const port = await getFreePort();
    preferences = {
      general: {},
      mcp: {
        enabled: true,
        port,
        workspaces: [{ uid: 'workspace_mcp', name: 'MCP workspace', path: workspacePath }],
        requestTimeoutMs: 10000,
        maxRequestFiles: 1000
      }
    };
    token = 'test-token-with-at-least-256-bits-1234567890';
    rotatedToken = 'rotated-test-token-with-at-least-256-bits';
    const tokenStore = {
      ensure: jest.fn(async () => ({ token, createdAt: '2026-07-21T00:00:00.000Z', rotatedAt: null })),
      rotate: jest.fn(async () => ({ token: rotatedToken, createdAt: '2026-07-21T00:00:00.000Z', rotatedAt: '2026-07-21T01:00:00.000Z' })),
      metadata: jest.fn(async () => ({ fingerprint: 'fingerprint', createdAt: '2026-07-21T00:00:00.000Z', rotatedAt: null }))
    };
    requestExecutionService = {
      executeWithLegacy: jest.fn(async ({ item, runtimeVariables, executionContext }) => {
        await executionContext.requestGuard({ url: item.request.url, method: item.request.method });
        return {
          result: {
            executionId: executionContext.executionId,
            status: 'success',
            request: item.request,
            response: { status: 200, headers: { 'content-type': 'application/json' }, body: { access_token: 'raw-api-secret', visible: 'ok' } },
            tests: [{ name: 'status', status: 'pass' }],
            assertions: [],
            runtimeVariables
          },
          legacyResult: { status: 200, data: { access_token: 'raw-api-secret', visible: 'ok' }, headers: {} }
        };
      })
    };
    manager = new BrunoMcpServerManager({
      appDataPath: root,
      getPreferences: () => preferences,
      savePreferences: jest.fn(async (next) => { preferences = next; }),
      requestExecutionService,
      tokenStore
    });
    await manager.start();
  });

  afterEach(async () => {
    await manager?.stop();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('exposes a flat collection/request surface and omits Flow Studio and Intelligence tools', async () => {
    const client = await connect(manager.endpoint, token);
    try {
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toEqual(expect.arrayContaining([
        'bruno_list_collections',
        'bruno_get_collection',
        'bruno_create_folder',
        'bruno_get_request',
        'bruno_update_request',
        'bruno_update_request_tab',
        'bruno_create_environment',
        'bruno_prepare_request',
        'bruno_run_request',
        'bruno_get_request_run'
      ]));
      expect(names.some((name) => name.includes('flow'))).toBe(false);
      expect(names.some((name) => name.includes('intelligence'))).toBe(false);

      const collections = parseToolText(await client.callTool({ name: 'bruno_list_collections', arguments: { workspace_uid: 'workspace_mcp' } }));
      expect(collections.collections).toEqual([expect.objectContaining({ name: 'MCP API', collection_path: 'collections/api' })]);
    } finally {
      await client.close();
    }
  });

  it('returns the complete request and edits name, vars, headers, body, and settings without redaction', async () => {
    const client = await connect(manager.endpoint, token);
    try {
      const reference = { workspace_uid: 'workspace_mcp', collection_path: 'collections/api', item_pathname: 'users/get-users.bru' };
      const current = parseToolText(await client.callTool({ name: 'bruno_get_request', arguments: reference }));
      expect(current.definition.name).toBe('Get users');
      expect(current.definition.request.auth.bearer.token).toBe(requestFixtureValue);
      expect(current.definition.request.vars.req[0]).toMatchObject({ name: 'limit', value: 20 });

      parseToolText(await client.callTool({
        name: 'bruno_update_request',
        arguments: {
          ...reference,
          name: 'List users',
          set: {
            'request.vars.req': [{ uid: 'var_limit', name: 'limit', value: 50, enabled: true, local: true, dataType: 'number' }],
            'request.body': { mode: 'json', json: '{"includeDisabled":true}' },
            'settings.timeout': 12000
          }
        }
      }));
      parseToolText(await client.callTool({
        name: 'bruno_update_request_tab',
        arguments: {
          ...reference,
          tab: 'headers',
          value: [{ uid: 'header_trace', name: 'X-Trace', value: 'mcp', enabled: true }]
        }
      }));

      const updated = parseToolText(await client.callTool({ name: 'bruno_get_request', arguments: reference }));
      expect(updated.definition).toMatchObject({ name: 'List users', settings: { timeout: 12000 } });
      expect(updated.definition.request.vars.req[0]).toMatchObject({ name: 'limit', value: 50, local: true });
      expect(updated.definition.request.headers).toEqual([expect.objectContaining({ name: 'X-Trace', value: 'mcp' })]);
      expect(updated.definition.request.body).toMatchObject({ mode: 'json', json: '{"includeDisabled":true}' });
    } finally {
      await client.close();
    }
  });

  it('creates and deletes folders, requests, environments, and dotenv data', async () => {
    const client = await connect(manager.endpoint, token);
    try {
      const collectionReference = { workspace_uid: 'workspace_mcp', collection_path: 'collections/api' };
      const folder = parseToolText(await client.callTool({ name: 'bruno_create_folder', arguments: { ...collectionReference, folder_name: 'admin', name: 'Admin' } }));
      expect(folder.definition.meta.name).toBe('Admin');

      const request = parseToolText(await client.callTool({
        name: 'bruno_create_request',
        arguments: { ...collectionReference, folder_path: 'admin', name: 'Create admin', filename: 'create-admin', type: 'http', method: 'POST', url: 'https://api.test/admin' }
      }));
      expect(request.definition).toMatchObject({ name: 'Create admin', type: 'http-request', request: { method: 'POST' } });

      const environment = parseToolText(await client.callTool({
        name: 'bruno_create_environment',
        arguments: {
          ...collectionReference,
          name: 'Local',
          definition: { variables: [{ uid: 'base_url', name: 'baseUrl', value: 'https://api.test', type: 'text', enabled: true, secret: false }] }
        }
      }));
      expect(environment.environment.definition.variables[0].name).toBe('baseUrl');

      const dotenv = parseToolText(await client.callTool({ name: 'bruno_set_dotenv', arguments: { ...collectionReference, variables: { TOKEN: 'abc', REGION: 'local' } } }));
      expect(dotenv.variables).toMatchObject({ TOKEN: 'abc', REGION: 'local' });

      expect(parseToolText(await client.callTool({ name: 'bruno_delete_request', arguments: { ...collectionReference, item_pathname: 'admin/create-admin.bru' } })).deleted).toBe(true);
      expect(parseToolText(await client.callTool({ name: 'bruno_delete_environment', arguments: { ...collectionReference, environment_name: 'Local' } })).deleted).toBe(true);
      expect(parseToolText(await client.callTool({ name: 'bruno_delete_folder', arguments: { ...collectionReference, folder_path: 'admin' } })).deleted).toBe(true);
    } finally {
      await client.close();
    }
  });

  it('runs POST requests without policy approval and retains complete results for later retrieval', async () => {
    const client = await connect(manager.endpoint, token);
    try {
      const reference = { workspace_uid: 'workspace_mcp', collection_path: 'collections/api', item_pathname: 'users/get-users.bru' };
      parseToolText(await client.callTool({ name: 'bruno_update_request', arguments: { ...reference, set: { 'request.method': 'POST' } } }));
      const started = parseToolText(await client.callTool({ name: 'bruno_run_request', arguments: { ...reference, wait_mode: 'start', runtime_variables: { page: 2 } } }));
      expect(started).toMatchObject({ status: 'running' });

      let stored;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        stored = parseToolText(await client.callTool({ name: 'bruno_get_request_run', arguments: { run_id: started.run_id } }));
        if (stored.status !== 'running') break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(stored.status).toBe('success');
      expect(stored.result.response.body).toEqual({ access_token: 'raw-api-secret', visible: 'ok' });
      expect(stored.request.prepared_request.method).toBe('POST');
      expect(requestExecutionService.executeWithLegacy).toHaveBeenCalledWith(expect.objectContaining({ executionContext: expect.objectContaining({ source: 'mcp' }) }));

      const resource = await client.readResource({ uri: `bruno://request-run/${started.run_id}` });
      expect(JSON.parse(resource.contents[0].text).result.response.status).toBe(200);
    } finally {
      await client.close();
    }
  });

  it('requires bearer authentication and revokes the old token on rotation', async () => {
    await expect(connect(manager.endpoint, 'wrong-token')).rejects.toThrow();
    expect((await manager.rotateToken({ reveal: true })).token).toBe(rotatedToken);
    await expect(connect(manager.endpoint, token)).rejects.toThrow();
    const client = await connect(manager.endpoint, rotatedToken);
    await client.close();
  });
});
