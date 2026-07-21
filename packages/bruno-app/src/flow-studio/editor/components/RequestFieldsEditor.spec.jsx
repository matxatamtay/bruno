import React, { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  addNode,
  createAuthoringFlow,
  createInputNode,
  createRequestNodeFromAsset
} from '../model';
import RequestFieldsEditor from './RequestFieldsEditor';

const requestAsset = {
  assetType: 'request',
  id: 'accounts:register',
  collectionUid: 'accounts',
  collectionName: 'Accounts',
  collectionPath: '.',
  itemUid: 'register',
  itemPathname: 'register.bru',
  name: 'Register',
  type: 'http-request',
  method: 'POST'
};

const shape = {
  pathParams: [{ name: 'tenantId', value: 'default-tenant' }],
  query: [{ name: 'locale', value: 'en' }],
  headers: [],
  bodyFields: [
    { key: '$', value: { email: 'request@example.test', role: 'member' } },
    { key: 'email', value: 'request@example.test' },
    { key: 'role', value: 'member' }
  ]
};

const createFixture = () => {
  let flow = createAuthoringFlow({ uid: 'flow_fields', name: 'Fields', workspaceUid: 'workspace_local' });
  const data = createInputNode(flow, 'dynamic-data', { x: 200, y: 250 }, {
    name: 'Account cases',
    options: [
      { id: 'happy', label: 'Happy path', value: { email: 'happy@example.test', role: 'admin' } },
      { id: 'invalid', label: 'Invalid email', value: { email: 'invalid', role: 'member' } }
    ],
    selectedOptionId: 'happy'
  });
  flow = addNode(flow, data);
  const request = createRequestNodeFromAsset(flow, requestAsset, { x: 500, y: 200 });
  flow = addNode(flow, request);
  return { flow, data, request };
};

const Harness = () => {
  const [fixture] = useState(createFixture);
  const [flow, setFlow] = useState(fixture.flow);
  const request = flow.nodes.find((node) => node.id === fixture.request.id);
  return (
    <>
      <RequestFieldsEditor flow={flow} node={request} shape={shape} onCommit={setFlow} />
      <pre data-testid="flow-state">{JSON.stringify(flow)}</pre>
    </>
  );
};

const readFlow = () => JSON.parse(screen.getByTestId('flow-state').textContent);

describe('RequestFieldsEditor', () => {
  it('shows canonical API fields and saves node-local literal overrides', () => {
    render(<Harness />);

    expect(screen.getByText('Path parameters')).toBeInTheDocument();
    expect(screen.getByText('Query parameters')).toBeInTheDocument();
    expect(screen.getByText('Body fields')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('body email source'), { target: { value: 'literal' } });
    fireEvent.change(screen.getByLabelText('body email value'), { target: { value: 'flow@example.test' } });
    fireEvent.blur(screen.getByLabelText('body email value'));

    const request = readFlow().nodes.find((node) => node.requestRef?.expectedItemUid === 'register');
    expect(request.config.requestOverrides.body.email).toBe('flow@example.test');
  });

  it('maps an entire dynamic data object into the request body root', () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText('body $ source'), { target: { value: 'node' } });

    const flow = readFlow();
    const request = flow.nodes.find((node) => node.requestRef?.expectedItemUid === 'register');
    const data = flow.nodes.find((node) => node.kind === 'dynamic-data');
    expect(request.config.bindings.body.$).toMatchObject({ sourceNodeId: data.id, sourcePath: 'value' });
    expect(flow.dataEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: { nodeId: data.id, path: 'value' },
        target: { nodeId: request.id, path: 'request.body.$' }
      })
    ]));
  });
});
