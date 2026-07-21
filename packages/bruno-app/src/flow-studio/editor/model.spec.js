import { parseFlow, serializeFlow } from '@usebruno/flow-core';
import { buildEnvironmentRuntimeValues, buildFlowRequestCatalog, collectRequestAssets } from './assets';
import {
  addControlEdge,
  addNode,
  createAuthoringFlow,
  createControlNode,
  createInputNode,
  createRequestNodeFromAsset,
  deleteEntities,
  groupNodesInFrame,
  setNodeBinding,
  updateFormInputNode
} from './model';

const workspace = {
  uid: 'workspace_local',
  pathname: '/workspace',
  scratchCollectionUid: 'scratch',
  collections: [
    { uid: 'collection_a', path: '/workspace/collections/a' },
    { uid: 'collection_b', path: '/workspace/collections/b' }
  ]
};

const collections = [
  {
    uid: 'collection_a',
    name: 'Accounts',
    pathname: '/workspace/collections/a',
    items: [{
      uid: 'request_users',
      name: 'Create user',
      type: 'http-request',
      pathname: '/workspace/collections/a/users/create.bru',
      request: { method: 'POST', url: 'https://example.test/users' }
    }]
  },
  {
    uid: 'collection_b',
    name: 'Billing',
    pathname: '/workspace/collections/b',
    items: [{
      uid: 'folder_checkout',
      name: 'Checkout',
      items: [{
        uid: 'request_charge',
        name: 'Charge card',
        type: 'graphql-request',
        pathname: '/workspace/collections/b/checkout/charge.bru',
        request: { method: 'POST', url: 'https://example.test/graphql' }
      }]
    }]
  }
];

const createFlow = () => createAuthoringFlow({
  uid: 'flow_checkout',
  name: 'Checkout flow',
  workspaceUid: workspace.uid,
  now: new Date('2026-07-20T00:00:00.000Z')
});

describe('Flow Studio authoring model', () => {
  it('collects draggable requests from multiple workspace collections', () => {
    const assets = collectRequestAssets(workspace, collections);

    expect(assets).toHaveLength(2);
    expect(assets.map((asset) => asset.collectionName)).toEqual(['Accounts', 'Billing']);
    expect(assets[0]).toMatchObject({
      collectionPath: 'collections/a',
      itemPathname: 'users/create.bru',
      method: 'POST'
    });
    expect(assets[1]).toMatchObject({
      collectionPath: 'collections/b',
      itemPathname: 'checkout/charge.bru',
      breadcrumb: 'Checkout'
    });
  });

  it('builds execution catalog entries and secret-aware environment values from workspace collections', () => {
    const runtimeCollections = collections.map((collection, index) => ({
      ...collection,
      globalEnvironmentVariables: index === 0 ? { SHARED: 'global', PUBLIC: 'visible' } : {},
      globalEnvSecrets: index === 0 ? ['SHARED'] : [],
      activeEnvironmentUid: index === 0 ? 'env_local' : null,
      environments: index === 0 ? [{
        uid: 'env_local',
        variables: [
          { name: 'SHARED', value: 'environment', enabled: true, secret: true },
          { name: 'REGION', value: 'eu', enabled: true }
        ]
      }] : [],
      runtimeVariables: index === 0 ? { SHARED: 'runtime', REQUEST_TOKEN: 'runtime-secret' } : {}
    }));

    const catalog = buildFlowRequestCatalog(workspace, runtimeCollections);
    const environment = buildEnvironmentRuntimeValues(workspace, runtimeCollections);

    expect(catalog).toHaveLength(2);
    expect(catalog[0]).toMatchObject({
      collectionPath: 'collections/a',
      itemPathname: 'users/create.bru',
      item: { uid: 'request_users' },
      collection: { uid: 'collection_a' }
    });
    expect(environment).toMatchObject({
      SHARED: { value: 'runtime', secret: true },
      PUBLIC: { value: 'visible', secret: false },
      REGION: { value: 'eu', secret: false },
      REQUEST_TOKEN: { value: 'runtime-secret', secret: true }
    });
  });

  it('creates request and input nodes with body, query and header bindings', () => {
    const assets = collectRequestAssets(workspace, collections);
    let flow = createFlow();
    const input = createInputNode(flow, 'static-input', { x: 260, y: 120 }, {
      name: 'Customer context',
      value: '{"id":"cus_1"}',
      outputPath: 'customer'
    });
    flow = addNode(flow, input);
    const request = createRequestNodeFromAsset(flow, assets[0], { x: 480, y: 220 });
    flow = addNode(flow, request);

    flow = setNodeBinding(flow, {
      targetNodeId: request.id,
      channel: 'body',
      key: 'customer.id',
      sourceNodeId: input.id,
      sourcePath: 'customer.id',
      required: true
    });
    flow = setNodeBinding(flow, {
      targetNodeId: request.id,
      channel: 'query',
      key: 'expand',
      sourceNodeId: input.id,
      sourcePath: 'customer.expand'
    });
    flow = setNodeBinding(flow, {
      targetNodeId: request.id,
      channel: 'header',
      key: 'X-Customer-Id',
      sourceNodeId: input.id,
      sourcePath: 'customer.id'
    });

    const authoredRequest = flow.nodes.find((node) => node.id === request.id);
    expect(authoredRequest.config.bindings).toMatchObject({
      body: { 'customer.id': { sourceNodeId: input.id, sourcePath: 'customer.id', required: true } },
      query: { expand: { sourceNodeId: input.id, sourcePath: 'customer.expand', required: false } },
      header: { 'X-Customer-Id': { sourceNodeId: input.id, sourcePath: 'customer.id', required: false } }
    });
    expect(flow.dataEdges.map((edge) => edge.target.path).sort()).toEqual([
      'request.body.customer.id',
      'request.header.X-Customer-Id',
      'request.query.expand'
    ]);
  });

  it('keeps form input nodes and the persisted input schema in sync', () => {
    let flow = createFlow();
    const form = createInputNode(flow, 'form-input', { x: 200, y: 180 }, {
      name: 'Customer age', fieldName: 'age', inputType: 'integer', required: true, secret: true
    });
    flow = addNode(flow, form);

    expect(flow.inputSchema).toMatchObject({
      type: 'object',
      properties: { age: { type: 'integer', title: 'Customer age', writeOnly: true } },
      required: ['age']
    });

    flow = updateFormInputNode(flow, form.id, {
      fieldName: 'customerAge', inputType: 'number', required: false, name: 'Age', secret: false
    });
    expect(flow.inputSchema.properties.age).toBeUndefined();
    expect(flow.inputSchema.properties.customerAge).toMatchObject({ type: 'number', title: 'Age' });
    expect(flow.inputSchema.properties.customerAge.writeOnly).toBeUndefined();
    expect(flow.inputSchema.required).toEqual([]);

    flow = deleteEntities(flow, {
      nodeIds: [form.id], frameIds: [], controlEdgeIds: [], dataEdgeIds: []
    });
    expect(flow.inputSchema.properties.customerAge).toBeUndefined();
  });

  it('creates response extractor and merge nodes as data sources', () => {
    let flow = createFlow();
    const extractor = createInputNode(flow, 'response-extractor', { x: 200, y: 200 }, {
      name: 'Extract customer', sourceNodeId: 'request_create', path: 'customer', outputPath: 'value'
    });
    const merge = createInputNode(flow, 'merge', { x: 420, y: 200 }, {
      name: 'Merge context', strategy: 'first-write-wins', outputPath: 'context'
    });
    flow = addNode(addNode(flow, extractor), merge);

    expect(flow.nodes.find((node) => node.id === extractor.id)).toMatchObject({
      kind: 'response-extractor',
      config: { sourceNodeId: 'request_create', path: 'customer', outputPath: 'value' }
    });
    expect(flow.nodes.find((node) => node.id === merge.id)).toMatchObject({
      kind: 'merge',
      config: { strategy: 'first-write-wins', outputPath: 'context' }
    });
  });

  it('creates advanced control nodes and preserves explicit route ports', () => {
    let flow = createFlow();
    const join = createControlNode(flow, 'join', { x: 600, y: 180 }, { name: 'Wait for branches', mode: 'quorum', quorum: 2 });
    flow = addNode(flow, join);
    const fork = createControlNode(flow, 'fork', { x: 300, y: 180 }, { name: 'Parallel checks', joinNodeId: join.id });
    flow = addNode(flow, fork);
    const condition = createControlNode(flow, 'condition', { x: 180, y: 80 }, { expression: 'inputs.enabled === true' });
    flow = addNode(flow, condition);
    const subflow = createControlNode(flow, 'subflow', { x: 450, y: 320 }, {
      relativePath: 'child.flow.yml', datasetMode: 'for-each', maxItems: 12, concurrency: 3
    });
    flow = addNode(flow, subflow);
    const checkpoint = createControlNode(flow, 'checkpoint', { x: 760, y: 180 }, { mode: 'pause' });
    flow = addNode(flow, checkpoint);
    flow = addControlEdge(flow, { source: condition.id, target: fork.id, sourceHandle: 'true', targetHandle: 'control-in' });
    flow = addControlEdge(flow, { source: fork.id, target: subflow.id, sourceHandle: 'branch-0', targetHandle: 'control-in' });

    expect(flow.nodes.find((node) => node.id === fork.id).config.joinNodeId).toBe(join.id);
    expect(flow.nodes.find((node) => node.id === join.id).config).toMatchObject({ mode: 'quorum', quorum: 2 });
    expect(flow.nodes.find((node) => node.id === subflow.id)).toMatchObject({
      config: { relativePath: 'child.flow.yml', datasetMode: 'for-each', maxItems: 12, concurrency: 3 },
      policy: { sideEffect: 'once', resume: 'reuse' }
    });
    expect(flow.nodes.find((node) => node.id === checkpoint.id).config.mode).toBe('pause');
    expect(flow.controlEdges.map((edge) => edge.sourcePort)).toEqual(['true', 'branch-0']);
  });

  it('groups selected nodes into a persisted frame with relative positions', () => {
    let flow = createFlow();
    const input = createInputNode(flow, 'environment-input', { x: 300, y: 180 }, { name: 'API token' });
    flow = addNode(flow, input);
    const assets = collectRequestAssets(workspace, collections);
    const request = createRequestNodeFromAsset(flow, assets[1], { x: 560, y: 260 });
    flow = addNode(flow, request);

    const grouped = groupNodesInFrame(flow, [input.id, request.id]);
    const frame = grouped.frames[0];
    const groupedInput = grouped.nodes.find((node) => node.id === input.id);
    const groupedRequest = grouped.nodes.find((node) => node.id === request.id);

    expect(frame.size.width).toBeGreaterThanOrEqual(320);
    expect(groupedInput.frameId).toBe(frame.id);
    expect(groupedRequest.frameId).toBe(frame.id);
    expect(groupedInput.position.x).toBeGreaterThanOrEqual(0);
    expect(groupedRequest.position.y).toBeGreaterThanOrEqual(0);
  });

  it('removes a frame without leaving nodes or nested frames with dangling parents', () => {
    const flow = createFlow();
    const parent = {
      id: 'frame_parent',
      name: 'Parent',
      position: { x: 100, y: 100 },
      size: { width: 500, height: 320 },
      metadata: {}
    };
    const child = {
      id: 'frame_child',
      name: 'Child',
      parentFrameId: parent.id,
      position: { x: 40, y: 60 },
      size: { width: 260, height: 180 },
      metadata: {}
    };
    const framedNode = { ...flow.nodes[0], frameId: parent.id, position: { x: 50, y: 70 } };
    const framed = {
      ...flow,
      frames: [parent, child],
      nodes: [framedNode, ...flow.nodes.slice(1)]
    };

    const next = deleteEntities(framed, {
      nodeIds: [],
      frameIds: [parent.id],
      controlEdgeIds: [],
      dataEdgeIds: []
    });

    expect(next.nodes[0].frameId).toBeUndefined();
    expect(next.frames).toEqual([expect.objectContaining({ id: child.id, parentFrameId: undefined })]);
  });

  it('round-trips an authored graph so restart does not lose nodes, bindings or viewport', () => {
    const assets = collectRequestAssets(workspace, collections);
    let flow = createFlow();
    const input = createInputNode(flow, 'form-input', { x: 250, y: 150 }, { name: 'Email', fieldName: 'email' });
    flow = addNode(flow, input);
    const request = createRequestNodeFromAsset(flow, assets[0], { x: 500, y: 220 });
    flow = addNode(flow, request);
    flow = setNodeBinding(flow, {
      targetNodeId: request.id,
      channel: 'body',
      key: 'email',
      sourceNodeId: input.id,
      sourcePath: 'value'
    });
    flow = { ...flow, viewport: { x: -120, y: 40, zoom: 0.78 } };

    const restarted = parseFlow(serializeFlow(flow));

    expect(restarted.nodes).toHaveLength(flow.nodes.length);
    expect(restarted.dataEdges).toHaveLength(1);
    expect(restarted.viewport).toEqual({ x: -120, y: 40, zoom: 0.78 });
    expect(restarted.nodes.find((node) => node.id === request.id).config.bindings.body.email).toMatchObject({
      sourceNodeId: input.id,
      sourcePath: 'value'
    });
  });
});
