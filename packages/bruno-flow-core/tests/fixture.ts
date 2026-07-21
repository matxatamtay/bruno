import { createFlowDefinition, type FlowDefinition } from '../src';

export const createFixtureFlow = (name = 'Checkout flow'): FlowDefinition => {
  const flow = createFlowDefinition({
    uid: 'flow_checkout',
    name,
    workspaceUid: 'workspace_local',
    now: new Date('2026-07-20T10:00:00.000Z')
  });

  return {
    ...flow,
    defaults: {
      timeoutMs: 120000,
      concurrency: 4,
      failureMode: 'fail-fast'
    },
    nodes: [
      {
        id: 'node_start',
        semanticKey: 'start',
        name: 'Start',
        kind: 'start',
        position: { x: 0, y: 0 },
        config: {}
      },
      {
        id: 'node_request',
        semanticKey: 'fetchUser',
        name: 'Fetch user',
        kind: 'http',
        position: { x: 240, y: 0 },
        requestRef: {
          collectionPath: './collections/users',
          itemPathname: 'users/get-user.bru',
          expectedMethod: 'GET'
        },
        config: {
          zeta: true,
          alpha: { second: 2, first: 1 }
        }
      },
      {
        id: 'node_end',
        semanticKey: 'end',
        name: 'End',
        kind: 'end',
        position: { x: 480, y: 0 },
        config: {}
      }
    ],
    controlEdges: [
      { id: 'edge_start_request', sourceNodeId: 'node_start', targetNodeId: 'node_request' },
      { id: 'edge_request_end', sourceNodeId: 'node_request', targetNodeId: 'node_end' }
    ],
    dataEdges: [],
    frames: [],
    metadata: {
      ...flow.metadata,
      tags: ['smoke', 'api']
    }
  };
};
