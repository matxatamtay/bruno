import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { FlowControlNode, FlowInputNode, FlowRequestNode } from './FlowNodes';

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

  it('renders dynamic data cases on the canvas and switches them without opening the inspector', () => {
    const onDynamicOptionSelect = jest.fn();
    render(
      <ReactFlowProvider>
        <FlowInputNode data={{
          entity: {
            id: 'data-cases', semanticKey: 'data_cases', name: 'Login cases', kind: 'dynamic-data',
            position: { x: 0, y: 0 },
            config: {
              options: [
                { id: 'happy', label: 'Happy path', value: { email: 'happy@example.test' } },
                { id: 'invalid', label: 'Invalid email', value: { email: 'invalid' } }
              ],
              selectedOptionId: 'happy'
            }
          },
          issueCount: 0,
          searchMatch: false,
          runtime: { status: 'idle' },
          onDynamicOptionSelect
        }}
        />
      </ReactFlowProvider>
    );

    expect(screen.getByRole('button', { name: 'Happy path' })).toHaveClass('active');
    fireEvent.click(screen.getByRole('button', { name: 'Invalid email' }));
    expect(onDynamicOptionSelect).toHaveBeenCalledWith('data-cases', 'invalid');
  });

  it('shows API fields and the selected dynamic case directly on a request node', () => {
    render(
      <ReactFlowProvider>
        <FlowRequestNode data={{
          entity: {
            id: 'request', semanticKey: 'register', name: 'Register', kind: 'http',
            position: { x: 0, y: 0 },
            requestRef: { collectionPath: '.', itemPathname: 'register.bru', expectedItemUid: 'register', expectedMethod: 'POST' },
            config: { bindings: { body: { email: { sourceNodeId: 'data-cases', sourcePath: 'value.email' } } } }
          },
          flow: {
            nodes: [{
              id: 'data-cases', kind: 'dynamic-data', name: 'Login cases',
              config: {
                options: [
                  { id: 'happy', label: 'Happy path', value: { email: 'happy@example.test' } },
                  { id: 'invalid', label: 'Invalid email', value: { email: 'invalid' } }
                ],
                selectedOptionId: 'invalid'
              }
            }]
          },
          requestShape: { pathParams: [], query: [], bodyFields: [{ key: 'email', value: 'request@example.test' }] },
          bindingCount: 1,
          issueCount: 0,
          searchMatch: false,
          runtime: { status: 'idle' }
        }}
        />
      </ReactFlowProvider>
    );

    expect(screen.getByText('email')).toBeInTheDocument();
    expect(screen.getByText('invalid')).toBeInTheDocument();
    expect(screen.getByText('Invalid email')).toBeInTheDocument();
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
