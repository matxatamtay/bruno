import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import appReducer from 'providers/ReduxStore/slices/app';
import Mcp from './index';

jest.mock('./StyledWrapper', () => ({ children }) => <div>{children}</div>);
jest.mock('components/ToggleSwitch', () => ({ isOn, handleToggle, ...props }) => (
  <button type="button" aria-label="Enable Bruno MCP" aria-pressed={isOn} onClick={handleToggle} {...props}>toggle</button>
));
jest.mock('react-hot-toast', () => ({
  success: jest.fn(),
  error: jest.fn()
}));

const initialPreferences = {
  request: { sslVerification: true },
  general: {},
  mcp: {
    enabled: false,
    host: '127.0.0.1',
    port: 3847,
    allowRemote: false,
    permissionProfile: 'read-only',
    allowedWorkspaces: [],
    allowedHosts: [],
    allowPrivateHosts: false,
    allowDynamicHosts: false,
    auditEnabled: true,
    rateLimitPerMinute: 120,
    requestTimeoutMs: 120000,
    maxRequestFiles: 10000
  }
};

const renderMcp = (invoke) => {
  window.ipcRenderer = {
    invoke,
    on: jest.fn(() => jest.fn())
  };
  const store = configureStore({
    reducer: { app: appReducer },
    preloadedState: {
      app: {
        preferences: initialPreferences
      }
    }
  });
  render(<Provider store={store}><Mcp /></Provider>);
  return store;
};

describe('Bruno MCP Preferences', () => {
  it('loads safe status and saves loopback configuration through the preferences IPC', async () => {
    const invoke = jest.fn(async (channel) => {
      if (channel === 'renderer:mcp-status') {
        return {
          ok: true,
          data: {
            running: false,
            endpoint: 'http://127.0.0.1:3847/mcp',
            permissionProfile: 'read-only',
            connectedClients: 0,
            loopbackOnly: true
          }
        };
      }
      if (channel === 'renderer:save-preferences') return undefined;
      throw new Error(`Unexpected channel ${channel}`);
    });
    const store = renderMcp(invoke);

    await waitFor(() => expect(screen.getByText('Stopped')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Enable Bruno MCP' }));
    fireEvent.change(screen.getByLabelText('Permission profile'), { target: { value: 'runner' } });
    fireEvent.change(screen.getByLabelText('Allowed workspace paths, one per line'), { target: { value: '/workspace/api' } });
    fireEvent.change(screen.getByLabelText('Allowed network hosts, one per line'), { target: { value: 'api.test\n*.example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and restart MCP' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('renderer:save-preferences', expect.objectContaining({
      mcp: expect.objectContaining({
        enabled: true,
        host: '127.0.0.1',
        permissionProfile: 'runner',
        allowedWorkspaces: [{ path: '/workspace/api' }],
        allowedHosts: ['api.test', '*.example.test']
      })
    })));
    expect(store.getState().app.preferences.mcp.permissionProfile).toBe('runner');
  });

  it('shows a rotated token only after the explicit rotate action', async () => {
    const invoke = jest.fn(async (channel) => {
      if (channel === 'renderer:mcp-status') return { ok: true, data: { running: true, endpoint: 'http://127.0.0.1:3847/mcp', loopbackOnly: true } };
      if (channel === 'renderer:mcp-rotate-token') return { ok: true, data: { token: 'shown-once-token', fingerprint: 'abcd' } };
      throw new Error(`Unexpected channel ${channel}`);
    });
    renderMcp(invoke);

    expect(screen.queryByText('shown-once-token')).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Rotate token/i }));
    expect(await screen.findByText('shown-once-token')).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('renderer:mcp-rotate-token', { reveal: true });
  });

  it('requires confirmation before enabling a non-loopback bind', async () => {
    const invoke = jest.fn(async (channel) => {
      if (channel === 'renderer:mcp-status') return { ok: true, data: { running: false, loopbackOnly: true } };
      throw new Error(`Unexpected channel ${channel}`);
    });
    window.confirm = jest.fn(() => false);
    renderMcp(invoke);
    const remoteToggle = await screen.findByRole('checkbox', { name: /Advanced: allow non-loopback bind/i });

    fireEvent.click(remoteToggle);
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(remoteToggle).not.toBeChecked();

    window.confirm.mockReturnValue(true);
    fireEvent.click(remoteToggle);
    expect(remoteToggle).toBeChecked();
  });
});
