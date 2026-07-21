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
    const removeListener = window.ipcRenderer.on('main:mcp-status', (nextStatus) => setStatus(nextStatus));
    return () => removeListener?.();
  }, [refreshStatus]);

  const workspaceText = useMemo(() => (draft.allowedWorkspaces || []).map((workspace) => workspace.path || workspace).join('\n'), [draft.allowedWorkspaces]);
  const hostText = useMemo(() => (draft.allowedHosts || []).join('\n'), [draft.allowedHosts]);

  const setField = (name, value) => setDraft((current) => ({ ...current, [name]: value }));

  const toggleRemoteAccess = (enabled) => {
    if (enabled && !window.confirm('Remote MCP binding can expose Bruno execution tools to your network. Continue only on a trusted network.')) return;
    setField('allowRemote', enabled);
  };

  const save = async () => {
    setSaving(true);
    try {
      const normalized = {
        ...draft,
        host: draft.allowRemote ? String(draft.host || '').trim() : '127.0.0.1',
        port: Number(draft.port) || 3847,
        rateLimitPerMinute: Number(draft.rateLimitPerMinute) || 120,
        requestTimeoutMs: Number(draft.requestTimeoutMs) || 120000,
        allowedWorkspaces: (draft.allowedWorkspaces || []).map((workspace) => typeof workspace === 'string' ? { path: workspace } : workspace),
        allowedHosts: (draft.allowedHosts || []).map((host) => String(host).trim().toLowerCase()).filter(Boolean)
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

  const copyToken = async () => {
    try {
      await navigator.clipboard.writeText(revealedToken);
      toast.success('Token copied');
    } catch (_) {
      toast.error('Unable to copy token');
    }
  };

  return (
    <StyledWrapper>
      <div className="section-header">Bruno MCP</div>
      <p className="mcp-description">Expose Bruno Automation tools to trusted local MCP clients. The server binds to loopback and starts in Read Only mode by default.</p>

      <div className="mcp-card">
        <div className="mcp-row">
          <div>
            <strong>Enable Bruno MCP</strong>
            <small>Starts Streamable HTTP at the configured loopback endpoint.</small>
          </div>
          <ToggleSwitch size="xs" isOn={draft.enabled === true} handleToggle={() => setField('enabled', draft.enabled !== true)} data-testid="mcp-enabled-toggle" />
        </div>
        <div className="mcp-grid">
          <label>
            Host
            <input className="textbox" value={draft.allowRemote ? draft.host || '' : '127.0.0.1'} disabled={!draft.allowRemote} onChange={(event) => setField('host', event.target.value)} />
          </label>
          <label>
            Port
            <input className="textbox" type="number" min="1" max="65535" value={draft.port || 3847} onChange={(event) => setField('port', event.target.value)} />
          </label>
          <label>
            Permission profile
            <select className="textbox" value={draft.permissionProfile || 'read-only'} onChange={(event) => setField('permissionProfile', event.target.value)}>
              <option value="read-only">Read Only</option>
              <option value="runner">Runner</option>
              <option value="editor">Editor</option>
              <option value="full-control">Full Control</option>
            </select>
          </label>
          <label>
            Calls per minute
            <input className="textbox" type="number" min="10" max="10000" value={draft.rateLimitPerMinute || 120} onChange={(event) => setField('rateLimitPerMinute', event.target.value)} />
          </label>
        </div>
        <label className="mcp-block-field">
          Allowed workspace paths, one per line
          <textarea className="textbox" rows={4} value={workspaceText} placeholder="/home/me/projects/api-workspace" onChange={(event) => setField('allowedWorkspaces', splitLines(event.target.value).map((pathname) => ({ path: pathname })))} />
        </label>
        <label className="mcp-block-field">
          Allowed network hosts, one per line
          <textarea className="textbox" rows={4} value={hostText} placeholder={'api.example.com\n*.internal.example.com'} onChange={(event) => setField('allowedHosts', splitLines(event.target.value))} />
        </label>
        <div className="mcp-switches">
          <label><input type="checkbox" checked={draft.auditEnabled !== false} onChange={(event) => setField('auditEnabled', event.target.checked)} /> Write redacted audit log</label>
          <label><input type="checkbox" checked={draft.allowDynamicHosts === true} onChange={(event) => setField('allowDynamicHosts', event.target.checked)} /> Allow dynamic request hosts</label>
          <label><input type="checkbox" checked={draft.allowPrivateHosts === true} onChange={(event) => setField('allowPrivateHosts', event.target.checked)} /> Allow private network hosts</label>
          <label><input type="checkbox" checked={draft.allowRemote === true} onChange={(event) => toggleRemoteAccess(event.target.checked)} /> Advanced: allow non-loopback bind</label>
        </div>
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
          <div><dt>Endpoint</dt><dd>{status?.endpoint || `http://${draft.host || '127.0.0.1'}:${draft.port || 3847}/mcp`}</dd></div>
          <div><dt>Policy</dt><dd>{status?.permissionProfile || draft.permissionProfile || 'read-only'}</dd></div>
          <div><dt>Clients</dt><dd>{status?.connectedClients || 0}</dd></div>
          <div><dt>Binding</dt><dd>{status?.loopbackOnly !== false ? 'Loopback only' : 'Remote enabled'}</dd></div>
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
    </StyledWrapper>
  );
};

export default Mcp;
