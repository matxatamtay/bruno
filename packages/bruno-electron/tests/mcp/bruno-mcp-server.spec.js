// The MCP server's workspace directory (mcp/workspace-directory.js) reads the real,
// electron-store-backed "Manage Workspaces" state (ipc/workspace.js, store/last-opened-workspaces.js,
// services/snapshot). Give it an isolated userData directory instead of a real Electron app.
jest.mock('electron', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const mockUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-mcp-userdata-'));
  return {
    ipcMain: { handle: jest.fn(), on: jest.fn() },
    dialog: { showOpenDialog: jest.fn(), showSaveDialog: jest.fn() },
    app: { getPath: jest.fn(() => mockUserDataDir), getVersion: jest.fn(() => '0.0.0'), isPackaged: false }
  };
});
jest.mock('electron-is-dev', () => false);

const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { stringifyRequest } = require('@usebruno/filestore');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { BrunoMcpServerManager } = require('../../src/mcp/server');
const LastOpenedWorkspaces = require('../../src/store/last-opened-workspaces');
const snapshotManager = require('../../src/services/snapshot');
const { createWorkspaceConfig, writeWorkspaceConfig, getWorkspaceUid } = require('../../src/utils/workspace-config');
const { createExecutionEventContext } = require('../../src/services/request-execution/execution-event-context');

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
  let workspaceUid;
  let collectionPath;
  let manager;
  let preferences;
  let token;
  let rotatedToken;
  let requestExecutionService;
  let lastOpenedWorkspaces;

  beforeEach(async () => {
    snapshotManager.resetSnapshot();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-mcp-server-'));
    workspacePath = path.join(root, 'workspace');
    collectionPath = path.join(workspacePath, 'collections', 'api');
    fs.mkdirSync(path.join(collectionPath, 'users'), { recursive: true });
    fs.writeFileSync(path.join(collectionPath, 'bruno.json'), JSON.stringify({ version: '1', name: 'MCP API', type: 'collection' }, null, 2));
    fs.writeFileSync(path.join(collectionPath, 'users', 'get-users.bru'), stringifyRequest(requestDefinition(), { format: 'bru' }));

    // Register the fixture as a real managed workspace, the same way "Open Workspace" does, so
    // bruno_list_workspaces / resolveWorkspace can find it via the real workspace directory.
    await writeWorkspaceConfig(workspacePath, createWorkspaceConfig('MCP workspace'));
    lastOpenedWorkspaces = new LastOpenedWorkspaces();
    lastOpenedWorkspaces.add(workspacePath);
    workspaceUid = getWorkspaceUid(workspacePath);

    const port = await getFreePort();
    preferences = {
      general: {},
      mcp: {
        enabled: true,
        port,
        workspaces: [{ name: 'Discovery Only', path: path.join(root, 'not-yet-opened') }],
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
      createEventContext: (options) => createExecutionEventContext(options),
      emitEvent: () => {},
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
    lastOpenedWorkspaces.remove(workspacePath);
    snapshotManager.resetSnapshot();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('exposes a flat collection/request surface and omits Flow Studio and Intelligence tools', async () => {
    const client = await connect(manager.endpoint, token);
    try {
      const tools = (await client.listTools()).tools;
      const names = tools.map((tool) => tool.name);
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
      for (const name of [
        'bruno_get_request',
        'bruno_create_request',
        'bruno_update_request',
        'bruno_update_request_tab',
        'bruno_duplicate_request',
        'bruno_prepare_request',
        'bruno_run_request'
      ]) {
        expect(tools.find((tool) => tool.name === name).inputSchema.properties).toHaveProperty('showOnUi');
      }
      expect(tools.find((tool) => tool.name === 'bruno_delete_request').inputSchema.properties).not.toHaveProperty('showOnUi');

      const collections = parseToolText(await client.callTool({ name: 'bruno_list_collections', arguments: { workspace_uid: workspaceUid } }));
      expect(collections.collections).toEqual([expect.objectContaining({ name: 'MCP API', collection_path: 'collections/api' })]);
    } finally {
      await client.close();
    }
  });

  it('returns the complete request and edits name, vars, headers, body, and settings without redaction', async () => {
    const client = await connect(manager.endpoint, token);
    try {
      const reference = { workspace_uid: workspaceUid, collection_path: 'collections/api', item_pathname: 'users/get-users.bru' };
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
      const collectionReference = { workspace_uid: workspaceUid, collection_path: 'collections/api' };
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
      const reference = { workspace_uid: workspaceUid, collection_path: 'collections/api', item_pathname: 'users/get-users.bru' };
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
      expect(stored).not.toHaveProperty('showOnUi');
      expect(stored.result.response.body).toEqual({ access_token: 'raw-api-secret', visible: 'ok' });
      expect(stored.request.prepared_request.method).toBe('POST');
      expect(requestExecutionService.executeWithLegacy).toHaveBeenCalledWith(expect.objectContaining({ executionContext: expect.objectContaining({ source: 'mcp' }) }));

      const resource = await client.readResource({ uri: `bruno://request-run/${started.run_id}` });
      expect(JSON.parse(resource.contents[0].text).result.response.status).toBe(200);
    } finally {
      await client.close();
    }
  });

  it('opens a request on the UI only when its workspace is current', async () => {
    snapshotManager.saveSnapshot({ ...snapshotManager.getSnapshot(), activeWorkspacePath: workspacePath });
    const mainWindow = { isDestroyed: () => false, webContents: { send: jest.fn() } };
    manager.setMainWindow(mainWindow);

    const client = await connect(manager.endpoint, token);
    try {
      const reference = {
        workspace_uid: workspaceUid,
        collection_path: 'collections/api',
        item_pathname: 'users/get-users.bru',
        showOnUi: true
      };
      const result = parseToolText(await client.callTool({ name: 'bruno_get_request', arguments: reference }));

      expect(result.showOnUi).toEqual({ requested: true, available: true, status: 'requested' });
      expect(mainWindow.webContents.send).toHaveBeenCalledWith('main:mcp-show-request', expect.objectContaining({
        workspaceUid,
        pathname: path.join(collectionPath, 'users', 'get-users.bru')
      }));
      expect(snapshotManager.getSnapshot().activeWorkspacePath).toBe(workspacePath);
    } finally {
      await client.close();
    }
  });

  it('runs a request in a non-current workspace without switching and reports showOnUi unavailable', async () => {
    const otherWorkspacePath = path.join(root, 'other-request-workspace');
    const otherCollectionPath = path.join(otherWorkspacePath, 'collections', 'api');
    fs.mkdirSync(path.join(otherCollectionPath, 'users'), { recursive: true });
    fs.writeFileSync(path.join(otherCollectionPath, 'bruno.json'), JSON.stringify({ version: '1', name: 'Other API', type: 'collection' }, null, 2));
    fs.writeFileSync(path.join(otherCollectionPath, 'users', 'get-users.bru'), stringifyRequest(requestDefinition(), { format: 'bru' }));
    await writeWorkspaceConfig(otherWorkspacePath, createWorkspaceConfig('Other request workspace'));
    lastOpenedWorkspaces.add(otherWorkspacePath);
    const otherWorkspaceUid = getWorkspaceUid(otherWorkspacePath);
    snapshotManager.saveSnapshot({ ...snapshotManager.getSnapshot(), activeWorkspacePath: workspacePath });

    const mainWindow = { isDestroyed: () => false, webContents: { send: jest.fn() } };
    manager.setMainWindow(mainWindow);
    const client = await connect(manager.endpoint, token);
    try {
      const created = parseToolText(await client.callTool({
        name: 'bruno_create_request',
        arguments: {
          workspace_uid: otherWorkspaceUid,
          collection_path: 'collections/api',
          folder_path: 'users',
          name: 'Created in background',
          filename: 'created-in-background',
          method: 'GET',
          url: 'https://api.test/background',
          showOnUi: true
        }
      }));
      expect(created.showOnUi).toMatchObject({ available: false, reason: 'workspace_not_current' });

      const updated = parseToolText(await client.callTool({
        name: 'bruno_update_request',
        arguments: {
          workspace_uid: otherWorkspaceUid,
          collection_path: 'collections/api',
          item_pathname: 'users/created-in-background.bru',
          name: 'Updated in background',
          showOnUi: true
        }
      }));
      expect(updated.definition.name).toBe('Updated in background');
      expect(updated.showOnUi).toMatchObject({ available: false, reason: 'workspace_not_current' });

      const result = parseToolText(await client.callTool({
        name: 'bruno_run_request',
        arguments: {
          workspace_uid: otherWorkspaceUid,
          collection_path: 'collections/api',
          item_pathname: 'users/get-users.bru',
          showOnUi: true
        }
      }));

      expect(result.status).toBe('success');
      expect(result.showOnUi).toMatchObject({
        requested: true,
        available: false,
        status: 'unavailable',
        reason: 'workspace_not_current'
      });
      expect(result.showOnUi.message).toContain('handled in the background');
      expect(snapshotManager.getSnapshot().activeWorkspacePath).toBe(workspacePath);
      expect(mainWindow.webContents.send.mock.calls.some(([channel]) => channel === 'main:mcp-show-request')).toBe(false);
      expect(requestExecutionService.executeWithLegacy).toHaveBeenCalledWith(expect.objectContaining({
        workspaceContext: { uid: otherWorkspaceUid, pathname: otherWorkspacePath },
        executionContext: expect.objectContaining({ runInBackground: true })
      }));
    } finally {
      await client.close();
      lastOpenedWorkspaces.remove(otherWorkspacePath);
    }
  });

  it('requires bearer authentication and revokes the old token on rotation', async () => {
    await expect(connect(manager.endpoint, 'wrong-token')).rejects.toThrow();
    expect((await manager.rotateToken({ reveal: true })).token).toBe(rotatedToken);
    await expect(connect(manager.endpoint, token)).rejects.toThrow();
    const client = await connect(manager.endpoint, rotatedToken);
    await client.close();
  });

  it('records tool calls for the Connections viewer with source, latency, and a redacted request/response', async () => {
    const client = await connect(manager.endpoint, token);
    try {
      const reference = { workspace_uid: workspaceUid, collection_path: 'collections/api', item_pathname: 'users/get-users.bru' };
      await client.callTool({ name: 'bruno_get_request', arguments: reference });

      const events = manager.getConnectionEvents();
      const call = events.find((entry) => entry.tool === 'bruno_get_request');
      expect(call).toMatchObject({ tool: 'bruno_get_request', status: 'success', error: null });
      expect(call.source).toMatch(/^127\.0\.0\.1:\d+$/);
      expect(typeof call.durationMs).toBe('number');
      expect(call.request).toMatchObject(reference);
      expect(call.response.definition.request.auth.bearer.token).toBe('[REDACTED]');
    } finally {
      await client.close();
    }
  });

  it('reports a failed tool call in the Connections viewer without dropping the error', async () => {
    const client = await connect(manager.endpoint, token);
    try {
      await client.callTool({ name: 'bruno_get_request', arguments: { workspace_uid: workspaceUid, collection_path: 'collections/api', item_pathname: 'missing/does-not-exist.bru' } });
      const call = manager.getConnectionEvents().find((entry) => entry.tool === 'bruno_get_request' && entry.status === 'error');
      expect(call).toBeTruthy();
      expect(call.response).toBeNull();
      expect(call.error).toMatchObject({ code: expect.any(String) });
    } finally {
      await client.close();
    }
  });

  it('reports a restarting state while cycling the server', async () => {
    expect(manager.getStatus().state).toBe('running');
    const restartPromise = manager.restart();
    await Promise.resolve(); // let the queued restart begin running before asserting the transient state
    expect(manager.getStatus().state).toBe('restarting');
    const status = await restartPromise;
    expect(status.state).toBe('running');
  });

  it('lists the real managed workspaces, filterable by name, separately from the discovery list', async () => {
    const client = await connect(manager.endpoint, token);
    try {
      const workspaces = parseToolText(await client.callTool({ name: 'bruno_list_workspaces', arguments: {} }));
      expect(workspaces.workspaces).toEqual([{ uid: workspaceUid, name: 'MCP workspace', path: workspacePath, current: false }]);

      const filtered = parseToolText(await client.callTool({ name: 'bruno_list_workspaces', arguments: { name_ilike: 'nomatch' } }));
      expect(filtered.workspaces).toEqual([]);

      const discovery = parseToolText(await client.callTool({ name: 'bruno_list_discovery_workspaces', arguments: {} }));
      expect(discovery.discovery_workspaces).toEqual([expect.objectContaining({ name: 'Discovery Only' })]);
    } finally {
      await client.close();
    }
  });

  it('opens and switches to a workspace referenced by path even when it is not yet managed', async () => {
    const otherWorkspacePath = path.join(root, 'other-workspace');
    fs.mkdirSync(otherWorkspacePath, { recursive: true });
    await writeWorkspaceConfig(otherWorkspacePath, createWorkspaceConfig('Other workspace'));
    const otherWorkspaceUid = getWorkspaceUid(otherWorkspacePath);

    const client = await connect(manager.endpoint, token);
    try {
      const result = parseToolText(await client.callTool({ name: 'bruno_list_collections', arguments: { workspace_path: otherWorkspacePath } }));
      expect(result.workspace_uid).toBe(otherWorkspaceUid);

      const workspaces = parseToolText(await client.callTool({ name: 'bruno_list_workspaces', arguments: {} }));
      expect(workspaces.workspaces).toEqual(expect.arrayContaining([
        expect.objectContaining({ uid: workspaceUid, current: false }),
        expect.objectContaining({ uid: otherWorkspaceUid, name: 'Other workspace', path: otherWorkspacePath, current: true })
      ]));
    } finally {
      await client.close();
      lastOpenedWorkspaces.remove(otherWorkspacePath);
    }
  });

  it('registers a workspace via bruno_add_workspace without switching the active workspace', async () => {
    const addedWorkspacePath = path.join(root, 'added-workspace');
    fs.mkdirSync(addedWorkspacePath, { recursive: true });
    await writeWorkspaceConfig(addedWorkspacePath, createWorkspaceConfig('Added workspace'));

    const client = await connect(manager.endpoint, token);
    try {
      const added = parseToolText(await client.callTool({ name: 'bruno_add_workspace', arguments: { workspace_path: addedWorkspacePath } }));
      expect(added).toMatchObject({ name: 'Added workspace', path: addedWorkspacePath });

      const workspaces = parseToolText(await client.callTool({ name: 'bruno_list_workspaces', arguments: {} }));
      const addedEntry = workspaces.workspaces.find((entry) => entry.path === addedWorkspacePath);
      expect(addedEntry).toBeTruthy();
      expect(addedEntry.current).toBe(false);
    } finally {
      await client.close();
      lastOpenedWorkspaces.remove(addedWorkspacePath);
    }
  });

  it('scaffolds a brand-new workspace via bruno_create_workspace', async () => {
    const client = await connect(manager.endpoint, token);
    try {
      const created = parseToolText(await client.callTool({
        name: 'bruno_create_workspace',
        arguments: { name: 'Fresh Workspace', location: root, folder_name: 'fresh-workspace' }
      }));
      expect(created.name).toBe('Fresh Workspace');
      expect(fs.existsSync(path.join(created.path, 'workspace.yml'))).toBe(true);

      const workspaces = parseToolText(await client.callTool({ name: 'bruno_list_workspaces', arguments: {} }));
      expect(workspaces.workspaces.some((entry) => entry.path === created.path)).toBe(true);
    } finally {
      await client.close();
      lastOpenedWorkspaces.remove(path.join(root, 'fresh-workspace'));
    }
  });
});
