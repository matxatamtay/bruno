import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import RunConsole from './RunConsole';

const flow = {
  inputSchema: {
    type: 'object',
    properties: {
      email: { type: 'string', title: 'Email' },
      enabled: { type: 'boolean', title: 'Enabled' },
      privateValue: { type: 'string', title: 'Private value', writeOnly: true }
    }
  }
};

const runtime = {
  status: 'running',
  runId: 'run_1',
  nodes: {},
  events: [{
    eventId: 'event_1', sequence: 1, type: 'flow.node.started', nodeId: 'request_1'
  }],
  error: null
};

describe('RunConsole', () => {
  it('renders schema-backed inputs and dispatches typed values', () => {
    const onInputChange = jest.fn();
    render(
      <RunConsole
        flow={flow}
        runtime={{ ...runtime, status: 'idle' }}
        inputs={{ email: '', enabled: false, privateValue: '' }}
        onInputChange={onInputChange}
        onRun={jest.fn()}
        onCancel={jest.fn()}
        onPreview={jest.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'customer@example.test' } });
    fireEvent.click(screen.getByLabelText('Enabled'));

    expect(onInputChange).toHaveBeenCalledWith('email', 'customer@example.test');
    expect(onInputChange).toHaveBeenCalledWith('enabled', true);
    expect(screen.getByLabelText('Private value')).toHaveAttribute('type', 'password');
  });

  it('offers checkpoint resume without exposing checkpoint journal contents', () => {
    const onResume = jest.fn();
    render(
      <RunConsole
        flow={flow}
        runtime={{ ...runtime, status: 'paused', result: { checkpointId: 'checkpoint_1' } }}
        inputs={{}}
        onInputChange={jest.fn()}
        onRun={jest.fn()}
        onCancel={jest.fn()}
        onResume={onResume}
        onDeleteCheckpoint={jest.fn()}
        checkpoints={[{
          checkpointId: 'checkpoint_1', nodeId: 'checkpoint_node', journalEntries: 4, status: 'valid'
        }]}
        onPreview={jest.fn()}
      />
    );

    fireEvent.click(screen.getByTestId('flow-resume-button'));
    expect(onResume).toHaveBeenCalledWith('checkpoint_1');
    expect(screen.getByText('4 journal')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('raw-checkpoint-secret');
  });

  it('shows streamed events and only a safe Bruno request mapping preview', () => {
    render(
      <RunConsole
        flow={flow}
        runtime={runtime}
        inputs={{}}
        onInputChange={jest.fn()}
        onRun={jest.fn()}
        onCancel={jest.fn()}
        onPreview={jest.fn()}
        selectedRequestNode={{ id: 'request_1', requestRef: { itemPathname: 'one.bru' } }}
        preview={{
          method: 'POST',
          url: 'https://api.test/one',
          query: { id: '7' },
          headers: { Authorization: '[REDACTED]' },
          body: { privateValue: '{{privateValue}}', visible: true },
          runtimeVariables: { userId: 'user-7' },
          provenance: { 'runtime.userId': [{ kind: 'response', nodeId: 'request_0' }] }
        }}
      />
    );

    expect(screen.getByText('node · started')).toBeInTheDocument();
    expect(screen.getByText('Runtime variables')).toBeInTheDocument();
    expect(screen.getAllByText(/REDACTED/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/real-secret/)).not.toBeInTheDocument();
    expect(screen.getByTestId('flow-cancel-button')).toBeEnabled();
  });
});
