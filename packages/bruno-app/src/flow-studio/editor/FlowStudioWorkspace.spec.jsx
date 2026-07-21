import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { serializeFlowDocument } from '@usebruno/flow-core';
import flowCatalogReducer from 'providers/ReduxStore/slices/flow-catalog';
import { createAuthoringFlow } from './model';
import FlowStudioWorkspace from './FlowStudioWorkspace';

jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn()
}));

jest.mock('components/Environments/EnvironmentSelector', () => () => <div data-testid="mock-environment-selector">Local</div>);

jest.mock('./components/FlowCanvas', () => {
  const React = require('react');
  const {
    addNode,
    createInputNode,
    createRequestNodeFromAsset,
    setNodeBinding
  } = require('./model');

  return function MockFlowCanvas({ flow, onCommit, onSelectionChange, runtimeProjection }) {
    const authorGraph = () => {
      let next = flow;
      const createRequest = createRequestNodeFromAsset(next, {
        assetType: 'request',
        collectionUid: 'collection_accounts',
        collectionName: 'Accounts',
        collectionPath: '.',
        itemUid: 'request_create_user',
        itemPathname: 'users/create.bru',
        name: 'Create user',
        type: 'http-request',
        method: 'POST'
      }, { x: 300, y: 180 });
      next = addNode(next, createRequest);
      const response = createInputNode(next, 'response-extractor', { x: 500, y: 320 }, {
        name: 'Created user id',
        sourceNodeId: createRequest.id,
        sourcePath: 'response.body',
        path: 'user.id',
        outputPath: 'value'
      });
      next = addNode(next, response);
      const updateRequest = createRequestNodeFromAsset(next, {
        assetType: 'request',
        collectionUid: 'collection_accounts',
        collectionName: 'Accounts',
        collectionPath: '.',
        itemUid: 'request_update_user',
        itemPathname: 'users/update.bru',
        name: 'Update user',
        type: 'http-request',
        method: 'PATCH'
      }, { x: 700, y: 180 });
      next = addNode(next, updateRequest);
      next = setNodeBinding(next, {
        targetNodeId: updateRequest.id,
        channel: 'runtime',
        key: 'userId',
        sourceNodeId: response.id,
        sourcePath: 'value'
      });
      onCommit(next, {
        topology: true,
        nodeIds: [createRequest.id, response.id, updateRequest.id],
        dataEdgeIds: next.dataEdges.map((edge) => edge.id)
      });
    };

    return (
      <div data-testid="mock-flow-canvas">
        <span data-testid="mock-flow-node-count">{flow.nodes.length}</span>
        <span data-testid="mock-flow-data-edge-count">{flow.dataEdges.length}</span>
        <span data-testid="mock-flow-runtime-status">{runtimeProjection?.status || 'idle'}</span>
        <span data-testid="mock-flow-active-control-count">{Object.keys(runtimeProjection?.controlEdges || {}).length}</span>
        <span data-testid="mock-flow-active-data-count">{Object.keys(runtimeProjection?.dataEdges || {}).length}</span>
        <button type="button" onClick={authorGraph}>Author graph</button>
        <button
          type="button"
          onClick={() => {
            const request = flow.nodes.find((node) => node.kind === 'http');
            if (request) onSelectionChange({ nodeIds: [request.id], frameIds: [], controlEdgeIds: [], dataEdgeIds: [] });
          }}
        >Select request
        </button>
      </div>
    );
  };
});

const workspace = {
  uid: 'workspace_local',
  pathname: '/workspace',
  scratchCollectionUid: 'scratch',
  collections: [{ uid: 'collection_accounts', path: '/workspace/collections/accounts' }]
};

const loadedCollections = [{
  uid: 'collection_accounts',
  name: 'Accounts',
  pathname: '/workspace/collections/accounts',
  activeEnvironmentUid: 'env_local',
  environments: [{ uid: 'env_local', name: 'Local', variables: [] }],
  runtimeVariables: {},
  items: [{
    uid: 'request_create_user',
    name: 'Create user',
    type: 'http-request',
    pathname: '/workspace/collections/accounts/users/create.bru',
    request: { method: 'POST', url: 'https://example.test/users' }
  }, {
    uid: 'request_update_user',
    name: 'Update user',
    type: 'http-request',
    pathname: '/workspace/collections/accounts/users/update.bru',
    request: { method: 'PATCH', url: 'https://example.test/users/{{userId}}' }
  }]
}];

const createStore = () => configureStore({
  reducer: {
    flowCatalog: flowCatalogReducer,
    collections: (state = { collections: loadedCollections }) => state,
    globalEnvironments: (state = { globalEnvironments: [], activeGlobalEnvironmentUid: null }) => state,
    tabs: (state = { tabs: [], activeTabUid: null }) => state
  }
});

const toRecord = (relativePath, input) => {
  const serialized = serializeFlowDocument(input);
  return {
    relativePath,
    pathname: `/workspace/collections/accounts/flows/${relativePath}`,
    content: serialized.content,
    flow: serialized.flow,
    storedRevision: serialized.flow.revision,
    revisionMismatch: false
  };
};

const toCatalogEntry = (record) => ({
  uid: record.flow.uid,
  name: record.flow.name,
  relativePath: record.relativePath,
  pathname: record.pathname,
  revision: record.flow.revision,
  updatedAt: record.flow.metadata.updatedAt,
  tags: record.flow.metadata.tags || [],
  status: 'valid'
});

const renderWorkspace = (store) => render(
  <Provider store={store}>
    <FlowStudioWorkspace workspace={workspace} collection={loadedCollections[0]} />
  </Provider>
);

describe('Flow Studio workspace UI', () => {
  let storedRecord;
  let runtimeListener;
  let runtimeMode;
  let checkpointRecords;

  beforeEach(() => {
    storedRecord = null;
    runtimeListener = null;
    runtimeMode = 'success';
    checkpointRecords = [];
    window.ipcRenderer = {
      on: jest.fn((channel, listener) => {
        if (channel === 'main:flow-runtime-event') runtimeListener = listener;
        return () => { if (runtimeListener === listener) runtimeListener = null; };
      }),
      invoke: jest.fn(async (channel, payload = {}) => {
        if (channel === 'renderer:flow-catalog-open') {
          return { ok: true, data: storedRecord ? [toCatalogEntry(storedRecord)] : [] };
        }
        if (channel === 'renderer:flow-draft-list') return { ok: true, data: [] };
        if (channel === 'renderer:flow-checkpoint-list') return { ok: true, data: checkpointRecords };
        if (channel === 'renderer:flow-checkpoint-delete') {
          checkpointRecords = checkpointRecords.filter((checkpoint) => checkpoint.checkpointId !== payload.checkpointId);
          return { ok: true, data: { checkpointId: payload.checkpointId } };
        }
        if (channel === 'renderer:flow-create') {
          storedRecord = toRecord(payload.relativePath, payload.flow);
          return { ok: true, data: storedRecord };
        }
        if (channel === 'renderer:flow-save') {
          if (storedRecord && payload.expectedRevision !== storedRecord.flow.revision) {
            return {
              ok: false,
              error: {
                code: 'FLOW_REVISION_CONFLICT',
                message: 'conflict',
                pathname: storedRecord.pathname,
                expectedRevision: payload.expectedRevision,
                actualRevision: storedRecord.flow.revision
              }
            };
          }
          storedRecord = toRecord(payload.relativePath, payload.flow);
          return { ok: true, data: storedRecord };
        }
        if (channel === 'renderer:flow-read') return { ok: true, data: storedRecord };
        if (channel === 'renderer:flow-draft-save') {
          return {
            ok: true,
            data: {
              draftUid: payload.flowUid,
              flowUid: payload.flowUid,
              relativePath: payload.relativePath,
              baseRevision: payload.baseRevision,
              savedAt: '2026-07-20T10:00:00.000Z',
              flow: payload.flow
            }
          };
        }
        if (channel === 'renderer:flow-draft-discard') return { ok: true, data: { draftUid: payload.draftUid } };
        if (channel === 'renderer:flow-preview-request') {
          return {
            ok: true,
            data: {
              nodeId: payload.nodeId,
              preview: {
                method: 'POST',
                url: 'https://example.test/users',
                query: { trace: '42' },
                headers: { Authorization: '[REDACTED]' },
                body: { email: '{{email}}' },
                runtimeVariables: { userId: 'user-7' },
                provenance: { 'runtime.userId': [{ kind: 'response', nodeId: 'request_create_user' }] }
              },
              bindings: []
            }
          };
        }
        if (channel === 'renderer:flow-run') {
          const base = {
            schemaVersion: 1,
            timestamp: '2026-07-20T10:00:00.000Z',
            source: 'flow-runtime',
            runId: payload.runId,
            flowUid: payload.flow.uid,
            payload: {}
          };
          if (runtimeMode === 'paused') {
            checkpointRecords = [{
              checkpointId: 'checkpoint_ui',
              flowUid: payload.flow.uid,
              nodeId: 'checkpoint_node',
              journalEntries: 3,
              status: 'valid'
            }];
            [
              { eventId: 'run-started', sequence: 1, type: 'flow.run.started' },
              { eventId: 'checkpoint-saved', sequence: 2, type: 'flow.checkpoint.saved', nodeId: 'checkpoint_node', payload: { checkpointId: 'checkpoint_ui' } },
              { eventId: 'run-paused', sequence: 3, type: 'flow.run.paused', payload: { status: 'paused', checkpointId: 'checkpoint_ui' } }
            ].forEach((event) => runtimeListener?.({ ...base, ...event, payload: event.payload || {} }));
            return { ok: true, data: { runId: payload.runId, flowUid: payload.flow.uid, status: 'paused', checkpointId: 'checkpoint_ui', events: [] } };
          }
          if (runtimeMode === 'failed') {
            const requestNodeId = payload.flow.nodes.find((node) => node.kind === 'http').id;
            [
              { eventId: 'failed-run-started', sequence: 1, type: 'flow.run.started' },
              { eventId: 'failed-node-started', sequence: 2, type: 'flow.node.started', nodeId: requestNodeId },
              { eventId: 'failed-node', sequence: 3, type: 'flow.node.failed', nodeId: requestNodeId, payload: { status: 'failed', message: 'getaddrinfo ENOTFOUND api.invalid.test' } },
              { eventId: 'failed-run', sequence: 4, type: 'flow.run.failed', payload: { status: 'failed', message: 'getaddrinfo ENOTFOUND api.invalid.test', nodeId: requestNodeId } }
            ].forEach((event) => runtimeListener?.({ ...base, ...event, payload: event.payload || {} }));
            return {
              ok: true,
              data: {
                runId: payload.runId,
                flowUid: payload.flow.uid,
                status: 'failed',
                events: [],
                error: { message: 'getaddrinfo ENOTFOUND api.invalid.test', nodeId: requestNodeId }
              }
            };
          }
          [
            { eventId: 'run-started', sequence: 1, type: 'flow.run.started' },
            { eventId: 'node-started', sequence: 2, type: 'flow.node.started', nodeId: payload.flow.nodes.find((node) => node.kind === 'http').id },
            { eventId: 'data-resolved', sequence: 3, type: 'flow.data-edge.resolved', edgeId: payload.flow.dataEdges[0].id, payload: { secret: true, value: '[REDACTED]' } },
            { eventId: 'control-active', sequence: 4, type: 'flow.control-edge.activated', edgeId: 'control-runtime-path' },
            { eventId: 'node-completed', sequence: 5, type: 'flow.node.completed', nodeId: payload.flow.nodes.find((node) => node.kind === 'http').id, payload: { status: 'success' } },
            { eventId: 'run-completed', sequence: 6, type: 'flow.run.completed', payload: { status: 'success' } }
          ].forEach((event) => runtimeListener?.({ ...base, ...event, payload: event.payload || {} }));
          return { ok: true, data: { runId: payload.runId, flowUid: payload.flow.uid, status: 'success', events: [] } };
        }

        if (channel === 'renderer:flow-resume') {
          const base = {
            schemaVersion: 1,
            timestamp: '2026-07-20T10:00:00.000Z',
            source: 'flow-runtime',
            runId: payload.runId,
            flowUid: payload.flow.uid,
            payload: {}
          };
          [
            { eventId: 'resume-started', sequence: 1, type: 'flow.run.started' },
            { eventId: 'resume-reused', sequence: 2, type: 'flow.node.reused', nodeId: payload.flow.nodes.find((node) => node.kind === 'http').id },
            { eventId: 'resume-completed', sequence: 3, type: 'flow.run.completed', payload: { status: 'success' } }
          ].forEach((event) => runtimeListener?.({ ...base, ...event, payload: event.payload || {} }));
          return { ok: true, data: { runId: payload.runId, flowUid: payload.flow.uid, status: 'success', events: [] } };
        }
        if (channel === 'renderer:flow-cancel') return { ok: true, data: { runId: payload.runId, cancelled: true } };
        throw new Error(`Unexpected IPC channel ${channel}`);
      })
    };
  });

  afterEach(() => {
    delete window.ipcRenderer;
  });

  it('creates a flow through the UI, authors a bound graph, saves it, and restores it after remount', async () => {
    const firstStore = createStore();
    const firstMount = renderWorkspace(firstStore);

    await waitFor(() => expect(window.ipcRenderer.invoke).toHaveBeenCalledWith(
      'renderer:flow-catalog-open',
      { workspaceUid: loadedCollections[0].uid, workspacePath: loadedCollections[0].pathname }
    ));

    fireEvent.click(screen.getByTitle('Create flow'));
    fireEvent.change(screen.getByTestId('flow-create-name'), { target: { value: 'Create customer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(screen.getByTestId('mock-flow-node-count')).toHaveTextContent('2'));
    fireEvent.click(screen.getByRole('button', { name: 'Author graph' }));

    await waitFor(() => {
      expect(screen.getByTestId('mock-flow-node-count')).toHaveTextContent('5');
      expect(screen.getByTestId('mock-flow-data-edge-count')).toHaveTextContent('1');
    });

    fireEvent.click(screen.getByTestId('flow-save-button'));

    await waitFor(() => {
      expect(storedRecord.flow.nodes).toHaveLength(5);
      expect(storedRecord.flow.dataEdges).toHaveLength(1);
      expect(storedRecord.flow.nodes.find((node) => node.requestRef?.expectedItemUid === 'request_update_user').config.bindings.runtime.userId).toBeDefined();
    });

    firstMount.unmount();

    const secondStore = createStore();
    renderWorkspace(secondStore);

    await waitFor(() => {
      expect(screen.getByTestId('mock-flow-node-count')).toHaveTextContent('5');
      expect(screen.getByTestId('mock-flow-data-edge-count')).toHaveTextContent('1');
    });
    expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('renderer:flow-read', {
      workspacePath: loadedCollections[0].pathname,
      relativePath: storedRecord.relativePath
    });
  });

  it('handles keyboard search, undo, redo and save from the workspace tab', async () => {
    const store = createStore();
    renderWorkspace(store);
    fireEvent.click(await screen.findByTitle('Create flow'));
    fireEvent.change(screen.getByTestId('flow-create-name'), { target: { value: 'Keyboard flow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByTestId('mock-flow-node-count');
    fireEvent.click(screen.getByRole('button', { name: 'Author graph' }));
    await waitFor(() => expect(screen.getByTestId('mock-flow-node-count')).toHaveTextContent('5'));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(screen.getByTestId('mock-flow-node-count')).toHaveTextContent('2'));

    fireEvent.keyDown(window, { key: 'z', ctrlKey: true, shiftKey: true });
    await waitFor(() => expect(screen.getByTestId('mock-flow-node-count')).toHaveTextContent('5'));

    fireEvent.keyDown(window, { key: 'f', ctrlKey: true });
    expect(screen.getByPlaceholderText('Find node')).toHaveFocus();

    fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    await waitFor(() => expect(window.ipcRenderer.invoke).toHaveBeenCalledWith(
      'renderer:flow-save',
      expect.objectContaining({
        workspacePath: loadedCollections[0].pathname,
        relativePath: storedRecord.relativePath
      })
    ));
  });

  it('streams safe live runtime events into the console and graph projection', async () => {
    const store = createStore();
    renderWorkspace(store);
    fireEvent.click(await screen.findByTitle('Create flow'));
    fireEvent.change(screen.getByTestId('flow-create-name'), { target: { value: 'Runtime flow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByTestId('mock-flow-node-count');
    fireEvent.click(screen.getByRole('button', { name: 'Author graph' }));
    await waitFor(() => expect(screen.getByTestId('mock-flow-data-edge-count')).toHaveTextContent('1'));

    fireEvent.click(screen.getByRole('button', { name: 'Select request' }));
    await waitFor(() => expect(window.ipcRenderer.invoke).toHaveBeenCalledWith(
      'renderer:flow-preview-request',
      expect.objectContaining({ nodeId: expect.any(String) })
    ));
    await waitFor(() => expect(document.body.textContent).toContain('[REDACTED]'));

    fireEvent.click(screen.getByTestId('flow-run-button'));
    await waitFor(() => expect(screen.getByTestId('mock-flow-runtime-status')).toHaveTextContent('success'));
    expect(screen.getByTestId('mock-flow-active-control-count')).toHaveTextContent('1');
    expect(screen.getByTestId('mock-flow-active-data-count')).toHaveTextContent('1');
    expect(screen.getByText('control-edge · activated')).toBeInTheDocument();
    expect(screen.getByText('data-edge · resolved')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('real-secret');
  });

  it('keeps Flow Studio mounted and renders a failed request in the run console', async () => {
    const store = createStore();
    renderWorkspace(store);
    fireEvent.click(await screen.findByTitle('Create flow'));
    fireEvent.change(screen.getByTestId('flow-create-name'), { target: { value: 'Failed runtime flow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByTestId('mock-flow-node-count');
    fireEvent.click(screen.getByRole('button', { name: 'Author graph' }));
    await waitFor(() => expect(screen.getByTestId('mock-flow-node-count')).toHaveTextContent('5'));

    runtimeMode = 'failed';
    fireEvent.click(screen.getByTestId('flow-run-button'));

    await waitFor(() => expect(screen.getByTestId('mock-flow-runtime-status')).toHaveTextContent('failed'));
    expect(screen.getByText('getaddrinfo ENOTFOUND api.invalid.test')).toBeInTheDocument();
    expect(screen.getByTestId('flow-run-console')).toBeInTheDocument();
    expect(screen.getByTestId('mock-flow-node-count')).toHaveTextContent('5');
  });

  it('pauses at a checkpoint and resumes through the main-process journal', async () => {
    const store = createStore();
    renderWorkspace(store);
    fireEvent.click(await screen.findByTitle('Create flow'));
    fireEvent.change(screen.getByTestId('flow-create-name'), { target: { value: 'Resume flow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByTestId('mock-flow-node-count');
    fireEvent.click(screen.getByRole('button', { name: 'Author graph' }));
    await waitFor(() => expect(screen.getByTestId('mock-flow-node-count')).toHaveTextContent('5'));

    runtimeMode = 'paused';
    fireEvent.click(screen.getByTestId('flow-run-button'));
    await waitFor(() => expect(screen.getByTestId('mock-flow-runtime-status')).toHaveTextContent('paused'));
    expect(await screen.findByTestId('flow-resume-button')).toBeEnabled();
    expect(screen.getByText('3 journal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('flow-resume-button'));
    await waitFor(() => expect(window.ipcRenderer.invoke).toHaveBeenCalledWith(
      'renderer:flow-resume',
      expect.objectContaining({ checkpointId: 'checkpoint_ui', flow: expect.objectContaining({ uid: storedRecord.flow.uid }) })
    ));
    await waitFor(() => expect(screen.getByTestId('mock-flow-runtime-status')).toHaveTextContent('success'));
    expect(screen.getByText('node · reused')).toBeInTheDocument();
  });

  it('surfaces a stale revision conflict without replacing the persisted record', async () => {
    const store = createStore();
    renderWorkspace(store);
    fireEvent.click(await screen.findByTitle('Create flow'));
    fireEvent.change(screen.getByTestId('flow-create-name'), { target: { value: 'Conflict flow' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await screen.findByTestId('mock-flow-node-count');
    fireEvent.click(screen.getByRole('button', { name: 'Author graph' }));

    const external = toRecord(storedRecord.relativePath, { ...storedRecord.flow, name: 'External edit' });
    storedRecord = external;
    fireEvent.click(screen.getByTestId('flow-save-button'));

    await waitFor(() => expect(screen.getByText(/changed on disk/i)).toBeInTheDocument());
    expect(storedRecord.flow.name).toBe('External edit');
  });
});
