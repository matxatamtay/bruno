import { FlowGraphProjection } from './graph-projection';

const createLargeFlow = (count = 500) => {
  const nodes = Array.from({ length: count }, (_, index) => ({
    id: `node_${index}`,
    semanticKey: `request_${index}`,
    name: `Request ${index}`,
    kind: 'http',
    position: { x: (index % 25) * 220, y: Math.floor(index / 25) * 120 },
    requestRef: {
      collectionPath: `collections/${index % 2 ? 'billing' : 'accounts'}`,
      itemPathname: `request-${index}.bru`,
      expectedItemUid: `request_${index}`,
      expectedMethod: index % 2 ? 'POST' : 'GET'
    },
    config: {
      asset: {
        collectionName: index % 2 ? 'Billing' : 'Accounts',
        itemName: `Request ${index}`
      },
      bindings: { body: {}, query: {}, header: {} }
    }
  }));
  const controlEdges = nodes.slice(1).map((node, index) => ({
    id: `control_${index}`,
    sourceNodeId: nodes[index].id,
    targetNodeId: node.id
  }));
  return {
    schemaVersion: 1,
    uid: 'flow_large',
    name: 'Large flow',
    revision: 'rev:large',
    workspace: { uid: 'workspace_local' },
    defaults: {},
    nodes,
    controlEdges,
    dataEdges: [],
    frames: [],
    metadata: {
      createdAt: '2026-07-20T00:00:00.000Z',
      updatedAt: '2026-07-20T00:00:00.000Z'
    }
  };
};

const validation = { issues: [], mode: 'full', validatedEntityCount: 0 };

describe('FlowGraphProjection performance and cache', () => {
  it('projects a 500-node graph within the basic authoring budget', () => {
    const projection = new FlowGraphProjection();
    const result = projection.project(createLargeFlow(), validation);

    expect(result.nodes).toHaveLength(500);
    expect(result.edges).toHaveLength(499);
    expect(result.durationMs).toBeLessThan(250);
  });

  it('keeps 499 node projection references stable when one node changes', () => {
    const projection = new FlowGraphProjection();
    const flow = createLargeFlow();
    const first = projection.project(flow, validation);
    const nextFlow = {
      ...flow,
      nodes: flow.nodes.map((node, index) => index === 250 ? { ...node, name: 'Changed request' } : node)
    };
    const second = projection.project(nextFlow, validation);

    const changedReferences = second.nodes.filter((node, index) => node !== first.nodes[index]);
    expect(changedReferences).toHaveLength(1);
    expect(changedReferences[0].id).toBe('node_250');
    expect(second.edges.every((edge, index) => edge === first.edges[index])).toBe(true);
  });

  it('changes only runtime-addressed node and edge projections', () => {
    const projection = new FlowGraphProjection();
    const flow = createLargeFlow();
    const first = projection.project(flow, validation);
    const runtime = {
      nodes: { node_250: { status: 'running', sequence: 10 } },
      controlEdges: { control_10: { status: 'activated', sequence: 11 } },
      dataEdges: {}
    };
    const second = projection.project(flow, validation, '', runtime);

    expect(second.nodes.filter((node, index) => node !== first.nodes[index]).map((node) => node.id)).toEqual(['node_250']);
    expect(second.edges.filter((edge, index) => edge !== first.edges[index]).map((edge) => edge.id)).toEqual(['control_10']);
    expect(second.nodes.find((node) => node.id === 'node_250').data.runtime.status).toBe('running');
    expect(second.edges.find((edge) => edge.id === 'control_10').data.runtime.status).toBe('activated');
  });

  it('highlights only matching search nodes without mutating the flow domain', () => {
    const projection = new FlowGraphProjection();
    const flow = createLargeFlow(12);
    const result = projection.project(flow, validation, 'Request 7');

    expect(result.nodes.filter((node) => node.data.searchMatch).map((node) => node.id)).toEqual(['node_7']);
    expect(flow.nodes.some((node) => Object.hasOwn(node, 'selected'))).toBe(false);
  });
});
