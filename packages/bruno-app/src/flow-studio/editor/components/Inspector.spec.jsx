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

const createFixture = () => {
  let flow = createAuthoringFlow({
    uid: 'flow_inspector',
    name: 'Inspector flow',
    workspaceUid: 'workspace_local',
    now: new Date('2026-07-20T00:00:00.000Z')
  });
  const input = createInputNode(flow, 'static-input', { x: 260, y: 160 }, {
    name: 'Customer context',
    value: '{"id":"cus_1"}',
    outputPath: 'value'
  });
  flow = addNode(flow, input);
  const request = createRequestNodeFromAsset(flow, {
    collectionUid: 'accounts',
    collectionName: 'Accounts',
    collectionPath: 'collections/accounts',
    itemUid: 'create-user',
    itemPathname: 'users/create.bru',
    name: 'Create user',
    type: 'http-request',
    method: 'POST'
  }, { x: 520, y: 220 });
  flow = addNode(flow, request);
  return { flow, input, request };
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
      />
      <pre data-testid="inspector-flow-state">{JSON.stringify(flow)}</pre>
    </>
  );
};

const readFlow = () => JSON.parse(screen.getByTestId('inspector-flow-state').textContent);

const addBinding = ({ channel, key }) => {
  fireEvent.change(screen.getByDisplayValue(/body|query|header/), { target: { value: channel } });
  fireEvent.change(screen.getByPlaceholderText(channel === 'header' ? 'Authorization' : 'customerId'), { target: { value: key } });
  fireEvent.click(screen.getByRole('button', { name: 'Add binding' }));
};

describe('Flow Studio inspector bindings', () => {
  it('authors body, query and header bindings through inspector controls', () => {
    const fixture = createFixture();
    render(<Harness initialFlow={fixture.flow} requestId={fixture.request.id} />);

    addBinding({ channel: 'body', key: 'customer.id' });
    addBinding({ channel: 'query', key: 'expand' });
    addBinding({ channel: 'header', key: 'X-Customer-Id' });

    const flow = readFlow();
    const request = flow.nodes.find((node) => node.id === fixture.request.id);
    expect(request.config.bindings).toMatchObject({
      body: { 'customer.id': { sourceNodeId: fixture.input.id, sourcePath: 'value' } },
      query: { expand: { sourceNodeId: fixture.input.id, sourcePath: 'value' } },
      header: { 'X-Customer-Id': { sourceNodeId: fixture.input.id, sourcePath: 'value' } }
    });
    expect(flow.dataEdges.map((edge) => edge.target.path).sort()).toEqual([
      'request.body.customer.id',
      'request.header.X-Customer-Id',
      'request.query.expand'
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

  it('removes a binding and its data edge together', () => {
    const fixture = createFixture();
    render(<Harness initialFlow={fixture.flow} requestId={fixture.request.id} />);
    addBinding({ channel: 'body', key: 'email' });

    fireEvent.click(screen.getByTitle('Remove binding'));

    const flow = readFlow();
    const request = flow.nodes.find((node) => node.id === fixture.request.id);
    expect(request.config.bindings.body).toEqual({});
    expect(flow.dataEdges).toEqual([]);
  });
});
