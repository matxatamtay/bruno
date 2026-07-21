import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  addNode,
  createAuthoringFlow,
  createControlNode,
  createInputNode,
  createRequestNodeFromAsset
} from '../model';
import Inspector from './Inspector';

const requestAsset = {
  collectionUid: 'accounts',
  collectionName: 'Accounts',
  collectionPath: '.',
  itemUid: 'update-user',
  itemPathname: 'users/update.bru',
  name: 'Update user',
  breadcrumb: 'Users',
  type: 'http-request',
  method: 'PATCH'
};

const createFixture = () => {
  let flow = createAuthoringFlow({
    uid: 'flow_inspector',
    name: 'Inspector flow',
    workspaceUid: 'workspace_local',
    now: new Date('2026-07-20T00:00:00.000Z')
  });
  const response = createInputNode(flow, 'response-extractor', { x: 260, y: 160 }, {
    name: 'Created customer id',
    sourceNodeId: 'create-user',
    sourcePath: 'response.body',
    path: 'customer.id',
    outputPath: 'value'
  });
  flow = addNode(flow, response);
  const request = createRequestNodeFromAsset(flow, requestAsset, { x: 520, y: 220 });
  flow = addNode(flow, request);
  return { flow, response, request };
};

const Harness = ({ initialFlow, requestId }) => {
  const [flow, setFlow] = useState(initialFlow);
  return (
    <>
      <Inspector
        flow={flow}
        selection={{ nodeIds: [requestId], frameIds: [], controlEdgeIds: [], dataEdgeIds: [] }}
        validation={{ issues: [] }}
        onCommit={(next) => setFlow(next)}
        requestAsset={requestAsset}
        environmentName="Local"
      />
      <pre data-testid="inspector-flow-state">{JSON.stringify(flow)}</pre>
    </>
  );
};

const readFlow = () => JSON.parse(screen.getByTestId('inspector-flow-state').textContent);

const addRuntimeBinding = (key) => {
  fireEvent.click(screen.getByRole('tab', { name: 'Input mapping' }));
  fireEvent.change(screen.getByPlaceholderText('Runtime variable, e.g. customerId'), { target: { value: key } });
  fireEvent.click(screen.getByRole('button', { name: 'Add mapping' }));
};

describe('Flow Studio inspector bindings', () => {
  it('shows the canonical request inline and authors runtime-variable mappings', () => {
    const fixture = createFixture();
    render(<Harness initialFlow={fixture.flow} requestId={fixture.request.id} />);

    expect(screen.getByText('Accounts')).toBeInTheDocument();
    expect(screen.getByText('Users / Update user')).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Request' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: /Open request in Bruno/i })).not.toBeInTheDocument();

    addRuntimeBinding('customerId');

    const flow = readFlow();
    const request = flow.nodes.find((node) => node.id === fixture.request.id);
    expect(request.config.bindings).toMatchObject({
      runtime: { customerId: { sourceNodeId: fixture.response.id, sourcePath: 'value' } }
    });
    expect(flow.dataEdges).toEqual([
      expect.objectContaining({
        source: { nodeId: fixture.response.id, path: 'value' },
        target: { nodeId: fixture.request.id, path: 'runtime.customerId' }
      })
    ]);
  });

  it('authors fork/join semantics and request side-effect policies', () => {
    const fixture = createFixture();
    let flow = fixture.flow;
    const join = createControlNode(flow, 'join', { x: 720, y: 160 }, { name: 'Join checks' });
    flow = addNode(flow, join);
    const fork = createControlNode(flow, 'fork', { x: 340, y: 160 }, { name: 'Fork checks' });
    flow = addNode(flow, fork);

    const forkMount = render(<Harness initialFlow={flow} requestId={fork.id} />);
    fireEvent.change(screen.getByLabelText('Join node'), { target: { value: join.id } });
    expect(readFlow().nodes.find((node) => node.id === fork.id).config.joinNodeId).toBe(join.id);
    forkMount.unmount();

    const joinMount = render(<Harness initialFlow={flow} requestId={join.id} />);
    fireEvent.change(screen.getByLabelText('Join mode'), { target: { value: 'quorum' } });
    fireEvent.change(screen.getByLabelText('Branch merge'), { target: { value: 'error-on-conflict' } });
    fireEvent.change(screen.getByLabelText('Quorum'), { target: { value: '2' } });
    fireEvent.blur(screen.getByLabelText('Quorum'));
    const editedJoin = readFlow().nodes.find((node) => node.id === join.id);
    expect(editedJoin.config).toMatchObject({ mode: 'quorum', quorum: 2, merge: 'error-on-conflict' });
    joinMount.unmount();

    render(<Harness initialFlow={flow} requestId={fixture.request.id} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Execution' }));
    fireEvent.change(screen.getByLabelText('Side effect'), { target: { value: 'idempotent' } });
    fireEvent.change(screen.getByLabelText('Resume behavior'), { target: { value: 'reuse' } });
    fireEvent.click(screen.getByLabelText('Allow retry'));
    fireEvent.change(screen.getByLabelText('Max attempts'), { target: { value: '3' } });
    fireEvent.blur(screen.getByLabelText('Max attempts'));
    expect(readFlow().nodes.find((node) => node.id === fixture.request.id).policy).toMatchObject({
      sideEffect: 'idempotent',
      resume: 'reuse',
      allowRetry: true,
      retry: { maxAttempts: 3 }
    });
  });

  it('removes a runtime-variable mapping and its data edge together', () => {
    const fixture = createFixture();
    render(<Harness initialFlow={fixture.flow} requestId={fixture.request.id} />);
    addRuntimeBinding('customerId');

    fireEvent.click(screen.getByTitle('Remove binding'));

    const flow = readFlow();
    const request = flow.nodes.find((node) => node.id === fixture.request.id);
    expect(request.config.bindings.runtime).toEqual({});
    expect(flow.dataEdges).toEqual([]);
  });
});
