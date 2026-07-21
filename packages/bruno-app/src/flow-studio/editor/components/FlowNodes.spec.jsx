import React from 'react';
import { render } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { FlowControlNode, FlowRequestNode } from './FlowNodes';

const renderNode = (node, Component = FlowControlNode) => render(
  <ReactFlowProvider>
    <Component data={{ entity: node, issueCount: 0, searchMatch: false, runtime: { status: 'idle' } }} />
  </ReactFlowProvider>
);

describe('Phase 5 control handles', () => {
  it('renders explicit true and false condition routes', () => {
    const { container } = renderNode({
      id: 'condition', semanticKey: 'condition', name: 'Condition', kind: 'condition',
      position: { x: 0, y: 0 }, config: { expression: 'inputs.enabled === true' }
    });

    expect(container.querySelector('.flow-route-true')).toBeInTheDocument();
    expect(container.querySelector('.flow-route-false')).toBeInTheDocument();
  });

  it('renders a bounded number of deterministic fork branch handles', () => {
    const { container } = renderNode({
      id: 'fork', semanticKey: 'fork', name: 'Fork', kind: 'fork',
      position: { x: 0, y: 0 }, config: { joinNodeId: 'join', branchCount: 4 }
    });

    expect(container.querySelectorAll('.flow-route-handle')).toHaveLength(4);
  });

  it('exposes failure routes on request and fallible control nodes', () => {
    const request = renderNode({
      id: 'request', semanticKey: 'request', name: 'Request', kind: 'http',
      position: { x: 0, y: 0 },
      requestRef: { collectionPath: 'collections/api', itemPathname: 'one.bru', expectedMethod: 'POST' },
      config: { bindings: { body: {}, query: {}, header: {} } }
    }, FlowRequestNode);
    expect(request.container.querySelector('.flow-failure-handle')).toBeInTheDocument();
    request.unmount();

    const subflow = renderNode({
      id: 'subflow', semanticKey: 'subflow', name: 'Subflow', kind: 'subflow',
      position: { x: 0, y: 0 }, config: { relativePath: 'child.flow.yml' }
    });
    expect(subflow.container.querySelector('.flow-failure-handle')).toBeInTheDocument();
  });
});
