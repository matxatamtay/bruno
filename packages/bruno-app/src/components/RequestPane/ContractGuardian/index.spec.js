import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import toast from 'react-hot-toast';
import ContractGuardian from './index';

jest.mock('react-hot-toast', () => ({ success: jest.fn(), error: jest.fn() }));

const collection = { uid: 'collection-1', name: 'Shop API', pathname: '/tmp/shop-api' };
const item = {
  uid: 'get-user',
  name: 'Get user',
  pathname: '/tmp/shop-api/GetUser.bru',
  type: 'http-request',
  request: { method: 'GET', url: '{{baseUrl}}/users/{{id}}' },
  response: { status: 200, headers: { 'content-type': 'application/json' }, data: { id: 'usr_1' } },
  examples: [{
    uid: 'example-1',
    name: 'Successful user',
    response: {
      status: '200',
      headers: [{ name: 'content-type', value: 'application/json', enabled: true }],
      body: { type: 'json', content: '{"id":"usr_example"}' }
    }
  }]
};

describe('ContractGuardian', () => {
  afterEach(() => {
    delete window.ipcRenderer;
    jest.clearAllMocks();
  });

  test('accepts the current response as a local contract', async () => {
    const accepted = {
      contract: { id: 'contract-1', acceptedAt: '2026-07-16T00:00:00.000Z', source: 'single-run', responseContracts: { 200: {} } },
      comparison: { status: 'pass', findings: [], summary: { breaking: 0, warnings: 0, nonBreaking: 0 } }
    };
    window.ipcRenderer = {
      invoke: jest.fn((channel) => {
        if (channel === 'renderer:api-intelligence:get-contract-state') return Promise.resolve({ contract: null, comparison: null });
        if (channel === 'renderer:api-intelligence:accept-contract') return Promise.resolve(accepted);
        return Promise.resolve(null);
      })
    };

    render(<ContractGuardian item={item} collection={collection} />);
    fireEvent.click(await screen.findByRole('button', { name: /Accept current response/i }));

    await waitFor(() => expect(window.ipcRenderer.invoke).toHaveBeenCalledWith(
      'renderer:api-intelligence:accept-contract',
      expect.objectContaining({ request: expect.objectContaining({ uid: 'get-user' }), response: item.response })
    ));
    expect(await screen.findByText(/matches the accepted contract/i)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalled();
  });

  test('accepts a response example through the same local contract store', async () => {
    window.ipcRenderer = {
      invoke: jest.fn((channel) => {
        if (channel === 'renderer:api-intelligence:get-contract-state') return Promise.resolve({ contract: null, comparison: null });
        if (channel === 'renderer:api-intelligence:accept-contract') return Promise.resolve({
          contract: { id: 'contract-example', acceptedAt: '2026-07-16T00:00:00.000Z', source: 'response-example', responseContracts: { 200: {} } },
          comparison: { status: 'pass', findings: [], summary: { breaking: 0, warnings: 0, nonBreaking: 0 } }
        });
        return Promise.resolve(null);
      })
    };

    render(<ContractGuardian item={item} collection={collection} />);
    fireEvent.click(await screen.findByRole('button', { name: /Accept Successful user/i }));

    await waitFor(() => expect(window.ipcRenderer.invoke).toHaveBeenCalledWith(
      'renderer:api-intelligence:accept-contract',
      expect.objectContaining({
        source: 'response-example',
        response: expect.objectContaining({ status: 200, data: { id: 'usr_example' } })
      })
    ));
  });
});
