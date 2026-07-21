import {
  REDACTED_RUNTIME_VALUE,
  SequentialFlowScheduler,
  createRuntimeValue,
  mergeRuntimeValues,
  resolveFlowInputs,
  resolveRequestBindings,
  type FlowDefinition,
  type FlowRuntimeOutputs
} from '../src';

const requestNode = (id: string, semanticKey: string, pathname: string, x: number) => ({
  id,
  semanticKey,
  name: semanticKey,
  kind: 'http' as const,
  position: { x, y: 100 },
  requestRef: {
    collectionPath: '.',
    itemPathname: pathname,
    expectedItemUid: id,
    expectedMethod: 'POST'
  },
  config: { bindings: { runtime: {} } }
});

const createRuntimeFlow = (): FlowDefinition => ({
  schemaVersion: 1,
  uid: 'flow_runtime_variables',
  name: 'Canonical Bruno request flow',
  revision: 'rev:runtime-variables',
  workspace: { uid: 'workspace_local' },
  defaults: {},
  inputSchema: {
    type: 'object',
    properties: {
      optionalLabel: { type: 'string', default: 'flow' }
    }
  },
  nodes: [
    { id: 'start', semanticKey: 'start', name: 'Start', kind: 'start', position: { x: 0, y: 100 }, config: {} },
    requestNode('request_create', 'create_user', 'create-user.bru', 250),
    {
      id: 'extract_user',
      semanticKey: 'extract_user',
      name: 'Created user',
      kind: 'response-extractor',
      position: { x: 430, y: 300 },
      config: {
        sourceNodeId: 'request_create',
        sourcePath: 'response.body',
        path: 'user',
        outputPath: 'value'
      }
    },
    requestNode('request_update', 'update_user', 'update-user.bru', 600),
    { id: 'end', semanticKey: 'end', name: 'End', kind: 'end', position: { x: 900, y: 100 }, config: {} }
  ],
  controlEdges: [
    { id: 'control_start_create', sourceNodeId: 'start', targetNodeId: 'request_create' },
    { id: 'control_create_update', sourceNodeId: 'request_create', targetNodeId: 'request_update' },
    { id: 'control_update_end', sourceNodeId: 'request_update', targetNodeId: 'end' }
  ],
  dataEdges: [
    {
      id: 'data_response_extract',
      source: { nodeId: 'request_create', path: 'response.body' },
      target: { nodeId: 'extract_user', path: 'input' },
      required: true
    },
    {
      id: 'data_user_id_runtime',
      source: { nodeId: 'extract_user', path: 'value.id' },
      target: { nodeId: 'request_update', path: 'runtime.userId' },
      required: true
    },
    {
      id: 'data_user_plan_runtime',
      source: { nodeId: 'extract_user', path: 'value.plan' },
      target: { nodeId: 'request_update', path: 'runtime.userPlan' },
      required: true
    }
  ],
  frames: [],
  metadata: {
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z'
  }
});

const requestAsset = (uid: string, pathname: string) => ({
  collection: {
    uid: 'collection_api',
    pathname: '/workspace/collections/api',
    activeEnvironmentUid: 'env_local',
    runtimeVariables: { baseUrl: 'https://api.test' }
  },
  item: {
    uid,
    name: uid,
    type: 'http-request',
    pathname,
    request: {
      method: 'POST',
      url: uid === 'request_update'
        ? '{{baseUrl}}/users/{{userId}}'
        : '{{baseUrl}}/users',
      params: uid === 'request_update'
        ? [{ name: 'plan', value: '{{userPlan}}', enabled: true }]
        : [],
      headers: [{ name: 'Authorization', value: '{{AUTH_TOKEN}}', enabled: true }],
      body: {
        mode: 'json',
        json: uid === 'request_update'
          ? '{"audit":"{{auditLabel}}"}'
          : '{"email":"{{email}}"}'
      }
    }
  }
});

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const listValue = (entries: unknown[], name: string): unknown => (
  (entries as Record<string, unknown>[]).find((entry) => entry.name === name)?.value
);

describe('Flow runtime variables and canonical Bruno requests', () => {
  it('keeps legacy form input schema validation available for existing flows', () => {
    const schema = {
      type: 'object',
      properties: {
        email: { type: 'string' },
        attempts: { type: 'integer', default: 2 }
      },
      required: ['email']
    };
    const resolved = resolveFlowInputs(schema, { email: 'a@example.test' });
    expect(resolved.issues).toEqual([]);
    expect(resolved.values).toEqual({ email: 'a@example.test', attempts: 2 });
    expect(resolveFlowInputs(schema, {}).issues).toEqual([
      expect.objectContaining({ path: '/email', keyword: 'required' })
    ]);
  });

  it('projects response data as Bruno runtime variables without mutating the request template', () => {
    const flow = createRuntimeFlow();
    const node = flow.nodes.find((candidate) => candidate.id === 'request_update')!;
    const asset = requestAsset('request_update', 'update-user.bru');
    const originalItem = clone(asset.item);
    const outputs: FlowRuntimeOutputs = new Map([
      ['extract_user', {
        value: createRuntimeValue({ id: 'user-7', plan: 'pro' }, {
          provenance: [
            { kind: 'response', nodeId: 'request_create', path: 'response.body.user' },
            { kind: 'extractor', nodeId: 'extract_user', sourceNodeId: 'request_create', path: 'user' }
          ]
        })
      }]
    ]);

    const resolved = resolveRequestBindings({ flow, node, item: asset.item, outputs });

    expect(resolved.item).toEqual(originalItem);
    expect(resolved.runtimeVariables).toEqual({ userId: 'user-7', userPlan: 'pro' });
    expect(resolved.preview.runtimeVariables).toEqual({ userId: 'user-7', userPlan: 'pro' });
    expect(resolved.preview.url).toBe('{{baseUrl}}/users/{{userId}}');
    expect(resolved.preview.query.plan).toBe('{{userPlan}}');
    expect(resolved.preview.provenance['runtime.userId']).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'response', nodeId: 'request_create' }),
      expect.objectContaining({ kind: 'extractor', nodeId: 'extract_user' }),
      expect.objectContaining({ kind: 'binding', edgeId: 'data_user_id_runtime' })
    ]));
  });

  it('redacts a secret runtime mapping while preserving its taint and provenance', () => {
    const flow = createRuntimeFlow();
    const node = flow.nodes.find((candidate) => candidate.id === 'request_update')!;
    flow.dataEdges.push({
      id: 'data_access_token_runtime',
      source: { nodeId: 'secret_output', path: 'value' },
      target: { nodeId: 'request_update', path: 'runtime.accessToken' },
      required: true
    });
    const outputs: FlowRuntimeOutputs = new Map([
      ['extract_user', { value: createRuntimeValue({ id: 'user-7', plan: 'pro' }) }],
      ['secret_output', {
        value: createRuntimeValue('very-secret', {
          secret: true,
          provenance: [{ kind: 'response', nodeId: 'request_create', path: 'response.body.token' }]
        })
      }]
    ]);

    const resolved = resolveRequestBindings({
      flow,
      node,
      item: requestAsset('request_update', 'update-user.bru').item,
      outputs
    });

    expect(resolved.runtimeVariables.accessToken).toBe('very-secret');
    expect(resolved.preview.runtimeVariables.accessToken).toBe(REDACTED_RUNTIME_VALUE);
    expect(JSON.stringify(resolved.preview)).not.toContain('very-secret');
    expect(resolved.preview.taint['runtime.accessToken']).toBe(true);
  });

  it('applies node-local path, query, header, body and runtime overrides without mutating the Bruno request', () => {
    const flow = createRuntimeFlow();
    const node = flow.nodes.find((candidate) => candidate.id === 'request_update')!;
    flow.dataEdges = [];
    node.config.requestOverrides = {
      path: { userId: 'flow-user' },
      query: { plan: 'enterprise' },
      header: { 'X-Flow-Mode': 'preview' },
      body: { audit: 'flow-audit' },
      runtime: { locale: 'vi' }
    };
    const asset = requestAsset('request_update', 'update-user.bru');
    (asset.item.request as Record<string, unknown>).params = [
      { name: 'userId', value: 'request-user', type: 'path', enabled: true },
      { name: 'plan', value: '{{userPlan}}', type: 'query', enabled: true }
    ];
    const original = clone(asset.item);

    const resolved = resolveRequestBindings({ flow, node, item: asset.item, outputs: new Map() });
    const request = resolved.item.request as Record<string, unknown>;
    const params = request.params as Record<string, unknown>[];

    expect(asset.item).toEqual(original);
    expect(params.find((entry) => entry.name === 'userId')).toMatchObject({ value: 'flow-user', type: 'path' });
    expect(params.find((entry) => entry.name === 'plan')).toMatchObject({ value: 'enterprise', type: 'query' });
    expect(listValue(request.headers as unknown[], 'X-Flow-Mode')).toBe('preview');
    expect(JSON.parse((request.body as Record<string, string>).json)).toEqual({ audit: 'flow-audit' });
    expect(resolved.runtimeVariables).toEqual({ locale: 'vi' });
    expect(resolved.preview.pathParams).toEqual({ userId: 'flow-user' });
    expect(resolved.preview.query).toEqual({ plan: 'enterprise' });
  });

  it('injects the selected dynamic data case as the complete request body', async () => {
    const rootPath = String.fromCharCode(36);
    const flow: FlowDefinition = {
      schemaVersion: 1,
      uid: 'flow_dynamic_body',
      name: 'Dynamic body',
      revision: 'rev:dynamic-body',
      workspace: { uid: 'workspace_local' },
      defaults: {},
      nodes: [
        { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
        {
          id: 'cases',
          semanticKey: 'cases',
          name: 'Register cases',
          kind: 'dynamic-data',
          position: { x: 200, y: 200 },
          config: {
            options: [
              { id: 'happy', label: 'Happy path', value: { email: 'happy@example.test', role: 'admin' } },
              { id: 'invalid', label: 'Invalid email', value: { email: 'invalid', role: 'member' } }
            ],
            selectedOptionId: 'invalid',
            outputPath: 'value'
          }
        },
        requestNode('request_register', 'register', 'register.bru', 400),
        { id: 'end', semanticKey: 'end', kind: 'end', position: { x: 700, y: 0 }, config: {} }
      ],
      controlEdges: [
        { id: 'start_request', sourceNodeId: 'start', targetNodeId: 'request_register' },
        { id: 'request_end', sourceNodeId: 'request_register', targetNodeId: 'end' }
      ],
      dataEdges: [{
        id: 'case_body',
        source: { nodeId: 'cases', path: 'value' },
        target: { nodeId: 'request_register', path: 'request.body.' + rootPath },
        required: true
      }],
      frames: [],
      metadata: {
        createdAt: '2026-07-20T00:00:00.000Z',
        updatedAt: '2026-07-20T00:00:00.000Z'
      }
    };
    let sentBody: unknown;
    const scheduler = new SequentialFlowScheduler({
      resolveRequest: () => ({
        collection: {},
        item: {
          uid: 'request_register',
          request: {
            method: 'POST',
            url: 'https://api.test/register',
            params: [],
            headers: [],
            body: { mode: 'json', json: '{}' }
          }
        }
      }),
      executeRequest: async ({ item }) => {
        sentBody = JSON.parse(((item.request as Record<string, unknown>).body as Record<string, string>).json);
        return {
          result: { executionId: 'exec_dynamic', status: 'success', response: { status: 200, body: {} } },
          legacyResult: { status: 200, data: {}, headers: {} }
        };
      }
    });

    const result = await scheduler.run({ flow, runId: 'run_dynamic_body' });

    expect(result.status).toBe('success');
    expect(sentBody).toEqual({ email: 'invalid', role: 'member' });
    expect(result.previews.request_register.body).toEqual({ email: 'invalid', role: 'member' });
  });

  it('keeps legacy direct request bindings readable for previously saved flows', () => {
    const flow = createRuntimeFlow();
    const node = flow.nodes.find((candidate) => candidate.id === 'request_update')!;
    flow.dataEdges = [{
      id: 'legacy_query_binding',
      source: { nodeId: 'legacy_value', path: 'value' },
      target: { nodeId: 'request_update', path: 'request.query.legacyId' },
      required: true
    }];
    const outputs: FlowRuntimeOutputs = new Map([
      ['legacy_value', { value: createRuntimeValue('legacy-42') }]
    ]);

    const resolved = resolveRequestBindings({
      flow,
      node,
      item: requestAsset('request_update', 'update-user.bru').item,
      outputs
    });

    expect(listValue((resolved.item.request as Record<string, unknown>).params as unknown[], 'legacyId')).toBe('legacy-42');
  });

  it('merges values deterministically and carries taint and provenance', () => {
    const merged = mergeRuntimeValues([
      createRuntimeValue({ region: 'us', visible: true }, { provenance: [{ kind: 'input', nodeId: 'a' }] }),
      createRuntimeValue({ region: 'eu', token: 'hidden' }, { secret: true, provenance: [{ kind: 'environment', nodeId: 'b' }] })
    ]);

    expect(merged.value).toEqual({ region: 'eu', visible: true, token: 'hidden' });
    expect(merged.secret).toBe(true);
    expect(merged.conflicts).toEqual(['region']);
    expect(merged.provenance).toHaveLength(2);
  });

  it('runs canonical requests in sequence and passes only mapped runtime variables to the next Bruno execution', async () => {
    const flow = createRuntimeFlow();
    const assets = {
      request_create: requestAsset('request_create', 'create-user.bru'),
      request_update: requestAsset('request_update', 'update-user.bru')
    };
    const executed: Array<{ nodeId: string; item: Record<string, unknown>; runtimeVariables: Record<string, unknown> }> = [];
    let id = 0;
    let tick = Date.parse('2026-07-20T12:00:00.000Z');
    const scheduler = new SequentialFlowScheduler({
      idFactory: () => `event_${++id}`,
      now: () => new Date(tick += 10),
      resolveRequest: (node) => assets[node.id as keyof typeof assets],
      executeRequest: async ({ node, item, runtimeVariables }) => {
        executed.push({ nodeId: node.id, item: clone(item), runtimeVariables: clone(runtimeVariables) });
        if (node.id === 'request_create') {
          return {
            result: {
              executionId: 'exec_1',
              status: 'success',
              response: { status: 200, body: { user: { id: 'user-7', plan: 'pro' } } }
            },
            legacyResult: {
              status: 200,
              data: { user: { id: 'user-7', plan: 'pro' } },
              headers: {}
            }
          };
        }
        return {
          result: { executionId: 'exec_2', status: 'success', response: { status: 204, body: null } },
          legacyResult: { status: 204, data: null, headers: {} }
        };
      }
    });

    const result = await scheduler.run({ flow, runId: 'run_runtime_variables' });

    expect(result.status).toBe('success');
    expect(result.nodeOrder).toEqual(['start', 'request_create', 'request_update', 'end']);
    expect(executed).toHaveLength(2);
    expect(executed[0].runtimeVariables).toEqual({});
    expect(executed[1].runtimeVariables).toEqual({ userId: 'user-7', userPlan: 'pro' });

    const updateRequest = executed[1].item.request as Record<string, unknown>;
    expect(updateRequest.url).toBe('{{baseUrl}}/users/{{userId}}');
    expect(listValue(updateRequest.params as unknown[], 'plan')).toBe('{{userPlan}}');
    expect(listValue(updateRequest.headers as unknown[], 'Authorization')).toBe('{{AUTH_TOKEN}}');
    expect(JSON.parse((updateRequest.body as Record<string, string>).json)).toEqual({ audit: '{{auditLabel}}' });

    expect(result.previews.request_update.runtimeVariables).toEqual({ userId: 'user-7', userPlan: 'pro' });
    expect(result.previews.request_update.provenance['runtime.userId']).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'response', nodeId: 'request_create' }),
      expect.objectContaining({ kind: 'binding', edgeId: 'data_response_extract' }),
      expect.objectContaining({ kind: 'extractor', nodeId: 'extract_user' }),
      expect.objectContaining({ kind: 'binding', edgeId: 'data_user_id_runtime' })
    ]));

    expect(result.events.filter((event) => event.type === 'flow.data-edge.resolved').map((event) => event.edgeId)).toEqual([
      'data_response_extract',
      'data_user_id_runtime',
      'data_user_plan_runtime'
    ]);
  });
});
