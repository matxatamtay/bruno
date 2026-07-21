const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrunoWorkspaceCatalog } = require('../../src/mcp/workspace-catalog');
const { BrunoRequestContextResolver } = require('../../src/mcp/request-context-resolver');
const { BrunoMcpAutomationFacade } = require('../../src/mcp/automation-facade');

const write = (pathname, content) => {
  fs.mkdirSync(path.dirname(pathname), { recursive: true });
  fs.writeFileSync(pathname, content);
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
    config = {
      allowedWorkspaces: [workspace],
      allowedHosts: ['api.test'],
      allowPrivateHosts: false,
      allowDynamicHosts: false,
      requestTimeoutMs: 10_000,
      maxRequestFiles: 100
    };

    write(path.join(collectionPath, 'opencollection.yml'), `opencollection: "1.0.0"
info:
  name: MCP API

request:
  variables:
    - name: tenant
      value: acme
`);
    write(path.join(collectionPath, 'users', 'folder.yml'), `info:
  name: Users
  type: folder

request:
  variables:
    - name: version
      value: v1
`);
    write(path.join(collectionPath, 'users', 'get-user.yml'), `info:
  name: Get user
  type: http
  seq: 1

http:
  method: GET
  url: "{{base_url}}/{{version}}/users/{{user_id}}"
  headers:
    - name: X-Tenant
      value: "{{tenant}}"
      enabled: true
`);
    write(path.join(collectionPath, 'users', 'create-user.yml'), `info:
  name: Create user
  type: http
  seq: 2

http:
  method: POST
  url: "{{base_url}}/{{version}}/users"
  body:
    mode: json
    json: |
      {"name":"Ada"}
`);
    write(path.join(collectionPath, 'environments', 'Local.yml'), `name: Local

variables:
  - name: base_url
    value: https://api.test
`);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('discovers YAML requests and resolves collection, folder, environment, and runtime variables', async () => {
    const catalog = new BrunoWorkspaceCatalog({ configProvider: () => config });
    const requests = await catalog.listRequests(workspace, { query: 'get user' });
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: 'Get user',
        method: 'GET',
        collection_path: 'collections/api',
        item_pathname: 'users/get-user.yml'
      })
    ]));

    const resolver = new BrunoRequestContextResolver();
    const context = await resolver.resolve({
      workspace,
      collectionPath: 'collections/api',
      itemPathname: 'users/get-user.yml',
      input: {
        environment_name: 'Local',
        runtime_variables: { user_id: 'usr_42' }
      }
    });

    expect(context.preparedRequest.url).toBe('https://api.test/v1/users/usr_42');
    expect(context.preparedRequest.headers['X-Tenant']).toBe('acme');
    expect(context.environment.name).toBe('Local');
    expect(context.unresolvedVariables).toEqual([]);
    expect(context.collection.items[0]).toEqual(expect.objectContaining({ type: 'folder', name: 'Users' }));
  });

  it('runs safe methods autonomously, returns structured results, and gates side-effect methods', async () => {
    const requestExecutionService = {
      executeWithLegacy: jest.fn(async ({ item, environmentContext, runtimeVariables, executionContext }) => {
        await executionContext.requestGuard({
          url: runtimeVariables.force_url || 'https://api.test/v1/users',
          method: runtimeVariables.force_method || item.request.method
        });
        return {
          result: {
            executionId: `exec_${item.uid}`,
            status: 'success',
            response: {
              status: 200,
              body: { access_token: 'raw-response-secret', visible: 'ok' }
            },
            tests: [{ name: 'status is 200', passed: true }],
            assertions: []
          },
          environmentContext,
          runtimeVariables
        };
      })
    };
    const facade = new BrunoMcpAutomationFacade({
      flowPersistenceService: {},
      flowRuntimeService: {},
      requestExecutionService,
      configProvider: () => config,
      idFactory: () => 'correlation_api'
    });

    const result = await facade.runRequest({
      workspace_uid: workspace.uid,
      collection_path: 'collections/api',
      item_pathname: 'users/get-user.yml',
      environment_name: 'Local',
      runtime_variables: { user_id: 'usr_42' }
    });

    expect(result.status).toBe('success');
    expect(result.response.status).toBe(200);
    expect(result.response.body.visible).toBe('ok');
    expect(result.response.body.access_token).toBe('[REDACTED]');
    expect(result.request_context).toMatchObject({
      method: 'GET',
      resolved_url: 'https://api.test/v1/users/usr_42',
      selected_environment: { name: 'Local' }
    });
    expect(requestExecutionService.executeWithLegacy).toHaveBeenCalledWith(expect.objectContaining({
      environmentContext: expect.objectContaining({ name: 'Local' }),
      runtimeVariables: { user_id: 'usr_42' },
      executionContext: expect.objectContaining({ source: 'mcp' })
    }));

    await expect(facade.runRequest({
      workspace_uid: workspace.uid,
      collection_path: 'collections/api',
      item_pathname: 'users/get-user.yml',
      environment_name: 'Local',
      runtime_variables: { user_id: 'usr_42', force_method: 'POST' }
    })).rejects.toMatchObject({ code: 'BRUNO_MCP_SIDE_EFFECT_APPROVAL_REQUIRED' });

    await expect(facade.runRequest({
      workspace_uid: workspace.uid,
      collection_path: 'collections/api',
      item_pathname: 'users/create-user.yml',
      environment_name: 'Local'
    })).rejects.toMatchObject({ code: 'BRUNO_MCP_SIDE_EFFECT_APPROVAL_REQUIRED' });

    const mutation = await facade.runRequest({
      workspace_uid: workspace.uid,
      collection_path: 'collections/api',
      item_pathname: 'users/create-user.yml',
      environment_name: 'Local',
      allow_side_effects: true
    });
    expect(mutation.request_context.method).toBe('POST');
    expect(requestExecutionService.executeWithLegacy).toHaveBeenCalledTimes(3);
  });
});
