import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from 'providers/Theme';
import appReducer from 'providers/ReduxStore/slices/app';
import tabsReducer from 'providers/ReduxStore/slices/tabs';
import workspacesReducer from 'providers/ReduxStore/slices/workspaces';
import McpStatus from './index';

jest.mock('react-hot-toast', () => ({ success: jest.fn(), error: jest.fn() }));
jest.mock('@tippyjs/react', () => ({ __esModule: true, default: ({ children, render: renderContent }) => (
  <div>
    {children}
    {renderContent ? renderContent({}) : null}
  </div>
) }));

const initialPreferences = {
  request: { sslVerification: true },
  general: {},
  mcp: { enabled: true, port: 3847, workspaces: [], requestTimeoutMs: 120000, maxRequestFiles: 20000 }
};

const renderMcpStatus = (invoke, preferences = initialPreferences) => {
  window.ipcRenderer = { invoke, on: jest.fn(() => jest.fn()), send: jest.fn() };
  const store = configureStore({
    reducer: { app: appReducer, tabs: tabsReducer, workspaces: workspacesReducer },
    preloadedState: { app: { preferences } }
  });
  render(<Provider store={store}><ThemeProvider><McpStatus /></ThemeProvider></Provider>);
  return store;
};

describe('StatusBar Bruno MCP indicator', () => {
  it('shows the running state and endpoint from live status', async () => {
    const invoke = jest.fn(async (channel) => ({
      ok: true,
      data: channel === 'renderer:mcp-status'
        ? { enabled: true, running: true, state: 'running', endpoint: 'http://127.0.0.1:3847/mcp', connectedClients: 2 }
        : {}
    }));
    renderMcpStatus(invoke);

    expect(await screen.findByLabelText('Bruno MCP: Running')).toBeInTheDocument();
    expect(await screen.findByText('http://127.0.0.1:3847/mcp')).toBeInTheDocument();
  });

  it('stops MCP by disabling it via the same preferences save path as Settings', async () => {
    const invoke = jest.fn(async (channel, payload) => {
      if (channel === 'renderer:mcp-status') return { ok: true, data: { enabled: true, running: true, state: 'running' } };
      if (channel === 'renderer:save-preferences') return { ok: true };
      throw new Error(`Unexpected channel ${channel}`);
    });
    renderMcpStatus(invoke);
    await screen.findByLabelText('Bruno MCP: Running');

    fireEvent.click(screen.getByText('Stop'));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('renderer:save-preferences', expect.objectContaining({
      mcp: expect.objectContaining({ enabled: false })
    })));
  });

  it('restarts MCP via the restart IPC channel without touching preferences', async () => {
    const invoke = jest.fn(async (channel) => {
      if (channel === 'renderer:mcp-status') return { ok: true, data: { enabled: true, running: true, state: 'running' } };
      if (channel === 'renderer:mcp-restart') return { ok: true, data: { running: true, state: 'running' } };
      throw new Error(`Unexpected channel ${channel}`);
    });
    renderMcpStatus(invoke);
    await screen.findByLabelText('Bruno MCP: Running');

    fireEvent.click(screen.getByText('Restart'));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('renderer:mcp-restart', undefined));
    expect(invoke).not.toHaveBeenCalledWith('renderer:save-preferences', expect.anything());
  });

  it('hides Stop/Restart and only offers Start when MCP is disabled', async () => {
    const invoke = jest.fn(async (channel) => ({
      ok: true,
      data: channel === 'renderer:mcp-status' ? { enabled: false, running: false, state: 'stopped' } : {}
    }));
    renderMcpStatus(invoke, { ...initialPreferences, mcp: { ...initialPreferences.mcp, enabled: false } });

    await screen.findByLabelText('Bruno MCP: Stopped');
    expect(screen.getByText('Start')).toBeInTheDocument();
    expect(screen.queryByText('Stop')).not.toBeInTheDocument();
    expect(screen.queryByText('Restart')).not.toBeInTheDocument();
  });

  it('opens the Connections viewer and fetches its call log', async () => {
    const invoke = jest.fn(async (channel) => {
      if (channel === 'renderer:mcp-status') return { ok: true, data: { enabled: true, running: true, state: 'running' } };
      if (channel === 'renderer:mcp-connections') {
        return {
          ok: true,
          data: [{
            id: 'mcpcall_1',
            timestamp: '2026-07-22T04:00:00.000Z',
            tool: 'bruno_list_collections',
            source: '127.0.0.1:55123',
            durationMs: 12,
            status: 'success',
            request: {},
            response: { collections: [] },
            error: null
          }]
        };
      }
      throw new Error(`Unexpected channel ${channel}`);
    });
    renderMcpStatus(invoke);
    await screen.findByLabelText('Bruno MCP: Running');

    fireEvent.click(screen.getByText('Connections'));

    expect(await screen.findByText('bruno_list_collections')).toBeInTheDocument();
    expect(screen.getByText('127.0.0.1:55123')).toBeInTheDocument();
  });
});
