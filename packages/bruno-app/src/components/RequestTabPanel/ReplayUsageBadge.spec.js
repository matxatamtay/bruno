import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockDispatch = jest.fn((action) => action);
const mockAddTab = jest.fn((payload) => payload);

jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));
jest.mock('react-hot-toast', () => ({ success: jest.fn(), error: jest.fn() }));
jest.mock('providers/ReduxStore/slices/tabs', () => ({ addTab: (payload) => mockAddTab(payload) }));

import ReplayUsageBadge from './ReplayUsageBadge';

const collection = { uid: 'collection-1', name: 'Shop API', pathname: '/tmp/shop-api' };
const item = {
  uid: 'get-user',
  name: 'Get user',
  type: 'http-request',
  pathname: '/tmp/shop-api/GetUser.bru',
  request: { method: 'GET', url: '{{baseUrl}}/users/{{id}}' },
  response: { status: 200, data: { id: 'usr_1' } }
};

describe('request Intelligence chips', () => {
  afterEach(() => {
    delete window.ipcRenderer;
    jest.clearAllMocks();
  });

  test('shows local evidence and opens the requested Intelligence mode', async () => {
    window.ipcRenderer = {
      on: jest.fn(() => jest.fn()),
      invoke: jest.fn((channel) => {
        if (channel === 'renderer:recorder:get-request-usage') return Promise.resolve([{ scenarioId: 'scenario-1' }]);
        if (channel === 'renderer:recorder:list-scenarios') return Promise.resolve([{ id: 'scenario-1', name: 'Checkout', steps: [] }]);
        if (channel === 'renderer:api-intelligence:get-contract-state') return Promise.resolve({ contract: { id: 'contract-1' } });
        if (channel === 'renderer:api-intelligence:get-latest-coverage') return Promise.resolve({ requests: [{ requestUid: item.uid, covered: true, replayed: true, staleLinks: [] }] });
        if (channel === 'renderer:api-intelligence:get-mock-lab') return Promise.resolve({ lab: { routes: [{ requestRef: { uid: item.uid } }] } });
        if (channel === 'renderer:api-intelligence:list-traces') return Promise.resolve([{ traceId: 'trace-1', steps: [{ requestUid: item.uid }] }]);
        return Promise.resolve(null);
      })
    };

    render(<ReplayUsageBadge collection={collection} item={item} />);

    expect(await screen.findByRole('button', { name: /1 Scenario/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Contract/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Covered$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 Mock/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 Trace/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /1 Trace/i }));
    await waitFor(() => expect(mockAddTab).toHaveBeenCalledWith(expect.objectContaining({
      uid: 'collection-1-web-recorder',
      intelligenceMode: 'traces',
      replayScenarioId: null
    })));
  });
});
