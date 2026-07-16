import '@testing-library/jest-dom';
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const mockDispatch = jest.fn((action) => action);

jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));
jest.mock('react-hot-toast', () => ({ success: jest.fn(), error: jest.fn() }));
jest.mock('providers/ReduxStore/slices/tabs', () => ({ addTab: jest.fn((payload) => payload) }));
jest.mock('providers/ReduxStore/slices/collections/actions', () => ({ runReplayScenario: jest.fn(() => async () => ({})) }));
jest.mock('utils/collections', () => ({
  flattenItems: (items) => items,
  findItemInCollection: (collection, uid) => collection.items.find((item) => item.uid === uid) || null
}));

import ContractsPanel from './ContractsPanel';
import CoveragePanel from './CoveragePanel';
import MockLabPanel from './MockLabPanel';
import TestDataPanel from './TestDataPanel';
import TracesPanel from './TracesPanel';

const collection = {
  uid: 'collection-1',
  name: 'Shop API',
  pathname: '/tmp/shop-api',
  items: [{ uid: 'get-user', name: 'Get user', type: 'http-request', pathname: '/tmp/shop-api/GetUser.bru', request: { method: 'GET', url: '{{baseUrl}}/users/{{id}}' } }]
};

const installIpc = (responses) => {
  window.ipcRenderer = {
    on: jest.fn(() => jest.fn()),
    invoke: jest.fn((channel) => Promise.resolve(channel in responses ? responses[channel] : null))
  };
};

describe('Intelligence Suite panels', () => {
  afterEach(() => {
    delete window.ipcRenderer;
    jest.clearAllMocks();
  });

  test('renders collection contract summary', async () => {
    installIpc({
      'renderer:api-intelligence:get-contract-dashboard': {
        summary: { endpoints: 1, contracts: 1, current: 1, stale: 0, withoutContracts: 0 },
        contracts: [{ id: 'contract-1', source: 'openapi', requestRef: { uid: 'get-user', name: 'Get user' }, responseContracts: { 200: {} }, revisionStatus: 'current' }]
      }
    });
    render(<ContractsPanel collection={collection} />);
    expect(await screen.findByText('API Contract Guardian')).toBeInTheDocument();
    expect(screen.getAllByText('Get user').length).toBeGreaterThan(0);
  });

  test('renders transparent coverage dimensions and recommendations table', async () => {
    installIpc({
      'renderer:api-intelligence:get-coverage': {
        summary: { requests: 1, coveredByScenarios: 0, neverRun: 1 },
        dimensions: { execution: 0, scenarios: 0, assertions: 0, contracts: 0, failurePaths: 0, environments: 0, freshness: 100 },
        requests: [{ requestUid: 'get-user', name: 'Get user', scenarioIds: [], runCount: 0, assertions: {}, contractStatus: 'missing', variants: {}, staleLinks: [] }]
      }
    });
    render(<CoveragePanel collection={collection} />);
    expect(await screen.findByText('Scenario Coverage Map')).toBeInTheDocument();
    expect(screen.getByText('Freshness')).toBeInTheDocument();
  });

  test('renders local mock state without starting a server', async () => {
    installIpc({
      'renderer:api-intelligence:get-mock-lab': { lab: { mode: 'pure-mock', routes: [] }, state: { running: false, requestsServed: 0 } },
      'renderer:api-intelligence:get-mock-logs': []
    });
    render(<MockLabPanel collection={collection} />);
    expect(await screen.findByText('Mock & Failure Lab')).toBeInTheDocument();
    expect(screen.getByText('No mock routes')).toBeInTheDocument();
  });

  test('renders empty local test data and trace stores', async () => {
    installIpc({
      'renderer:api-intelligence:list-test-data': [],
      'renderer:api-intelligence:list-fixtures': [],
      'renderer:api-intelligence:list-traces': []
    });
    const { rerender } = render(<TestDataPanel collection={collection} />);
    expect(await screen.findByText('No test data profiles')).toBeInTheDocument();
    rerender(<TracesPanel collection={collection} />);
    await waitFor(() => expect(screen.getByText('No traces yet')).toBeInTheDocument());
  });
});
