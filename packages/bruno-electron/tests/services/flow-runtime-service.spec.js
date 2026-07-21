const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  FlowRuntimeService,
  findCatalogAsset,
  loadRequestAssetFromDisk
} = require('../../src/services/flow-runtime-service');

const createFlow = () => ({
  schemaVersion: 1,
  uid: 'flow_runtime_service',
  name: 'Runtime service',
  revision: 'rev:runtime-service',
  workspace: { uid: 'workspace_local' },
  defaults: {},
  nodes: [
    { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
    {
      id: 'env_secret', semanticKey: 'auth_token', kind: 'environment-input', position: { x: 0, y: 150 },
      config: { variable: 'AUTH_TOKEN', outputPath: 'value' }
    },
    {
      id: 'request_one', semanticKey: 'request_one', kind: 'http', position: { x: 200, y: 0 },
      requestRef: {
        collectionPath: 'collections/api', itemPathname: 'one.bru', expectedItemUid: 'request_one', expectedMethod: 'POST'
      },
      config: {}
    },
    { id: 'end', semanticKey: 'end', kind: 'end', position: { x: 400, y: 0 }, config: {} }
  ],
  controlEdges: [
    { id: 'control_start_request', sourceNodeId: 'start', targetNodeId: 'request_one' },
    { id: 'control_request_end', sourceNodeId: 'request_one', targetNodeId: 'end' }
  ],
  dataEdges: [
    {
      id: 'data_auth', source: { nodeId: 'env_secret', path: 'value' },
      target: { nodeId: 'request_one', path: 'request.header.Authorization' }, required: true
    }
  ],
  frames: [],
  metadata: { createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' }
});

const createCatalog = () => [{
  collectionPath: 'collections/api',
  itemPathname: 'one.bru',
  collection: { uid: 'collection_api', pathname: '/workspace/collections/api', items: [] },
  item: {
    uid: 'request_one', name: 'Request one', type: 'http-request', pathname: '/workspace/collections/api/one.bru',
    request: { method: 'POST', url: 'https://api.test/one', params: [], headers: [], body: { mode: 'json', json: '{}' } }
  }
}];

const headerValue = (item, name) => item.request.headers.find((header) => header.name === name)?.value;

describe('FlowRuntimeService', () => {
  let tempRoot;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-flow-runtime-'));
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it('resolves catalog assets by persisted request references', () => {
    const node = createFlow().nodes.find((candidate) => candidate.id === 'request_one');
    expect(findCatalogAsset(createCatalog(), node).item.uid).toBe('request_one');
    const restartedCatalog = createCatalog();
    restartedCatalog[0].item.uid = 'new_session_uid';
    expect(findCatalogAsset(restartedCatalog, node).item.uid).toBe('new_session_uid');
    expect(() => findCatalogAsset([], node)).toThrow('Request asset not found');
  });

  it('reloads the request from disk and rejects a symlink escape', async () => {
    const workspacePath = path.join(tempRoot, 'workspace');
    const collectionPath = path.join(workspacePath, 'collections', 'api');
    fs.mkdirSync(collectionPath, { recursive: true });
    fs.writeFileSync(path.join(collectionPath, 'bruno.json'), '{}');
    fs.writeFileSync(path.join(collectionPath, 'one.bru'), `meta {\n  name: disk-request\n  type: http\n  seq: 1\n}\n\npost {\n  url: https://disk.example.test/users\n  body: none\n  auth: none\n}\n`);
    const flow = createFlow();
    const node = flow.nodes.find((candidate) => candidate.id === 'request_one');
    const asset = createCatalog()[0];
    asset.collection.pathname = collectionPath;

    const loaded = await loadRequestAssetFromDisk(asset, node, { workspacePath });
    expect(loaded.item.request).toMatchObject({ method: 'POST', url: 'https://disk.example.test/users' });
    expect(loaded.item.pathname).toBe(path.join(collectionPath, 'one.bru'));

    const outsidePath = path.join(tempRoot, 'outside.bru');
    fs.writeFileSync(outsidePath, `meta {\n  name: outside\n  type: http\n  seq: 1\n}\n\nget {\n  url: https://outside.example.test\n  body: none\n  auth: none\n}\n`);
    fs.unlinkSync(path.join(collectionPath, 'one.bru'));
    fs.symlinkSync(outsidePath, path.join(collectionPath, 'one.bru'));

    await expect(loadRequestAssetFromDisk(asset, node, { workspacePath })).rejects.toThrow('symlink escapes collection');
  });

  it('delegates flow requests to RequestExecutionService and emits only safe projections', async () => {
    const sent = [];
    const executedItems = [];
    let id = 0;
    const requestExecutionService = {
      executeWithLegacy: jest.fn(async ({ item, executionContext }) => {
        executedItems.push(item);
        expect(executionContext).toMatchObject({ source: 'flow-runtime', flowUid: 'flow_runtime_service', nodeId: 'request_one' });
        return {
          result: {
            executionId: 'execution_one',
            status: 'success',
            request: { method: 'POST', headers: { Authorization: '[REDACTED]' } },
            response: { status: 200, body: { ok: true } }
          },
          legacyResult: { status: 200, data: { ok: true }, headers: {} }
        };
      })
    };
    const mainWindow = {
      isDestroyed: () => false,
      webContents: { send: jest.fn((channel, event) => sent.push({ channel, event })) }
    };
    const service = new FlowRuntimeService({
      requestExecutionService,
      mainWindow,
      idFactory: () => `id_${++id}`,
      now: () => new Date(1700000000000 + id),
      loadRequestAsset: async (asset) => asset
    });

    const result = await service.run({
      runId: 'run_service',
      flow: createFlow(),
      workspacePath: '/workspace',
      requestCatalog: createCatalog(),
      environmentValues: { AUTH_TOKEN: { value: 'Bearer electron-secret', secret: true } }
    });

    expect(result.status).toBe('success');
    expect(requestExecutionService.executeWithLegacy).toHaveBeenCalledTimes(1);
    expect(headerValue(executedItems[0], 'Authorization')).toBe('Bearer electron-secret');
    expect(sent.every((entry) => entry.channel === 'main:flow-runtime-event')).toBe(true);
    expect(JSON.stringify(sent)).not.toContain('electron-secret');
    expect(JSON.stringify(result)).not.toContain('electron-secret');
    expect(result.previews.request_one.headers.Authorization).toBe('[REDACTED]');
  });

  it('cancels an active scheduler through the shared AbortSignal', async () => {
    let adapterStarted;
    const started = new Promise((resolve) => { adapterStarted = resolve; });
    const requestExecutionService = {
      executeWithLegacy: jest.fn(({ signal }) => new Promise((resolve) => {
        adapterStarted();
        signal.addEventListener('abort', () => resolve({
          result: { status: 'cancelled', error: { code: 'REQUEST_CANCELLED' } },
          legacyResult: { isCancel: true, error: 'REQUEST_CANCELLED' }
        }), { once: true });
      }))
    };
    const service = new FlowRuntimeService({
      requestExecutionService,
      idFactory: () => 'event_cancel',
      loadRequestAsset: async (asset) => asset
    });
    const running = service.run({
      runId: 'run_cancel',
      flow: createFlow(),
      workspacePath: '/workspace',
      requestCatalog: createCatalog(),
      environmentValues: { AUTH_TOKEN: { value: 'secret', secret: true } }
    });

    await started;
    expect(service.cancel('run_cancel')).toEqual({ cancelled: true, runId: 'run_cancel' });
    await expect(running).resolves.toMatchObject({ status: 'cancelled', runId: 'run_cancel' });
    expect(service.cancel('missing')).toEqual({ cancelled: false, runId: 'missing' });
  });

  it('returns a safe preflight resolved request preview', async () => {
    const requestExecutionService = { executeWithLegacy: jest.fn() };
    const service = new FlowRuntimeService({ requestExecutionService, loadRequestAsset: async (asset) => asset });
    const result = await service.previewRequest({
      flow: createFlow(),
      nodeId: 'request_one',
      requestCatalog: createCatalog(),
      environmentValues: { AUTH_TOKEN: { value: 'Bearer preview-secret', secret: true } }
    });

    expect(result.preview.headers.Authorization).toBe('[REDACTED]');
    expect(JSON.stringify(result)).not.toContain('preview-secret');
    expect(result.bindings[0].provenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'environment', nodeId: 'env_secret' }),
      expect.objectContaining({ kind: 'binding', edgeId: 'data_auth' })
    ]));
  });

  it('persists a checkpoint and resumes without executing a once-only request twice', async () => {
    const flow = createFlow();
    flow.uid = 'flow_resume_service';
    flow.revision = 'rev:resume-service';
    flow.nodes.splice(flow.nodes.length - 1, 0, {
      id: 'checkpoint', semanticKey: 'checkpoint', kind: 'checkpoint', position: { x: 320, y: 0 }, config: { mode: 'pause' }
    });
    flow.controlEdges = [
      { id: 'control_start_request', sourceNodeId: 'start', targetNodeId: 'request_one' },
      { id: 'control_request_checkpoint', sourceNodeId: 'request_one', targetNodeId: 'checkpoint' },
      { id: 'control_checkpoint_end', sourceNodeId: 'checkpoint', targetNodeId: 'end' }
    ];
    const checkpoints = new Map();
    const checkpointStore = {
      save: jest.fn(async ({ checkpoint }) => {
        checkpoints.set(checkpoint.checkpointId, checkpoint);
        return { checkpointId: checkpoint.checkpointId };
      }),
      read: jest.fn(async ({ checkpointId }) => checkpoints.get(checkpointId)),
      list: jest.fn(),
      delete: jest.fn()
    };
    let id = 0;
    const requestExecutionService = {
      executeWithLegacy: jest.fn(async () => ({
        result: { executionId: 'execution_resume', status: 'success', response: { status: 200, body: { token: '[REDACTED]' } } },
        legacyResult: { status: 200, data: { token: 'raw-resume-secret' }, headers: {} }
      }))
    };
    const service = new FlowRuntimeService({
      requestExecutionService,
      checkpointStore,
      idFactory: () => `resume_id_${++id}`,
      loadRequestAsset: async (asset) => asset
    });
    const payload = {
      flow,
      workspacePath: '/workspace',
      requestCatalog: createCatalog(),
      environmentValues: { AUTH_TOKEN: { value: 'Bearer resume-secret', secret: true } }
    };

    const paused = await service.run({ ...payload, runId: 'run_pause_service' });
    expect(paused.status).toBe('paused');
    expect(requestExecutionService.executeWithLegacy).toHaveBeenCalledTimes(1);
    expect(checkpointStore.save).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(paused)).not.toContain('raw-resume-secret');

    const resumed = await service.resume({
      ...payload,
      runId: 'run_resume_service',
      checkpointId: paused.checkpointId
    });
    expect(resumed.status).toBe('success');
    expect(requestExecutionService.executeWithLegacy).toHaveBeenCalledTimes(1);
    expect(resumed.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'flow.node.reused', nodeId: 'request_one' })
    ]));

    const tamperedFlow = {
      ...flow,
      nodes: flow.nodes.map((node) => node.id === 'request_one'
        ? { ...node, policy: { sideEffect: 'once', resume: 'rerun', allowReplay: true } }
        : node)
    };
    await expect(service.resume({
      ...payload,
      flow: tamperedFlow,
      runId: 'run_tampered_resume',
      checkpointId: paused.checkpointId
    })).rejects.toThrow('does not match the current flow revision');
    expect(requestExecutionService.executeWithLegacy).toHaveBeenCalledTimes(1);
  });

  it('resolves subflows through FlowPersistenceService instead of renderer-provided child definitions', async () => {
    const child = {
      schemaVersion: 1,
      uid: 'flow_child_service',
      name: 'Child',
      revision: 'rev:child-service',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      nodes: [
        { id: 'child_start', semanticKey: 'child_start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'child_end', semanticKey: 'child_end', kind: 'end', position: { x: 200, y: 0 }, config: {} }
      ],
      controlEdges: [{ id: 'child_start_end', sourceNodeId: 'child_start', targetNodeId: 'child_end' }],
      dataEdges: [],
      frames: [],
      metadata: { createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' }
    };
    const parent = {
      ...child,
      uid: 'flow_parent_service',
      name: 'Parent',
      revision: 'rev:parent-service',
      nodes: [
        { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        {
          id: 'subflow', semanticKey: 'subflow', kind: 'subflow', position: { x: 200, y: 0 },
          config: { relativePath: 'child.flow.yml' }, policy: { sideEffect: 'none' }
        },
        { id: 'end', semanticKey: 'end', kind: 'end', position: { x: 400, y: 0 }, config: {} }
      ],
      controlEdges: [
        { id: 'start_subflow', sourceNodeId: 'start', targetNodeId: 'subflow' },
        { id: 'subflow_end', sourceNodeId: 'subflow', targetNodeId: 'end' }
      ]
    };
    const flowPersistenceService = {
      resolveFlowReference: jest.fn(async (reference) => {
        expect(reference).toMatchObject({ workspacePath: '/workspace', relativePath: 'child.flow.yml' });
        expect(reference).not.toHaveProperty('flow');
        return { flow: child };
      })
    };
    const service = new FlowRuntimeService({
      requestExecutionService: { executeWithLegacy: jest.fn() },
      flowPersistenceService,
      loadRequestAsset: async (asset) => asset
    });

    const result = await service.run({
      runId: 'run_subflow_service',
      flow: parent,
      workspacePath: '/workspace',
      requestCatalog: []
    });
    expect(result.status).toBe('success');
    expect(flowPersistenceService.resolveFlowReference).toHaveBeenCalledTimes(1);
    expect(result.events.some((event) => event.type === 'flow.subflow.event')).toBe(true);
  });

  it('does not resolve a cancelled parallel run until every request adapter has settled', async () => {
    const flow = {
      schemaVersion: 1,
      uid: 'flow_parallel_cancel_service',
      name: 'Parallel cancel',
      revision: 'rev:parallel-cancel-service',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      nodes: [
        { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        { id: 'fork', semanticKey: 'fork', kind: 'fork', position: { x: 120, y: 0 }, config: { joinNodeId: 'join' } },
        {
          id: 'request_one', semanticKey: 'request_one', kind: 'http', position: { x: 250, y: -80 },
          requestRef: { collectionPath: 'collections/api', itemPathname: 'one.bru' }, config: {}
        },
        {
          id: 'request_two', semanticKey: 'request_two', kind: 'http', position: { x: 250, y: 80 },
          requestRef: { collectionPath: 'collections/api', itemPathname: 'two.bru' }, config: {}
        },
        { id: 'join', semanticKey: 'join', kind: 'join', position: { x: 420, y: 0 }, config: { mode: 'all' } },
        { id: 'end', semanticKey: 'end', kind: 'end', position: { x: 580, y: 0 }, config: {} }
      ],
      controlEdges: [
        { id: 'start_fork', sourceNodeId: 'start', targetNodeId: 'fork' },
        { id: 'fork_one', sourceNodeId: 'fork', sourcePort: 'branch-0', targetNodeId: 'request_one' },
        { id: 'fork_two', sourceNodeId: 'fork', sourcePort: 'branch-1', targetNodeId: 'request_two' },
        { id: 'one_join', sourceNodeId: 'request_one', targetNodeId: 'join' },
        { id: 'two_join', sourceNodeId: 'request_two', targetNodeId: 'join' },
        { id: 'join_end', sourceNodeId: 'join', targetNodeId: 'end' }
      ],
      dataEdges: [],
      frames: [],
      metadata: { createdAt: '2026-07-20T00:00:00.000Z', updatedAt: '2026-07-20T00:00:00.000Z' }
    };
    const catalog = [
      ...createCatalog(),
      {
        ...createCatalog()[0],
        itemPathname: 'two.bru',
        item: { ...createCatalog()[0].item, uid: 'request_two', pathname: '/workspace/collections/api/two.bru' }
      }
    ];
    let active = 0;
    let started = 0;
    let releaseStarted;
    const allStarted = new Promise((resolve) => { releaseStarted = resolve; });
    const requestExecutionService = {
      executeWithLegacy: jest.fn(({ item, signal }) => new Promise((resolve) => {
        active += 1;
        started += 1;
        if (started === 2) releaseStarted();
        signal.addEventListener('abort', () => setTimeout(() => {
          active -= 1;
          resolve({
            result: { executionId: item.uid, status: 'cancelled' },
            legacyResult: { isCancel: true, error: 'REQUEST_CANCELLED' }
          });
        }, item.uid === 'request_one' ? 10 : 2), { once: true });
      }))
    };
    const service = new FlowRuntimeService({
      requestExecutionService,
      loadRequestAsset: async (asset) => asset
    });
    const running = service.run({
      runId: 'run_parallel_cancel_service',
      flow,
      workspacePath: '/workspace',
      requestCatalog: catalog
    });

    await allStarted;
    service.cancel('run_parallel_cancel_service');
    const result = await running;
    expect(result.status).toBe('cancelled');
    expect(active).toBe(0);
    expect(started).toBe(2);
  });
});
