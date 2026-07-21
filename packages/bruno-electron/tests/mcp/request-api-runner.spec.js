const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stringifyRequest } = require('@usebruno/filestore');
const { BrunoRequestContextResolver } = require('../../src/mcp/request-context-resolver');
const { BrunoMcpAutomationFacade } = require('../../src/mcp/automation-facade');

const write = (pathname, content) => {
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  fs.writeFileSync(pathname, content);
};

const getUserRequest = {
  uid: 'request_get_user',
  type: 'http-request',
  name: 'Get user',
  seq: 1,
  request: {
    method: 'GET',
    url: '{{base_url}}/{{version}}/users/{{user_id}}',
    params: [],
    headers: [{ uid: 'tenant_header', name: 'X-Tenant', value: '{{tenant}}', enabled: true }],
    auth: { mode: 'none' },
    body: { mode: 'none' },
    script: { req: '', res: '' },
    vars: { req: [], res: [] },
    assertions: [],
    tests: '',
    docs: ''
  },
  settings: {},
  examples: []
};

const createUserRequest = {
  ...getUserRequest,
  uid: 'request_create_user',
  name: 'Create user',
  seq: 2,
  request: {
    ...getUserRequest.request,
    method: 'POST',
    url: '{{base_url}}/{{version}}/users',
    body: { mode: 'json', json: '{"name":"Ada"}' }
  }
};

describe('Bruno MCP API runner', () => {
  let root;
  let workspacePath;
  let collectionPath;
  let config;
  let workspace;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-mcp-api-runner-'));
    workspacePath = path.join(root, 'workspace');
    collectionPath = path.join(workspacePath, 'collections', 'api');
    workspace = { uid: 'workspace_api', name: 'API workspace', path: workspacePath };
    config = { workspaces: [workspace], requestTimeoutMs: 10000, maxRequestFiles: 100 };

    write(path.join(collectionPath, 'bruno.json'), JSON.stringify({ version: '1', name: 'MCP API', type: 'collection' }));
    write(path.join(collectionPath, 'collection.bru'), 'vars:pre-request {\n  tenant: acme\n}\n');
    write(path.join(collectionPath, 'users', 'folder.bru'), 'meta {\n  name: Users\n}\n\nvars:pre-request {\n  version: v1\n}\n');
    write(path.join(collectionPath, 'users', 'get-user.bru'), stringifyRequest(getUserRequest, { format: 'bru' }));
    write(path.join(collectionPath, 'users', 'create-user.bru'), stringifyRequest(createUserRequest, { format: 'bru' }));
    write(path.join(collectionPath, 'environments', 'Local.bru'), 'vars {\n  base_url: https://api.test\n}\n');
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('resolves collection, folder, environment, and runtime variables with the normal Bruno resolver', async () => {
    const resolver = new BrunoRequestContextResolver();
    const context = await resolver.resolve({
      workspace,
      collectionPath: 'collections/api',
      itemPathname: 'users/get-user.bru',
      input: { environment_name: 'Local', runtime_variables: { user_id: 'usr_42' } }
    });

    expect(context.preparedRequest.url).toBe('https://api.test/v1/users/usr_42');
    expect(context.preparedRequest.headers['X-Tenant']).toBe('acme');
    expect(context.environment.name).toBe('Local');
    expect(context.unresolvedVariables).toEqual([]);
  });

  it('runs read and mutation methods directly, keeps complete results, and supports asynchronous retrieval', async () => {
    const requestExecutionService = {
      executeWithLegacy: jest.fn(async ({ item, environmentContext, runtimeVariables, executionContext }) => {
        await executionContext.requestGuard({ url: item.request.url, method: item.request.method });
        return {
          result: {
            executionId: executionContext.executionId,
            status: 'success',
            response: { status: item.request.method === 'POST' ? 201 : 200, body: { access_token: 'raw-response-secret', visible: 'ok' } },
            tests: [{ name: 'status', status: 'pass' }],
            assertions: []
          },
          legacyResult: { status: 200, data: { visible: 'ok' }, headers: {} },
          environmentContext,
          runtimeVariables
        };
      })
    };
    let id = 0;
    const facade = new BrunoMcpAutomationFacade({
      requestExecutionService,
      configProvider: () => config,
      idFactory: () => `run_${++id}`
    });

    const getResult = await facade.runRequest({
      workspace_uid: workspace.uid,
      collection_path: 'collections/api',
      item_pathname: 'users/get-user.bru',
      environment_name: 'Local',
      runtime_variables: { user_id: 'usr_42' }
    });
    expect(getResult.status).toBe('success');
    expect(getResult.result.response).toEqual({ status: 200, body: { access_token: 'raw-response-secret', visible: 'ok' } });
    expect(getResult.legacy_result).toEqual({ status: 200, data: { visible: 'ok' }, headers: {} });
    expect(getResult.request.prepared_request.url).toBe('https://api.test/v1/users/usr_42');

    const postResult = await facade.runRequest({
      workspace_uid: workspace.uid,
      collection_path: 'collections/api',
      item_pathname: 'users/create-user.bru',
      environment_name: 'Local'
    });
    expect(postResult.status).toBe('success');
    expect(postResult.result.response.status).toBe(201);

    const started = await facade.runRequest({
      workspace_uid: workspace.uid,
      collection_path: 'collections/api',
      item_pathname: 'users/create-user.bru',
      environment_name: 'Local',
      wait_mode: 'start'
    });
    expect(started.status).toBe('running');
    await facade.requestRuns.get(started.run_id).promise;
    expect(facade.getRequestRun({ run_id: started.run_id }).result.response.status).toBe(201);
    expect(requestExecutionService.executeWithLegacy).toHaveBeenCalledTimes(3);
  });
});
