import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  FLOW_ASSET_MIME,
  FLOW_ASSET_TEXT_PREFIX,
  FLOW_OUTPUT_MIME,
  addNode,
  createAuthoringFlow,
  createRequestNodeFromAsset
} from '../model';
import AssetsPanel from './AssetsPanel';
import FlowCanvas from './FlowCanvas';

const mockFitView = jest.fn();
const mockGetNodes = jest.fn(() => []);
const mockScreenToFlowPosition = jest.fn(({ x, y }) => ({ x, y }));

jest.mock('@xyflow/react', () => ({
  Background: () => null,
  Controls: () => null,
  MiniMap: () => null,
  ReactFlow: ({ children, onDragEnter, onDragOver, onDrop }) => (
    <div
      data-testid="react-flow-pane"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {children}
    </div>
  ),
  applyEdgeChanges: (changes, edges) => edges,
  applyNodeChanges: (changes, nodes) => nodes,
  useReactFlow: () => ({ fitView: mockFitView, getNodes: mockGetNodes, screenToFlowPosition: mockScreenToFlowPosition })
}));

jest.mock('./FlowNodes', () => ({ flowNodeTypes: {} }));
jest.mock('./FlowEdges', () => ({ flowEdgeTypes: {} }));

const requestAsset = {
  assetType: 'request',
  id: 'accounts:create-user',
  collectionUid: 'accounts',
  collectionName: 'Accounts',
  collectionPath: 'collections/accounts',
  itemUid: 'create-user',
  itemPathname: 'users/create.bru',
  name: 'Create user',
  type: 'http-request',
  method: 'POST'
};

const createFlow = () => createAuthoringFlow({
  uid: 'flow_drop_test',
  name: 'Drop test',
  workspaceUid: 'workspace_drop_test'
});

const renderCanvas = (flow = createFlow()) => {
  const onCommit = jest.fn();
  const onSelectionChange = jest.fn();
  render(
    <FlowCanvas
      flow={flow}
      validation={{ issues: [] }}
      searchQuery=""
      selection={{ nodeIds: [], frameIds: [], controlEdgeIds: [], dataEdgeIds: [] }}
      onSelectionChange={onSelectionChange}
      onCommit={onCommit}
      onReplace={jest.fn()}
      onProjectionMeasured={jest.fn()}
      runtimeProjection={{}}
    />
  );
  return { flow, onCommit, onSelectionChange };
};

describe('Flow Studio canvas asset drop', () => {
  beforeEach(() => {
    mockGetNodes.mockReset();
    mockGetNodes.mockReturnValue([]);
    mockScreenToFlowPosition.mockReset();
    mockScreenToFlowPosition.mockImplementation(({ x, y }) => ({ x, y }));
  });
  it('drags a request from the Assets panel through the shared DataTransfer into the canvas', () => {
    mockScreenToFlowPosition.mockReturnValueOnce({ x: 360, y: 200 });
    const { onCommit } = renderCanvas();
    render(
      <AssetsPanel
        requestAssets={[requestAsset]}
        searchQuery=""
        onSearchQueryChange={jest.fn()}
        searchInputRef={null}
      />
    );
    const values = {};
    const dataTransfer = {
      effectAllowed: '',
      dropEffect: '',
      setData: jest.fn((type, value) => { values[type] = value; }),
      getData: jest.fn((type) => values[type] || '')
    };

    fireEvent.dragStart(screen.getByTitle('Accounts / Create user'), { dataTransfer });
    fireEvent.dragOver(screen.getByTestId('react-flow-pane'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('react-flow-pane'), { dataTransfer });

    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(dataTransfer.dropEffect).toBe('copy');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].nodes.at(-1)).toMatchObject({
      kind: 'http',
      name: 'Create user',
      position: { x: 360, y: 200 }
    });
  });

  it('adds a request node when the custom Bruno drag payload is dropped on the React Flow pane', () => {
    mockScreenToFlowPosition.mockReturnValueOnce({ x: 420, y: 240 });
    const { flow, onCommit, onSelectionChange } = renderCanvas();
    const payload = JSON.stringify(requestAsset);
    const dataTransfer = {
      dropEffect: '',
      getData: jest.fn((type) => type === FLOW_ASSET_MIME ? payload : '')
    };

    fireEvent.dragOver(screen.getByTestId('react-flow-pane'), { dataTransfer });
    fireEvent.drop(screen.getByTestId('react-flow-pane'), {
      clientX: 420,
      clientY: 240,
      dataTransfer
    });

    expect(dataTransfer.dropEffect).toBe('copy');
    expect(onCommit).toHaveBeenCalledTimes(1);
    const [nextFlow, metadata] = onCommit.mock.calls[0];
    expect(nextFlow.nodes).toHaveLength(flow.nodes.length + 1);
    expect(nextFlow.nodes.at(-1)).toMatchObject({
      kind: 'http',
      name: 'Create user',
      position: { x: 420, y: 240 },
      requestRef: {
        collectionPath: 'collections/accounts',
        itemPathname: 'users/create.bru',
        expectedItemUid: 'create-user'
      }
    });
    expect(metadata).toMatchObject({ topology: true, nodeIds: [nextFlow.nodes.at(-1).id] });
    expect(onSelectionChange).toHaveBeenCalledWith(expect.objectContaining({
      nodeIds: [nextFlow.nodes.at(-1).id]
    }));
  });

  it('accepts the Electron-safe text payload when the custom MIME type is unavailable', () => {
    mockScreenToFlowPosition.mockReturnValueOnce({ x: 120, y: 80 });
    const { onCommit } = renderCanvas();
    const payload = JSON.stringify(requestAsset);
    const dataTransfer = {
      getData: jest.fn((type) => type === 'text/plain' ? `${FLOW_ASSET_TEXT_PREFIX}${payload}` : '')
    };

    fireEvent.drop(screen.getByTestId('react-flow-pane'), {
      clientX: 120,
      clientY: 80,
      dataTransfer
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].nodes.at(-1)).toMatchObject({
      kind: 'http',
      position: { x: 120, y: 80 }
    });
  });

  it('maps a dragged response field into the request node under the drop point', () => {
    let flow = createFlow();
    const source = createRequestNodeFromAsset(flow, { ...requestAsset, id: 'accounts:create-user', itemUid: 'create-user' }, { x: 100, y: 100 });
    flow = addNode(flow, source);
    const target = createRequestNodeFromAsset(flow, {
      ...requestAsset,
      id: 'accounts:update-user',
      itemUid: 'update-user',
      itemPathname: 'users/update.bru',
      name: 'Update user',
      method: 'PATCH'
    }, { x: 420, y: 160 });
    flow = addNode(flow, target);
    mockGetNodes.mockReturnValue([
      { id: source.id, position: source.position, width: 190, height: 90 },
      { id: target.id, position: target.position, width: 190, height: 90 }
    ]);
    mockScreenToFlowPosition.mockReturnValueOnce({ x: 450, y: 180 });
    const { onCommit } = renderCanvas(flow);
    const payload = JSON.stringify({ sourceNodeId: source.id, sourcePath: 'response.body.data.userId' });
    const dataTransfer = {
      getData: jest.fn((type) => type === FLOW_OUTPUT_MIME ? payload : '')
    };

    fireEvent.drop(screen.getByTestId('react-flow-pane'), {
      clientX: 450,
      clientY: 180,
      dataTransfer
    });

    expect(onCommit).toHaveBeenCalledTimes(1);
    const [nextFlow] = onCommit.mock.calls[0];
    expect(nextFlow.nodes.find((node) => node.id === target.id).config.bindings.runtime.userId).toMatchObject({
      sourceNodeId: source.id,
      sourcePath: 'response.body.data.userId'
    });
    expect(nextFlow.dataEdges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: { nodeId: source.id, path: 'response.body.data.userId' },
        target: { nodeId: target.id, path: 'runtime.userId' }
      })
    ]));
  });

  it.each([
    [{ assetType: 'control', id: 'condition', kind: 'condition', name: 'Condition' }, 'condition'],
    [{ assetType: 'input', id: 'static-input', kind: 'static-input', name: 'Static value' }, 'static-input']
  ])('creates non-request assets from the same drop path', (asset, expectedKind) => {
    mockScreenToFlowPosition.mockReturnValueOnce({ x: 300, y: 160 });
    const { onCommit } = renderCanvas();
    const payload = JSON.stringify(asset);
    const dataTransfer = {
      getData: jest.fn((type) => type === FLOW_ASSET_MIME ? payload : '')
    };

    fireEvent.drop(screen.getByTestId('react-flow-pane'), { dataTransfer });

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].nodes.at(-1)).toMatchObject({
      kind: expectedKind,
      position: { x: 300, y: 160 }
    });
  });
});
