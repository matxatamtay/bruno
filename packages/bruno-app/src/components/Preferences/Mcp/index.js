import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import toast from 'react-hot-toast';
import { IconCopy, IconRefresh, IconRotate, IconUnlink } from '@tabler/icons';
import ToggleSwitch from 'components/ToggleSwitch';
import { savePreferences } from 'providers/ReduxStore/slices/app';
import StyledWrapper from './StyledWrapper';

const splitLines = (value) => String(value || '').split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean);

const Mcp = () => {
  const dispatch = useDispatch();
  const preferences = useSelector((state) => state.app.preferences);
  const source = preferences.mcp || {};
  const [draft, setDraft] = useState(source);
  const [status, setStatus] = useState(null);
  const [saving, setSaving] = useState(false);
  const [revealedToken, setRevealedToken] = useState('');
  const [clientConfigs, setClientConfigs] = useState(null);

  useEffect(() => setDraft(source), [source]);

  const invoke = useCallback(async (channel, payload) => {
    const response = await window.ipcRenderer.invoke(channel, payload);
    if (!response?.ok) throw new Error(response?.error?.message || 'Bruno MCP operation failed');
    return response.data;
  }, []);

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await invoke('renderer:mcp-status'));
    } catch (error) {
      setStatus({ running: false, error: error.message });
    }
  }, [invoke]);

  useEffect(() => {
    refreshStatus();
    invoke('renderer:mcp-client-configs').then(setClientConfigs).catch(() => setClientConfigs(null));
    const removeListener = window.ipcRenderer.on('main:mcp-status', (nextStatus) => setStatus(nextStatus));
    return () => removeListener?.();
  }, [invoke, refreshStatus]);

  const configuredWorkspaces = draft.workspaces || draft.allowedWorkspaces || [];
  const workspaceText = useMemo(() => configuredWorkspaces.map((workspace) => workspace.path || workspace).join('\n'), [configuredWorkspaces]);
  const setField = (name, value) => setDraft((current) => ({ ...current, [name]: value }));

  const save = async () => {
    setSaving(true);
    try {
      const workspaces = configuredWorkspaces.map((workspace) => typeof workspace === 'string' ? { path: workspace } : workspace);
      const normalized = {
        enabled: draft.enabled === true,
        port: Number(draft.port) || 3847,
        requestTimeoutMs: Number(draft.requestTimeoutMs) || 120000,
        maxRequestFiles: Number(draft.maxRequestFiles) || 20000,
        workspaces
      };
      await dispatch(savePreferences({ ...preferences, mcp: normalized }));
      toast.success('Bruno MCP preferences saved');
      await refreshStatus();
    } catch (error) {
      toast.error(error.message || 'Unable to save Bruno MCP preferences');
    } finally {
      setSaving(false);
    }
  };

  const rotateToken = async () => {
    try {
      const result = await invoke('renderer:mcp-rotate-token', { reveal: true });
      setRevealedToken(result.token || '');
      toast.success('MCP token rotated. Existing clients were disconnected.');
      await refreshStatus();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const disconnectClients = async () => {
    try {
      const result = await invoke('renderer:mcp-disconnect-clients');
      setRevealedToken(result.token || '');
      toast.success('Clients disconnected and token revoked');
      await refreshStatus();
    } catch (error) {
      toast.error(error.message);
    }
  };

  const copyText = async (value, label) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch (_) {
      toast.error(`Unable to copy ${label.toLowerCase()}`);
    }
  };

  const copyToken = () => copyText(revealedToken, 'Token');

  return (
    <StyledWrapper>
      <div className="section-header">Bruno MCP</div>
      <p className="mcp-description">A direct MCP interface for Bruno collections. It can search, read, create, edit, move, delete, resolve, and run requests through the same Bruno engine used by the desktop app. Flow Studio and Intelligence Suite are intentionally not exposed.</p>

      <div className="mcp-card">
        <div className="mcp-row">
          <div>
            <strong>Enable Bruno MCP</strong>
            <small>Starts a local Streamable HTTP MCP server on 127.0.0.1.</small>
          </div>
          <ToggleSwitch size="xs" isOn={draft.enabled === true} handleToggle={() => setField('enabled', draft.enabled !== true)} data-testid="mcp-enabled-toggle" />
        </div>
        <div className="mcp-grid">
          <label>
            Port
            <input className="textbox" type="number" min="1" max="65535" value={draft.port || 3847} onChange={(event) => setField('port', event.target.value)} />
          </label>
          <label>
            Request timeout, ms
            <input className="textbox" type="number" min="1000" max="600000" value={draft.requestTimeoutMs || 120000} onChange={(event) => setField('requestTimeoutMs', event.target.value)} />
          </label>
          <label>
            Discovery file limit
            <input className="textbox" type="number" min="100" max="100000" value={draft.maxRequestFiles || 20000} onChange={(event) => setField('maxRequestFiles', event.target.value)} />
          </label>
        </div>
        <label className="mcp-block-field">
          Workspace paths for discovery, one per line
          <textarea aria-label="Workspace paths for discovery, one per line" className="textbox" rows={5} value={workspaceText} placeholder="/home/me/projects/api-workspace" onChange={(event) => setField('workspaces', splitLines(event.target.value).map((pathname) => ({ path: pathname })))} />
          <small>Tools may also pass an explicit workspace_path, so this list is convenience and discovery, not an allowlist.</small>
        </label>
        <button type="button" className="mcp-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save and restart MCP'}</button>
      </div>

      <div className="mcp-card">
        <div className="mcp-status-heading">
          <div>
            <strong>Server status</strong>
            <small className={status?.running ? 'online' : 'offline'}>{status?.running ? 'Running' : 'Stopped'}</small>
          </div>
          <button type="button" className="mcp-icon-button" onClick={refreshStatus} title="Refresh MCP status"><IconRefresh size={15} /></button>
        </div>
        <dl className="mcp-status-list">
          <div><dt>Endpoint</dt><dd>{status?.endpoint || `http://127.0.0.1:${draft.port || 3847}/mcp`}</dd></div>
          <div><dt>Workspaces</dt><dd>{status?.workspaceCount ?? configuredWorkspaces.length}</dd></div>
          <div><dt>Clients</dt><dd>{status?.connectedClients || 0}</dd></div>
          <div><dt>Surface</dt><dd>Collections and requests</dd></div>
        </dl>
        {status?.error && <div className="mcp-error">{status.error}</div>}
        <div className="mcp-actions">
          <button type="button" onClick={rotateToken}><IconRotate size={14} /> Rotate token</button>
          <button type="button" onClick={disconnectClients}><IconUnlink size={14} /> Disconnect clients</button>
        </div>
        {revealedToken && (
          <div className="mcp-token">
            <span>New token, shown once</span>
            <code>{revealedToken}</code>
            <button type="button" onClick={copyToken}><IconCopy size={13} /> Copy</button>
          </div>
        )}
      </div>

      <div className="mcp-card">
        <div className="mcp-client-heading">
          <div>
            <strong>Connect Codex and Claude</strong>
            <small>These clients launch Bruno in stdio bridge mode. Keep the Bruno desktop app open with MCP enabled. The local token stays in Bruno's protected store and is not written into either client config.</small>
          </div>
        </div>
        <div className="mcp-client-configs">
          <section>
            <div className="mcp-config-heading">
              <div><strong>Codex</strong><small>{clientConfigs?.codex?.configPath || '~/.codex/config.toml'}</small></div>
              <button type="button" aria-label="Copy Codex config" disabled={!clientConfigs?.codex?.snippet} onClick={() => copyText(clientConfigs?.codex?.snippet || '', 'Codex config')}><IconCopy size={13} /> Copy</button>
            </div>
            <pre>{clientConfigs?.codex?.snippet || 'Save MCP preferences to generate the installed Bruno command.'}</pre>
          </section>
          <section>
            <div className="mcp-config-heading">
              <div><strong>Claude Desktop / Claude Code</strong><small>{clientConfigs?.claudeDesktop?.configPath || 'claude_desktop_config.json'} or {clientConfigs?.claudeCode?.configPath || '.mcp.json'}</small></div>
              <button type="button" aria-label="Copy Claude config" disabled={!clientConfigs?.claudeDesktop?.snippet} onClick={() => copyText(clientConfigs?.claudeDesktop?.snippet || '', 'Claude config')}><IconCopy size={13} /> Copy</button>
            </div>
            <pre>{clientConfigs?.claudeDesktop?.snippet || 'Save MCP preferences to generate the installed Bruno command.'}</pre>
          </section>
        </div>
      </div>
    </StyledWrapper>
  );
};

export default Mcp;
