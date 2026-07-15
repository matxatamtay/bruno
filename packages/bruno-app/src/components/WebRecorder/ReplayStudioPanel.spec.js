import '@testing-library/jest-dom';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockDispatch = jest.fn((action) => typeof action === 'function' ? action(jest.fn(), jest.fn()) : action);

jest.mock('react-redux', () => ({ useDispatch: () => mockDispatch }));
jest.mock('react-hot-toast', () => ({ success: jest.fn(), error: jest.fn() }));
jest.mock('providers/ReduxStore/slices/tabs', () => ({ addTab: jest.fn((payload) => payload) }));
jest.mock('providers/ReduxStore/slices/collections/actions', () => ({
  runReplayScenario: jest.fn(() => async () => ({ id: 'run-1', status: 'passed', steps: [] })),
  selectEnvironment: jest.fn(() => async () => {})
}));
jest.mock('utils/collections', () => ({
  flattenItems: (items) => items,
  findItemInCollection: (collection, uid) => collection.items.find((item) => item.uid === uid) || null
}));

import ReplayStudioPanel from './ReplayStudioPanel';

const collection = {
  uid: 'collection-1',
  name: 'Shop API',
  pathname: '/tmp/shop-api',
  activeEnvironmentUid: null,
  environments: [],
  items: [
    { uid: 'login', name: 'Login', type: 'http-request', pathname: '/tmp/shop-api/Login.bru', request: { method: 'POST', url: 'https://api.test/login' } },
    { uid: 'order', name: 'Create order', type: 'http-request', pathname: '/tmp/shop-api/CreateOrder.bru', request: { method: 'POST', url: 'https://api.test/orders' } }
  ]
};

describe('ReplayStudioPanel', () => {
  afterEach(() => {
    delete window.ipcRenderer;
    jest.clearAllMocks();
  });

  test('analyzes a selected recording and shows the saved local scenario', async () => {
    let scenarios = [];
    window.ipcRenderer = {
      invoke: jest.fn((channel) => {
        if (channel === 'renderer:recorder:list-scenarios') return Promise.resolve(scenarios);
        if (channel === 'renderer:recorder:analyze-session') {
          const scenario = {
            id: 'scenario-1',
            name: 'Checkout',
            steps: [{ id: 'step-1', name: 'Login', enabled: true, order: 1, role: 'authentication', confidence: 'high', link: { requestUid: 'login' }, requestHint: { method: 'POST', url: 'https://api.test/login' }, assertions: [], overrides: {}, extracts: [] }]
          };
          scenarios = [scenario];
          return Promise.resolve(scenario);
        }
        if (channel === 'renderer:recorder:get-scenario') return Promise.resolve(scenarios[0]);
        if (channel === 'renderer:recorder:get-baseline') return Promise.resolve(null);
        if (channel === 'renderer:recorder:list-runs') return Promise.resolve([]);
        return Promise.resolve(null);
      })
    };

    render(<ReplayStudioPanel collection={collection} selectedSessionId="session-1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Analyze recording/i }));

    await waitFor(() => expect(screen.getByText('Checkout')).toBeInTheDocument());
    expect(window.ipcRenderer.invoke).toHaveBeenCalledWith('renderer:recorder:analyze-session', expect.objectContaining({ sessionId: 'session-1' }));
    expect(screen.getByText(/Stored locally outside the collection/i)).toBeInTheDocument();
  });

  test('shows dependency graph and persists drag-drop ordering', async () => {
    const scenario = {
      id: 'scenario-graph',
      name: 'Checkout graph',
      steps: [
        { id: 'login-step', name: 'Login', enabled: true, order: 1, role: 'authentication', confidence: 'high', link: { requestUid: 'login' }, requestHint: { method: 'POST', url: 'https://api.test/login' }, assertions: [], extracts: [{ variable: 'accessToken', sourcePath: 'body.accessToken' }], overrides: {}, replay: {} },
        { id: 'order-step', name: 'Create order', enabled: true, order: 2, role: 'api', confidence: 'high', link: { requestUid: 'order' }, requestHint: { method: 'POST', url: 'https://api.test/orders' }, assertions: [], extracts: [], overrides: { bindings: [{ variable: 'accessToken', targetPath: 'headers.Authorization', originalValue: '<redacted>' }] }, replay: {} }
      ]
    };
    window.ipcRenderer = {
      invoke: jest.fn((channel, payload) => {
        if (channel === 'renderer:recorder:list-scenarios') return Promise.resolve([scenario]);
        if (channel === 'renderer:recorder:get-scenario') return Promise.resolve(scenario);
        if (channel === 'renderer:recorder:get-baseline') return Promise.resolve(null);
        if (channel === 'renderer:recorder:list-runs') return Promise.resolve([]);
        if (channel === 'renderer:recorder:save-scenario') return Promise.resolve(payload.scenario);
        return Promise.resolve(null);
      })
    };

    const { container } = render(<ReplayStudioPanel collection={collection} selectedSessionId="session-1" />);
    await screen.findByDisplayValue('Checkout graph');
    fireEvent.click(screen.getByRole('button', { name: /Dependency graph/i }));
    expect(screen.getByText('Data dependencies')).toBeInTheDocument();
    expect(screen.getAllByText('accessToken').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Steps & policies/i }));
    const rows = container.querySelectorAll('.replay-step');
    fireEvent.dragStart(rows[1]);
    fireEvent.dragOver(rows[0]);
    fireEvent.drop(rows[0]);
    fireEvent.click(screen.getByRole('button', { name: /^Save$/i }));

    await waitFor(() => expect(window.ipcRenderer.invoke).toHaveBeenCalledWith(
      'renderer:recorder:save-scenario',
      expect.objectContaining({ scenario: expect.objectContaining({ steps: expect.arrayContaining([expect.objectContaining({ id: 'order-step', order: 1 })]) }) })
    ));
  });
});
