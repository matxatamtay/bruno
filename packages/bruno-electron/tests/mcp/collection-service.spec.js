const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BrunoCollectionService } = require('../../src/mcp/collection-service');

describe('BrunoCollectionService', () => {
  let root;
  let workspacePath;
  let service;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-mcp-collection-service-'));
    workspacePath = path.join(root, 'workspace');
    fs.mkdirSync(workspacePath, { recursive: true });
    service = new BrunoCollectionService({
      configProvider: () => ({
        workspaces: [{ uid: 'workspace_service', name: 'Service workspace', path: workspacePath }],
        maxRequestFiles: 1000
      })
    });
  });

  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('creates and edits every current collection and folder settings tab', async () => {
    const created = await service.createCollection({ workspace_uid: 'workspace_service', name: 'Accounts API', folder_name: 'accounts', format: 'bru' });
    expect(created).toMatchObject({ name: 'Accounts API', format: 'bru', collection_path: 'accounts' });

    const tabs = {
      'headers': [{ uid: 'header_accept', name: 'Accept', value: 'application/json', enabled: true }],
      'vars': { req: [{ uid: 'var_tenant', name: 'tenant', value: 'acme', enabled: true }], res: [] },
      'auth': { mode: 'bearer', bearer: { token: '{{token}}' } },
      'script': { req: 'bru.setVar("scope", "collection")', res: '' },
      'tests': 'test("collection", () => expect(true).to.equal(true));',
      'docs': '# Accounts API',
      'presets': { requestType: 'http', requestUrl: 'https://api.test' },
      'proxy': { disabled: false, config: { protocol: 'http', hostname: 'proxy.test', port: 8080 } },
      'client-certificates': { enabled: true, certs: [{ domain: 'api.test', type: 'cert', certFilePath: 'cert.pem', keyFilePath: 'key.pem' }] },
      'protobuf': { importPaths: [{ path: 'proto' }], protoFiles: [{ path: 'account.proto' }] }
    };
    for (const [tab, value] of Object.entries(tabs)) {
      await service.updateCollectionTab({ workspace_uid: 'workspace_service', collection_path: 'accounts', tab, value });
    }

    const collection = await service.getCollection({ workspace_uid: 'workspace_service', collection_path: 'accounts' });
    expect(collection.root.request.headers).toEqual([expect.objectContaining({ name: 'Accept', value: 'application/json', enabled: true })]);
    expect(collection.root.request.vars.req).toEqual([expect.objectContaining({ name: 'tenant', value: 'acme', enabled: true })]);
    expect(collection.root.request.auth).toMatchObject(tabs.auth);
    expect(collection.root.request.script.req).toBe(tabs.script.req);
    expect(collection.root.request.tests).toBe(tabs.tests);
    expect(collection.root.docs).toBe(tabs.docs);
    expect(collection.brunoConfig).toMatchObject({ presets: tabs.presets, proxy: expect.any(Object), clientCertificates: tabs['client-certificates'], protobuf: expect.any(Object) });

    await service.createFolder({ workspace_uid: 'workspace_service', collection_path: 'accounts', folder_name: 'users', name: 'Users' });
    await service.updateFolderTab({ workspace_uid: 'workspace_service', collection_path: 'accounts', folder_path: 'users', tab: 'headers', value: [{ name: 'X-Folder', value: 'users', enabled: true }] });
    await service.updateFolderTab({ workspace_uid: 'workspace_service', collection_path: 'accounts', folder_path: 'users', tab: 'vars', value: { req: [{ name: 'version', value: 'v1', enabled: true }], res: [] } });
    await service.updateFolderTab({ workspace_uid: 'workspace_service', collection_path: 'accounts', folder_path: 'users', tab: 'auth', value: { mode: 'inherit' } });
    await service.updateFolderTab({ workspace_uid: 'workspace_service', collection_path: 'accounts', folder_path: 'users', tab: 'script', value: { req: '', res: 'bru.setVar("folderDone", true)' } });
    await service.updateFolderTab({ workspace_uid: 'workspace_service', collection_path: 'accounts', folder_path: 'users', tab: 'tests', value: 'test("folder", () => expect(true).to.equal(true));' });
    await service.updateFolderTab({ workspace_uid: 'workspace_service', collection_path: 'accounts', folder_path: 'users', tab: 'docs', value: '# Users' });

    const folder = await service.getFolder({ workspace_uid: 'workspace_service', collection_path: 'accounts', folder_path: 'users' });
    expect(folder.definition.meta.name).toBe('Users');
    expect(folder.definition.request.headers).toEqual([expect.objectContaining({ name: 'X-Folder', value: 'users', enabled: true })]);
    expect(folder.definition.request.vars.req).toEqual([expect.objectContaining({ name: 'version', value: 'v1', enabled: true })]);
    expect(folder.definition.request.auth).toMatchObject({ mode: 'inherit' });
    expect(folder.definition.request.script.res).toBe('bru.setVar("folderDone", true)');
    expect(folder.definition.docs).toBe('# Users');
  });

  it('supports every request protocol and all current editable request tabs', async () => {
    await service.createCollection({ workspace_uid: 'workspace_service', name: 'Protocol API', folder_name: 'protocols' });
    const collection = { workspace_uid: 'workspace_service', collection_path: 'protocols' };
    const requests = [
      await service.createRequest({ ...collection, name: 'HTTP', filename: 'http', type: 'http', method: 'POST', url: 'https://api.test/http' }),
      await service.createRequest({ ...collection, name: 'GraphQL', filename: 'graphql', type: 'graphql', url: 'https://api.test/graphql' }),
      await service.createRequest({ ...collection, name: 'gRPC', filename: 'grpc', type: 'grpc', url: 'grpc://api.test:443' }),
      await service.createRequest({ ...collection, name: 'WebSocket', filename: 'ws', type: 'ws', url: 'wss://api.test/socket' }),
      await service.createRequest({ ...collection, name: 'SSE', filename: 'sse', type: 'sse', url: 'https://api.test/events' })
    ];
    expect(requests.map((request) => request.type)).toEqual(['http-request', 'graphql-request', 'grpc-request', 'ws-request', 'http-request']);

    const http = { ...collection, item_pathname: 'http.bru' };
    await service.updateRequestTab({ ...http, tab: 'params', value: [{ uid: 'page', name: 'page', value: '1', type: 'query', enabled: true }] });
    await service.updateRequestTab({ ...http, tab: 'body', value: { mode: 'json', json: '{"name":"Ada"}' } });
    await service.updateRequestTab({ ...http, tab: 'headers', value: [{ uid: 'content_type', name: 'Content-Type', value: 'application/json', enabled: true }] });
    await service.updateRequestTab({ ...http, tab: 'auth', value: { mode: 'apikey', apikey: { key: 'X-Key', value: '{{apiKey}}', placement: 'header' } } });
    await service.updateRequestTab({ ...http, tab: 'vars', value: { req: [{ uid: 'api_key', name: 'apiKey', value: 'dev', enabled: true, local: true }], res: [] } });
    await service.updateRequestTab({ ...http, tab: 'script', value: { req: 'bru.setVar("before", true)', res: '' } });
    await service.updateRequestTab({ ...http, tab: 'assert', value: [{ uid: 'status', name: 'res.status', value: 'eq 201', enabled: true }] });
    await service.updateRequestTab({ ...http, tab: 'tests', value: 'test("created", () => expect(res.status).to.equal(201));' });
    await service.updateRequestTab({ ...http, tab: 'docs', value: '# HTTP request' });
    await service.updateRequestTab({ ...http, tab: 'examples', value: [{ uid: 'example_1', name: 'Created', request: { url: 'https://api.test/http' }, response: { status: 201, body: { type: 'json', content: '{"id":"1"}' } } }] });
    await service.updateRequestTab({ ...http, tab: 'app', value: { language: 'javascript', code: 'console.log("app")' } });
    await service.updateRequestTab({ ...http, tab: 'settings', value: { name: 'HTTP edited', description: 'Edited through MCP', tags: ['crud'], seq: 9, settings: { timeout: 9000 } } });

    await service.updateRequestTab({ ...collection, item_pathname: 'graphql.bru', tab: 'query', value: { query: 'query Users { users { id } }', variables: '{"limit":10}' } });
    await service.updateRequestTab({ ...collection, item_pathname: 'grpc.bru', tab: 'message', value: [{ name: 'List', content: '{"limit":10}', selected: true }] });
    await service.updateRequestTab({ ...collection, item_pathname: 'grpc.bru', tab: 'metadata', value: [{ name: 'x-tenant', value: 'acme', enabled: true }] });
    await service.updateRequestTab({ ...collection, item_pathname: 'ws.bru', tab: 'message', value: [{ name: 'Subscribe', type: 'text', content: '{"topic":"users"}', selected: true }] });

    const updatedHttp = await service.getRequest(http);
    expect(updatedHttp.definition).toMatchObject({
      name: 'HTTP edited',
      tags: ['crud'],
      seq: 9,
      settings: { timeout: 9000 },
      request: {
        params: [{ name: 'page', value: '1' }],
        body: { mode: 'json' },
        auth: { mode: 'apikey' },
        docs: '# HTTP request'
      }
    });
    expect((await service.getRequest({ ...collection, item_pathname: 'graphql.bru' })).definition.request.body.graphql.query).toContain('query Users');
    expect((await service.getRequest({ ...collection, item_pathname: 'grpc.bru' })).definition.request.body.grpc[0].name).toBe('List');
    expect((await service.getRequest({ ...collection, item_pathname: 'ws.bru' })).definition.request.body.ws[0].name).toBe('Subscribe');
  });

  it('keeps OpenCollection request and environment UIDs stable across reads and searches', async () => {
    await service.createCollection({ workspace_uid: 'workspace_service', name: 'YAML API', folder_name: 'yaml-api', format: 'yml' });
    const collection = { workspace_uid: 'workspace_service', collection_path: 'yaml-api' };

    const createdRequest = await service.createRequest({
      ...collection,
      name: 'Get users',
      filename: 'get-users',
      method: 'GET',
      url: 'https://api.test/users'
    });
    const requestUid = createdRequest.uid;
    expect(createdRequest.definition.uid).toBe(requestUid);

    const requestByUid = await service.getRequest({ ...collection, request_uid: requestUid });
    const listedRequests = await service.listRequests(collection);
    const searchedRequests = await service.listRequests({ ...collection, query: 'get users' });
    expect(requestByUid).toMatchObject({ uid: requestUid, item_pathname: 'get-users.yml' });
    expect(requestByUid.definition.uid).toBe(requestUid);
    expect(listedRequests.requests).toEqual([expect.objectContaining({ uid: requestUid, item_pathname: 'get-users.yml' })]);
    expect(searchedRequests.requests).toEqual([expect.objectContaining({ uid: requestUid, item_pathname: 'get-users.yml' })]);

    const createdEnvironment = await service.createEnvironment({
      ...collection,
      name: 'Local',
      definition: { variables: [{ name: 'baseUrl', value: 'https://api.test', enabled: true, secret: false }] }
    });
    const environmentUid = createdEnvironment.environment.uid;
    expect(createdEnvironment.environment.definition.uid).toBe(environmentUid);

    const environmentByUid = await service.getEnvironment({ ...collection, environment_uid: environmentUid });
    const listedEnvironments = await service.listEnvironments(collection);
    expect(environmentByUid.environment).toMatchObject({ uid: environmentUid, filename: 'Local.yml' });
    expect(environmentByUid.environment.definition.uid).toBe(environmentUid);
    expect(listedEnvironments.environments).toEqual([expect.objectContaining({ uid: environmentUid, filename: 'Local.yml' })]);
  });

  it('clones, moves, resequences, searches, and removes collection data', async () => {
    await service.createCollection({ workspace_uid: 'workspace_service', name: 'Source API', folder_name: 'source' });
    await service.createFolder({ workspace_uid: 'workspace_service', collection_path: 'source', folder_name: 'users', name: 'Users' });
    await service.createRequest({ workspace_uid: 'workspace_service', collection_path: 'source', folder_path: 'users', name: 'Get user', filename: 'get-user', method: 'GET', url: 'https://api.test/users/1' });
    await service.resequenceItems({ workspace_uid: 'workspace_service', collection_path: 'source', items: [{ path: 'users', seq: 3 }, { path: 'users/get-user.bru', seq: 4 }] });
    expect((await service.getFolder({ workspace_uid: 'workspace_service', collection_path: 'source', folder_path: 'users' })).definition.meta.seq).toBe(3);
    expect((await service.getRequest({ workspace_uid: 'workspace_service', collection_path: 'source', item_pathname: 'users/get-user.bru' })).definition.seq).toBe(4);

    const cloned = await service.cloneCollection({ workspace_uid: 'workspace_service', collection_path: 'source', folder_name: 'cloned', name: 'Cloned API' });
    expect(cloned).toMatchObject({ name: 'Cloned API', collection_path: 'cloned' });
    const moved = await service.moveCollection({ workspace_uid: 'workspace_service', collection_path: 'cloned', folder_name: 'moved' });
    expect(moved.collection_path).toBe('moved');

    const found = await service.listRequests({ workspace_uid: 'workspace_service', query: 'get user' });
    expect(found.requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ collection_path: 'source', item_pathname: 'users/get-user.bru' }),
      expect.objectContaining({ collection_path: 'moved', item_pathname: 'users/get-user.bru' })
    ]));

    expect((await service.deleteCollection({ workspace_uid: 'workspace_service', collection_path: 'moved' })).deleted).toBe(true);
    expect((await service.listCollections({ workspace_uid: 'workspace_service' })).collections.map((collection) => collection.collection_path)).toEqual(['source']);
  });
});
