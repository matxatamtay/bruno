import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { Position } from '@xyflow/react';
import { Phase0ControlEdge, Phase0FlowCanvas, createPhase0Fixture } from './Phase0FlowCanvas';
import { createNodeRuntimeStore } from './runtime-store';

jest.setTimeout(30000);

describe('Phase 0 React Flow spike', () => {
  it('renders 500 custom request nodes with a custom frame and control edges', () => {
    const nodeIds = Array.from({ length: 500 }, (_, index) => `node-${index}`);
    const runtimeStore = createNodeRuntimeStore(nodeIds);

    render(<Phase0FlowCanvas nodeCount={500} runtimeStore={runtimeStore} />);

    expect(screen.getByTestId('phase0-frame')).toBeInTheDocument();
    expect(screen.getByTestId('phase0-node-node-0')).toBeInTheDocument();
    expect(screen.getByTestId('phase0-node-node-499')).toBeInTheDocument();

    const fixture = createPhase0Fixture({ nodeCount: 500, runtimeStore });
    expect(fixture.edges).toHaveLength(499);
    expect(fixture.edges.every((edge) => edge.type === 'phase0Control')).toBe(true);
  });

  it('renders the custom SVG control edge', () => {
    render(
      <svg>
        <Phase0ControlEdge
          id="edge-proof"
          sourceX={0}
          sourceY={0}
          sourcePosition={Position.Right}
          targetX={120}
          targetY={40}
          targetPosition={Position.Left}
        />
      </svg>
    );

    expect(screen.getByTestId('phase0-control-edge-edge-proof').querySelector('path')).toBeInTheDocument();
  });

  it('updates one node runtime projection without rerendering unrelated nodes', () => {
    const nodeIds = Array.from({ length: 500 }, (_, index) => `node-${index}`);
    const runtimeStore = createNodeRuntimeStore(nodeIds);
    const renderCounts = new Map();
    const onNodeRender = (nodeId) => {
      renderCounts.set(nodeId, (renderCounts.get(nodeId) || 0) + 1);
    };

    render(
      <Phase0FlowCanvas
        nodeCount={500}
        runtimeStore={runtimeStore}
        onNodeRender={onNodeRender}
      />
    );

    const before = new Map(renderCounts);

    act(() => {
      runtimeStore.updateNode('node-250', { status: 'running' });
    });

    const changedNodeIds = nodeIds.filter((nodeId) => renderCounts.get(nodeId) !== before.get(nodeId));
    expect(changedNodeIds).toEqual(['node-250']);
    expect(screen.getByTestId('phase0-node-node-250')).toHaveAttribute('data-runtime-status', 'running');
    expect(screen.getByTestId('phase0-node-node-249')).toHaveAttribute('data-runtime-status', 'idle');
  });
});
