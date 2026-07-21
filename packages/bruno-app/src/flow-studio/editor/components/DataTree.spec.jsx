import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { FLOW_OUTPUT_MIME, FLOW_OUTPUT_TEXT_PREFIX } from '../model';
import DataTree from './DataTree';

describe('DataTree', () => {
  it('renders large responses in bounded pages and preserves drag mapping payloads', () => {
    const value = Object.fromEntries(Array.from({ length: 12 }, (_, index) => [`field${index}`, `value${index}`]));
    render(<DataTree value={value} sourceNodeId="request_1" pageSize={5} />);

    expect(screen.getByRole('button', { name: 'Render 5 more fields' })).toBeInTheDocument();
    expect(screen.queryByText('field9')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Render 5 more fields' }));
    expect(screen.getByText('field8')).toBeInTheDocument();

    const values = {};
    const dataTransfer = {
      effectAllowed: '',
      setData: jest.fn((type, payload) => { values[type] = payload; })
    };
    fireEvent.dragStart(screen.getByTitle('Drag response.body.field0 into another request'), { dataTransfer });
    expect(dataTransfer.effectAllowed).toBe('copy');
    expect(JSON.parse(values[FLOW_OUTPUT_MIME])).toEqual({ sourceNodeId: 'request_1', sourcePath: 'response.body.field0' });
    expect(values['text/plain']).toBe(`${FLOW_OUTPUT_TEXT_PREFIX}${values[FLOW_OUTPUT_MIME]}`);
  });
});
