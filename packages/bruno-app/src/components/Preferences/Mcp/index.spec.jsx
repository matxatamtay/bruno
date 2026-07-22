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
jest.mock('react-hot-toast', () => ({ success: jest.fn(), error: jest.fn() }));

const initialPreferences = {
  request: { sslVerification: true },
  general: {},
  mcp: {
    enabled: false,
    port: 3847,
    workspaces: [],
    requestTimeoutMs: 120000,
    maxRequestFiles: 20000
  }
};

const clientConfigs = {
  transport: 'http',
  endpoint: 'http://127.0.0.1:3847/mcp',
  tokenEnvVar: 'BRUNO_MCP_TOKEN',
  codex: { configPath: '~/.codex/config.toml', snippet: '[mcp_servers.bruno]\nurl = "http://127.0.0.1:3847/mcp"\nbearer_token_env_var = "BRUNO_MCP_TOKEN"' },
  claudeDesktop: { configPath: '~/Library/Application Support/Claude/claude_desktop_config.json', snippet: '{"mcpServers":{"bruno":{"command":"npx","args":["-y","mcp-remote","http://127.0.0.1:3847/mcp","--allow-http","--header","Authorization:${BRUNO_MCP_TOKEN}"],"env":{"BRUNO_MCP_TOKEN":"Bearer <paste-your-bruno-mcp-token-here>"}}}}' },
  claudeCode: { configPath: '.mcp.json', snippet: '{"mcpServers":{"bruno":{"type":"http","url":"http://127.0.0.1:3847/mcp","headers":{"Authorization":"Bearer ${BRUNO_MCP_TOKEN}"}}}}' }
};

const renderMcp = (invoke) => {
  window.ipcRenderer = { invoke, on: jest.fn(() => jest.fn()) };
  const store = configureStore({
    reducer: { app: appReducer },
    preloadedState: { app: { preferences: initialPreferences } }
  });
  render(<Provider store={store}><Mcp /></Provider>);
  return store;
};

describe('Bruno MCP Preferences', () => {
  it('saves only the local collection MCP configuration', async () => {
    const invoke = jest.fn(async (channel) => {
      if (channel === 'renderer:mcp-status') return { ok: true, data: { running: false, endpoint: 'http://127.0.0.1:3847/mcp', connectedClients: 0, workspaceCount: 0 } };
      if (channel === 'renderer:mcp-client-configs') return { ok: true, data: clientConfigs };
      if (channel === 'renderer:save-preferences') return undefined;
      throw new Error(`Unexpected channel ${channel}`);
    });
    renderMcp(invoke);

    await waitFor(() => expect(screen.getByText('Stopped')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Enable Bruno MCP' }));
    fireEvent.change(screen.getByLabelText('Workspace paths for discovery, one per line'), { target: { value: '/workspace/api\n/workspace/mobile' } });
    fireEvent.change(screen.getByLabelText('Request timeout, ms'), { target: { value: '60000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and restart MCP' }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith('renderer:save-preferences', expect.objectContaining({
      mcp: {
        enabled: true,
        port: 3847,
        requestTimeoutMs: 60000,
        maxRequestFiles: 20000,
        workspaces: [{ path: '/workspace/api' }, { path: '/workspace/mobile' }]
      }
    })));
    expect(screen.queryByLabelText('Permission profile')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Allowed network hosts, one per line')).not.toBeInTheDocument();
  });

  it('explains that Flow Studio and Intelligence Suite are excluded', async () => {
    const invoke = jest.fn(async (channel) => ({ ok: true, data: channel === 'renderer:mcp-client-configs' ? clientConfigs : { running: false } }));
    renderMcp(invoke);
    expect(await screen.findByText(/Flow Studio and Intelligence Suite are intentionally not exposed/i)).toBeInTheDocument();
  });

  it('shows a rotated token only after the explicit rotate action', async () => {
    const shownToken = ['shown', 'once', 'value'].join('-');
    const invoke = jest.fn(async (channel) => {
      if (channel === 'renderer:mcp-status') return { ok: true, data: { running: true, endpoint: 'http://127.0.0.1:3847/mcp' } };
      if (channel === 'renderer:mcp-client-configs') return { ok: true, data: clientConfigs };
      if (channel === 'renderer:mcp-rotate-token') return { ok: true, data: { token: shownToken, fingerprint: 'abcd' } };
      throw new Error(`Unexpected channel ${channel}`);
    });
    renderMcp(invoke);

    expect(screen.queryByText(shownToken)).not.toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: /Rotate token/i }));
    expect(await screen.findByText(shownToken)).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('renderer:mcp-rotate-token', { reveal: true });
  });

  it('shows copy-ready Codex, Claude Code, and Claude Desktop configurations without a raw token', async () => {
    const writeText = jest.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const invoke = jest.fn(async (channel) => ({
      ok: true,
      data: channel === 'renderer:mcp-client-configs' ? clientConfigs : { running: true }
    }));
    renderMcp(invoke);

    expect(await screen.findByText('[mcp_servers.bruno]', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Claude Code')).toBeInTheDocument();
    expect(screen.getByText('Claude Desktop')).toBeInTheDocument();
    expect(screen.queryByText(/shown-once-value/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Copy Codex config/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(clientConfigs.codex.snippet));
  });
});
