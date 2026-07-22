import React, { useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import find from 'lodash/find';
import toast from 'react-hot-toast';
import { IconPlayerPlay, IconPlayerStop, IconRefresh, IconSettings, IconListDetails } from '@tabler/icons';
import Dropdown from 'components/Dropdown';
import Portal from 'components/Portal';
import { addTab } from 'providers/ReduxStore/slices/tabs';
import { savePreferences, updateActivePreferencesTab } from 'providers/ReduxStore/slices/app';
import useMcpStatus, { invokeMcp } from 'hooks/useMcpStatus';
import ConnectionsModal from './ConnectionsModal';
import StyledWrapper from './StyledWrapper';

const STATE_LABEL = { running: 'Running', restarting: 'Restarting…', stopped: 'Stopped' };

const McpStatus = () => {
  const dispatch = useDispatch();
  const { status } = useMcpStatus();
  const preferences = useSelector((state) => state.app.preferences);
  const tabs = useSelector((state) => state.tabs.tabs);
  const activeTabUid = useSelector((state) => state.tabs.activeTabUid);
  const activeTab = find(tabs, (t) => t.uid === activeTabUid);
  const activeWorkspaceUid = useSelector((state) => state.workspaces.activeWorkspaceUid);
  const workspaces = useSelector((state) => state.workspaces.workspaces);
  const activeWorkspace = workspaces.find((w) => w.uid === activeWorkspaceUid);

  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dropdownTippyRef = useRef(null);
  const onDropdownCreate = (ref) => (dropdownTippyRef.current = ref);
  const closeMenu = () => dropdownTippyRef.current?.hide();

  const state = status?.state || 'stopped';
  const enabled = status?.enabled ?? false;
  const canAct = !busy && state !== 'restarting';

  const setEnabled = async (nextEnabled) => {
    closeMenu();
    setBusy(true);
    try {
      await dispatch(savePreferences({ ...preferences, mcp: { ...(preferences.mcp || {}), enabled: nextEnabled } }));
      toast.success(nextEnabled ? 'Bruno MCP starting' : 'Bruno MCP stopped');
    } catch (error) {
      toast.error(error.message || 'Unable to update Bruno MCP');
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    closeMenu();
    setBusy(true);
    try {
      await invokeMcp('renderer:mcp-restart');
      toast.success('Bruno MCP restarted');
    } catch (error) {
      toast.error(error.message || 'Unable to restart Bruno MCP');
    } finally {
      setBusy(false);
    }
  };

  const openSettings = () => {
    closeMenu();
    const collectionUid = activeTab?.collectionUid || activeWorkspace?.scratchCollectionUid;
    dispatch(updateActivePreferencesTab({ tab: 'mcp' }));
    dispatch(addTab({
      type: 'preferences',
      uid: collectionUid ? `${collectionUid}-preferences` : 'preferences',
      collectionUid
    }));
  };

  const openConnections = () => {
    closeMenu();
    setConnectionsOpen(true);
  };

  return (
    <StyledWrapper>
      {connectionsOpen && (
        <Portal>
          <ConnectionsModal onClose={() => setConnectionsOpen(false)} />
        </Portal>
      )}

      <Dropdown
        onCreate={onDropdownCreate}
        placement="top-end"
        icon={(
          <button
            className="status-bar-button mcp-status-trigger"
            data-trigger="mcp"
            tabIndex={0}
            aria-label={`Bruno MCP: ${STATE_LABEL[state]}`}
          >
            <div className="console-button-content">
              <span className={`mcp-status-dot mcp-status-${state}`} aria-hidden="true" />
              <span className="console-label">MCP</span>
            </div>
          </button>
        )}
      >
        <div className="mcp-status-menu-header">
          <span className={`mcp-status-dot mcp-status-${state}`} aria-hidden="true" />
          <span>{STATE_LABEL[state]}</span>
        </div>
        {status?.endpoint && <div className="mcp-status-menu-endpoint">{status.endpoint}</div>}

        {enabled ? (
          <div className={`dropdown-item border-top ${!canAct ? 'disabled' : ''}`} onClick={() => canAct && setEnabled(false)}>
            <IconPlayerStop size={14} strokeWidth={1.5} className="dropdown-icon" /> Stop
          </div>
        ) : (
          <div className={`dropdown-item border-top ${!canAct ? 'disabled' : ''}`} onClick={() => canAct && setEnabled(true)}>
            <IconPlayerPlay size={14} strokeWidth={1.5} className="dropdown-icon" /> Start
          </div>
        )}
        {enabled && (
          <div className={`dropdown-item ${!canAct ? 'disabled' : ''}`} onClick={() => canAct && restart()}>
            <IconRefresh size={14} strokeWidth={1.5} className="dropdown-icon" /> Restart
          </div>
        )}

        <div className="dropdown-item border-top" onClick={openSettings}>
          <IconSettings size={14} strokeWidth={1.5} className="dropdown-icon" /> Settings
        </div>
        <div className="dropdown-item" onClick={openConnections}>
          <IconListDetails size={14} strokeWidth={1.5} className="dropdown-icon" /> Connections
          {status?.connectedClients > 0 && <span className="dropdown-tab-count">{status.connectedClients}</span>}
        </div>
      </Dropdown>
    </StyledWrapper>
  );
};

export default McpStatus;
