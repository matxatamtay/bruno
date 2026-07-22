import React, { useEffect, useState } from 'react';
import { IconChevronDown, IconChevronRight, IconPlugConnectedX } from '@tabler/icons';
import Modal from 'components/Modal';
import { invokeMcp } from 'hooks/useMcpStatus';
import StyledWrapper from './ConnectionsStyledWrapper';

const MAX_EVENTS = 200;

const formatTime = (isoString) => {
  try {
    return new Date(isoString).toLocaleTimeString();
  } catch (_) {
    return isoString;
  }
};

const ConnectionRow = ({ event }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={`mcp-connection-row ${event.status === 'error' ? 'is-error' : ''}`}>
      <div className="mcp-connection-summary" onClick={() => setExpanded((current) => !current)}>
        {expanded ? <IconChevronDown size={14} strokeWidth={1.5} /> : <IconChevronRight size={14} strokeWidth={1.5} />}
        <span className="mcp-connection-time">{formatTime(event.timestamp)}</span>
        <span className="mcp-connection-tool">{event.tool}</span>
        <span className="mcp-connection-source">{event.source}</span>
        <span className="mcp-connection-duration">{event.durationMs}ms</span>
        <span className={`mcp-connection-status ${event.status}`}>{event.status}</span>
      </div>
      {expanded && (
        <div className="mcp-connection-details">
          <div>
            <div className="mcp-connection-details-label">Request</div>
            <pre>{JSON.stringify(event.request, null, 2)}</pre>
          </div>
          <div>
            <div className="mcp-connection-details-label">{event.status === 'error' ? 'Error' : 'Response'}</div>
            <pre>{JSON.stringify(event.status === 'error' ? event.error : event.response, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
};

const ConnectionsModal = ({ onClose }) => {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    invokeMcp('renderer:mcp-connections').then(setEvents).catch(() => setEvents([]));
    const removeListener = window.ipcRenderer.on('main:mcp-connection-event', (entry) => {
      setEvents((current) => [entry, ...current].slice(0, MAX_EVENTS));
    });
    return () => removeListener?.();
  }, []);

  return (
    <Modal size="xl" title="Bruno MCP Connections" hideFooter handleCancel={onClose}>
      <StyledWrapper>
        {events.length === 0 ? (
          <div className="mcp-connections-empty">
            <IconPlugConnectedX size={40} strokeWidth={1.5} className="empty-icon" />
            <h2 className="text-lg font-medium mt-4">No MCP calls yet</h2>
            <p className="empty-text mt-2">Tool calls from connected AI agents will show up here in real time.</p>
          </div>
        ) : (
          <div className="mcp-connections-list">
            <div className="mcp-connection-row mcp-connection-header">
              <span />
              <span className="mcp-connection-time">Time</span>
              <span className="mcp-connection-tool">Tool</span>
              <span className="mcp-connection-source">Source</span>
              <span className="mcp-connection-duration">Latency</span>
              <span className="mcp-connection-status">Status</span>
            </div>
            {events.map((event) => <ConnectionRow key={event.id} event={event} />)}
          </div>
        )}
      </StyledWrapper>
    </Modal>
  );
};

export default ConnectionsModal;
