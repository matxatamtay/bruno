import React from 'react';
import { render } from '@testing-library/react';
import { Position, ReactFlowProvider } from '@xyflow/react';
import { FlowControlEdge, FlowDataEdge } from './FlowEdges';

const edgeProps = {
  sourceX: 0,
  sourceY: 0,
  sourcePosition: Position.Right,
  targetX: 140,
  targetY: 50,
  targetPosition: Position.Left
};

describe('Flow runtime edge gradients', () => {
  it('renders an animated gradient only for an activated control edge', () => {
    const { container, rerender } = render(
      <ReactFlowProvider><svg><FlowControlEdge id="control_1" {...edgeProps} data={{ runtime: null }} /></svg></ReactFlowProvider>
    );
    expect(container.querySelector('.flow-runtime-control-edge')).not.toBeInTheDocument();

    rerender(
      <ReactFlowProvider><svg><FlowControlEdge id="control_1" {...edgeProps} data={{ runtime: { status: 'activated' } }} /></svg></ReactFlowProvider>
    );
    expect(container.querySelector('.flow-runtime-control-edge')).toBeInTheDocument();
    expect(container.querySelector('#flow-control-gradient-control_1')).toBeInTheDocument();
  });

  it('renders the control gradient for a failure route', () => {
    const { container } = render(
      <ReactFlowProvider>
        <svg><FlowControlEdge id="control_failure" {...edgeProps} data={{ runtime: { status: 'failure' } }} /></svg>
      </ReactFlowProvider>
    );
    expect(container.querySelector('.flow-runtime-failure-edge')).toBeInTheDocument();
  });

  it('renders an animated gradient only for a resolved data edge', () => {
    const { container } = render(
      <ReactFlowProvider><svg><FlowDataEdge id="data_1" {...edgeProps} data={{ runtime: { status: 'resolved' } }} /></svg></ReactFlowProvider>
    );
    expect(container.querySelector('.flow-runtime-data-edge')).toBeInTheDocument();
    expect(container.querySelector('#flow-data-gradient-data_1')).toBeInTheDocument();
  });
});
