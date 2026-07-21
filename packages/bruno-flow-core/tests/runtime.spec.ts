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
    collectionPath: 'collections/api',
    itemPathname: pathname,
    expectedItemUid: id,
    expectedMethod: 'POST'
  },
  config: {}
});

const createRuntimeFlow = (): FlowDefinition => ({
  schemaVersion: 1,
  uid: 'flow_phase4',
  name: 'Phase 4 runtime',
  revision: 'rev:phase4',
  workspace: { uid: 'workspace_local' },
  defaults: {},
  inputSchema: {
    type: 'object',
    properties: {
      email: { type: 'string', title: 'Customer email' },
      attempts: { type: 'integer', default: 2 }
    },
    required: ['email']
  },
  nodes: [
    { id: 'start', semanticKey: 'start', name: 'Start', kind: 'start', position: { x: 0, y: 100 }, config: {} },
    requestNode('request_create', 'create_user', 'create-user.bru', 250),
    requestNode('request_update', 'update_user', 'update-user.bru', 550),
    { id: 'end', semanticKey: 'end', name: 'End', kind: 'end', position: { x: 850, y: 100 }, config: {} },
    {
      id: 'form_email', semanticKey: 'customer_email', name: 'Customer email', kind: 'form-input',
      position: { x: 80, y: 300 }, config: { fieldName: 'email', inputType: 'string', required: true, outputPath: 'value' }
    },
    {
      id: 'static_trace', semanticKey: 'trace_id', name: 'Trace', kind: 'static-input',
      position: { x: 80, y: 400 }, config: { value: 'trace-42', outputPath: 'value' }
    },
    {
      id: 'env_auth', semanticKey: 'authorization', name: 'Authorization', kind: 'environment-input',
      position: { x: 80, y: 500 }, config: { variable: 'AUTH_TOKEN', outputPath: 'value' }
    },
    {
      id: 'static_context', semanticKey: 'static_context', name: 'Static context', kind: 'static-input',
      position: { x: 320, y: 400 }, config: { value: { region: 'eu' }, outputPath: 'value' }
    },
    {
      id: 'extract_user', semanticKey: 'extract_user', name: 'Extract user', kind: 'response-extractor',
      position: { x: 380, y: 300 }, config: {
        sourceNodeId: 'request_create', sourcePath: 'response.body', path: 'user', outputPath: 'value'
      }
    },
    {
      id: 'merge_context', semanticKey: 'merge_context', name: 'Merge context', kind: 'merge',
      position: { x: 520, y: 360 }, config: { strategy: 'last-write-wins', outputPath: 'value' }
    }
  ],
  controlEdges: [
    { id: 'control_start_create', sourceNodeId: 'start', targetNodeId: 'request_create' },
    { id: 'control_create_update', sourceNodeId: 'request_create', targetNodeId: 'request_update' },
    { id: 'control_update_end', sourceNodeId: 'request_update', targetNodeId: 'end' }
  ],
  dataEdges: [
    { id: 'data_email_body', source: { nodeId: 'form_email', path: 'value' }, target: { nodeId: 'request_create', path: 'request.body.customer.email' }, required: true },
    { id: 'data_trace_query', source: { nodeId: 'static_trace', path: 'value' }, target: { nodeId: 'request_create', path: 'request.query.trace' } },
    { id: 'data_auth_header_1', source: { nodeId: 'env_auth', path: 'value' }, target: { nodeId: 'request_create', path: 'request.header.Authorization' }, required: true },
    { id: 'data_response_extract', source: { nodeId: 'request_create', path: 'response.body' }, target: { nodeId: 'extract_user', path: 'input' }, required: true },
    { id: 'data_static_merge', source: { nodeId: 'static_context', path: 'value' }, target: { nodeId: 'merge_context', path: 'input.static' }, required: true },
    { id: 'data_user_merge', source: { nodeId: 'extract_user', path: 'value' }, target: { nodeId: 'merge_context', path: 'input.user' }, required: true },
    { id: 'data_user_query', source: { nodeId: 'extract_user', path: 'value.id' }, target: { nodeId: 'request_update', path: 'request.query.userId' }, required: true },
    { id: 'data_context_body', source: { nodeId: 'merge_context', path: 'value' }, target: { nodeId: 'request_update', path: 'request.body.context' }, required: true },
    { id: 'data_auth_header_2', source: { nodeId: 'env_auth', path: 'value' }, target: { nodeId: 'request_update', path: 'request.header.Authorization' }, required: true }
  ],
  frames: [],
  metadata: {
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z'
  }
});

const requestAsset = (uid: string, pathname: string) => ({
  collection: { uid: 'collection_api', pathname: '/workspace/collections/api', items: [] },
  item: {
    uid,
    name: uid,
    type: 'http-request',
    pathname,
    request: { method: 'POST', url: `https://api.test/${uid}`, params: [], headers: [], body: { mode: 'json', json: '{}' } }
  }
});

const listValue = (entries: unknown[], name: string): unknown => (entries as Record<string, unknown>[]).find((entry) => entry.name === name)?.value;

describe('Phase 4 data binding and sequential runtime', () => {
  it('validates the input-schema subset and applies defaults', () => {
    const resolved = resolveFlowInputs(createRuntimeFlow().inputSchema, { email: 'a@example.test' });
    expect(resolved.issues).toEqual([]);
    expect(resolved.values).toEqual({ email: 'a@example.test', attempts: 2 });

    expect(resolveFlowInputs(createRuntimeFlow().inputSchema, {}).issues).toEqual([
      expect.objectContaining({ path: '/email', keyword: 'required' })
    ]);
  });

  it('injects query, body and headers with provenance while keeping secret preview values redacted', () => {
    const flow = createRuntimeFlow();
    const node = flow.nodes.find((candidate) => candidate.id === 'request_create')!;
    const outputs: FlowRuntimeOutputs = new Map([
      ['form_email', { value: createRuntimeValue('a@example.test', { provenance: [{ kind: 'input', nodeId: 'form_email' }] }) }],
      ['static_trace', { value: createRuntimeValue('trace-42', { provenance: [{ kind: 'input', nodeId: 'static_trace' }] }) }],
      ['env_auth', { value: createRuntimeValue('Bearer super-secret', { secret: true, provenance: [{ kind: 'environment', nodeId: 'env_auth', path: 'AUTH_TOKEN' }] }) }]
    ]);
    const resolved = resolveRequestBindings({ flow, node, item: requestAsset('request_create', 'create-user.bru').item, outputs });
    const request = resolved.item.request as Record<string, unknown>;

    expect(listValue(request.params as unknown[], 'trace')).toBe('trace-42');
    expect(listValue(request.headers as unknown[], 'Authorization')).toBe('Bearer super-secret');
    expect(JSON.parse((request.body as Record<string, string>).json)).toEqual({ customer: { email: 'a@example.test' } });
    expect(resolved.preview.headers.Authorization).toBe(REDACTED_RUNTIME_VALUE);
    expect(JSON.stringify(resolved.preview)).not.toContain('super-secret');
    expect(resolved.preview.provenance['request.header.Authorization']).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'environment', nodeId: 'env_auth' }),
      expect.objectContaining({ kind: 'binding', edgeId: 'data_auth_header_1' })
    ]));
  });

  it('merges values deterministically and carries taint/provenance', () => {
    const merged = mergeRuntimeValues([
      createRuntimeValue({ region: 'us', visible: true }, { provenance: [{ kind: 'input', nodeId: 'a' }] }),
      createRuntimeValue({ region: 'eu', token: 'hidden' }, { secret: true, provenance: [{ kind: 'environment', nodeId: 'b' }] })
    ]);

    expect(merged.value).toEqual({ region: 'eu', visible: true, token: 'hidden' });
    expect(merged.secret).toBe(true);
    expect(merged.conflicts).toEqual(['region']);
    expect(merged.provenance).toHaveLength(2);
  });

  it('runs multiple requests end-to-end in sequence with extraction, merge, safe events and exact active edges', async () => {
    const flow = createRuntimeFlow();
    const assets = {
      request_create: requestAsset('request_create', 'create-user.bru'),
      request_update: requestAsset('request_update', 'update-user.bru')
    };
    const executed: Record<string, unknown>[] = [];
    let id = 0;
    let tick = Date.parse('2026-07-20T12:00:00.000Z');
    const scheduler = new SequentialFlowScheduler({
      idFactory: () => `event_${++id}`,
      now: () => new Date(tick += 10),
      resolveRequest: (node) => assets[node.id as keyof typeof assets],
      executeRequest: async ({ node, item }) => {
        executed.push(item);
        if (node.id === 'request_create') {
          return {
            result: { executionId: 'exec_1', status: 'success', response: { status: 200, body: { user: { id: 'user-7', plan: 'pro', token: '[REDACTED]' } } } },
            legacyResult: { status: 200, data: { user: { id: 'user-7', plan: 'pro', token: 'response-secret' } }, headers: {} }
          };
        }
        return {
          result: { executionId: 'exec_2', status: 'success', response: { status: 204, body: null } },
          legacyResult: { status: 204, data: null, headers: {} }
        };
      }
    });

    const result = await scheduler.run({
      flow,
      runId: 'run_phase4',
      inputs: { email: 'customer@example.test' },
      environmentValues: { AUTH_TOKEN: { value: 'Bearer never-project-me', secret: true } }
    });

    expect(result.status).toBe('success');
    expect(result.nodeOrder).toEqual(['start', 'request_create', 'request_update', 'end']);
    expect(executed).toHaveLength(2);

    const firstRequest = (executed[0] as Record<string, unknown>).request as Record<string, unknown>;
    expect(listValue(firstRequest.params as unknown[], 'trace')).toBe('trace-42');
    expect(listValue(firstRequest.headers as unknown[], 'Authorization')).toBe('Bearer never-project-me');
    expect(JSON.parse((firstRequest.body as Record<string, string>).json)).toEqual({ customer: { email: 'customer@example.test' } });

    const secondRequest = (executed[1] as Record<string, unknown>).request as Record<string, unknown>;
    expect(listValue(secondRequest.params as unknown[], 'userId')).toBe('user-7');
    expect(listValue(secondRequest.headers as unknown[], 'Authorization')).toBe('Bearer never-project-me');
    expect(JSON.parse((secondRequest.body as Record<string, string>).json)).toEqual({
      context: { region: 'eu', id: 'user-7', plan: 'pro', token: 'response-secret' }
    });

    const serializedSafeRun = JSON.stringify(result);
    expect(serializedSafeRun).not.toContain('never-project-me');
    expect(serializedSafeRun).not.toContain('response-secret');
    expect((result.outputs.env_auth.value as { value: unknown }).value).toBe(REDACTED_RUNTIME_VALUE);
    expect(result.previews.request_update.headers.Authorization).toBe(REDACTED_RUNTIME_VALUE);
    expect(result.previews.request_update.provenance['request.query.userId']).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'response', nodeId: 'request_create' }),
      expect.objectContaining({ kind: 'binding', edgeId: 'data_response_extract' }),
      expect.objectContaining({ kind: 'extractor', nodeId: 'extract_user' }),
      expect.objectContaining({ kind: 'binding', edgeId: 'data_user_query' })
    ]));

    const activatedControlEdges = result.events
      .filter((event) => event.type === 'flow.control-edge.activated')
      .map((event) => event.edgeId);
    expect(activatedControlEdges).toEqual([
      'control_start_create',
      'control_create_update',
      'control_update_end'
    ]);
    expect(result.events.filter((event) => event.type === 'flow.data-edge.resolved').map((event) => event.edgeId)).toEqual([
      'data_email_body',
      'data_trace_query',
      'data_auth_header_1',
      'data_response_extract',
      'data_static_merge',
      'data_user_merge',
      'data_user_query',
      'data_context_body',
      'data_auth_header_2'
    ]);
    expect(JSON.stringify(result.events)).not.toContain('never-project-me');
  });
});
