import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  addNode,
  createAuthoringFlow,
  createRequestNodeFromAsset,
  getFlowOutputDefinitions
} from '../model';
import FlowContractEditor from './FlowContractEditor';

const requestAsset = {
  assetType: 'request',
  id: 'accounts:sign-in',
  collectionUid: 'accounts',
  collectionName: 'Accounts',
  collectionPath: '.',
  itemUid: 'sign-in',
  itemPathname: 'auth/sign-in.bru',
  name: 'Sign in',
  type: 'http-request',
  method: 'POST'
};

const createFixture = () => {
  let flow = createAuthoringFlow({
    uid: 'flow_sign_in',
    name: 'Sign in',
    workspaceUid: 'workspace_local'
  });
  const request = createRequestNodeFromAsset(flow, requestAsset, { x: 280, y: 120 });
  flow = addNode(flow, request);
  const end = flow.nodes.find((node) => node.kind === 'end');
  return { flow, request, end };
};

describe('FlowContractEditor', () => {
  it('publishes an explicit End-node output contract', () => {
    const { flow, request, end } = createFixture();
    const onCommit = jest.fn();
    render(<FlowContractEditor flow={flow} node={end} onCommit={onCommit} />);

    fireEvent.change(screen.getByLabelText('Output name'), { target: { value: 'accessToken' } });
    fireEvent.change(screen.getByLabelText('Source node'), { target: { value: request.id } });
    fireEvent.change(screen.getByLabelText('Source path'), { target: { value: 'response.body.data.accessToken' } });
    fireEvent.click(screen.getByRole('button', { name: 'Publish output' }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(getFlowOutputDefinitions(onCommit.mock.calls[0][0])).toEqual([
      expect.objectContaining({
        name: 'accessToken',
        type: 'string',
        required: true,
        sourceNodeId: request.id,
        sourcePath: 'response.body.data.accessToken'
      })
    ]);
  });

  it('maps a parent value into a reusable subflow input', () => {
    const { flow, request } = createFixture();
    const subflow = {
      id: 'subflow_sign_in',
      semanticKey: 'subflow_sign_in',
      name: 'Reusable sign in',
      kind: 'subflow',
      position: { x: 520, y: 120 },
      config: { flowUid: 'child_sign_in' },
      policy: { sideEffect: 'none', resume: 'reuse' }
    };
    const nextFlow = addNode(flow, subflow);
    const onCommit = jest.fn();
    render(<FlowContractEditor flow={nextFlow} node={subflow} onCommit={onCommit} />);

    fireEvent.change(screen.getByLabelText('Input name'), { target: { value: 'token' } });
    fireEvent.change(screen.getByLabelText('Source node'), { target: { value: request.id } });
    fireEvent.change(screen.getByLabelText('Source path'), { target: { value: 'response.body.data.token' } });
    fireEvent.click(screen.getByRole('button', { name: 'Map subflow input' }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].dataEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: { nodeId: request.id, path: 'response.body.data.token' },
        target: { nodeId: subflow.id, path: 'subflow.input.token' }
      })
    ]));
  });
});
