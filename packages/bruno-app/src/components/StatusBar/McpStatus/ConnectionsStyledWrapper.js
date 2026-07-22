import styled from 'styled-components';

const StyledWrapper = styled.div`
  .mcp-connections-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    padding: 48px 16px;
    text-align: center;
    color: ${(props) => props.theme.colors.text.muted};
  }
  .mcp-connections-empty .empty-icon { opacity: 0.6; }
  .mcp-connections-list { max-height: 65vh; overflow-y: auto; }
  .mcp-connection-row {
    display: grid;
    grid-template-columns: 18px 90px 1fr 150px 70px 70px;
    align-items: center;
    gap: 8px;
    padding: 6px 4px;
    border-top: 1px solid ${(props) => props.theme.input.border};
    font-size: ${(props) => props.theme.font.size.sm};
  }
  .mcp-connection-header {
    border-top: none;
    font-weight: 600;
    color: ${(props) => props.theme.colors.text.muted};
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  .mcp-connection-summary {
    display: contents;
    cursor: pointer;
  }
  .mcp-connection-row.is-error { background: ${(props) => props.theme.colors.bg.danger}0d; }
  .mcp-connection-tool { font-family: ${(props) => props.theme.font.monospace || 'monospace'}; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mcp-connection-source, .mcp-connection-time, .mcp-connection-duration { color: ${(props) => props.theme.colors.text.muted}; white-space: nowrap; }
  .mcp-connection-status { text-transform: capitalize; }
  .mcp-connection-status.success { color: ${(props) => props.theme.colors.text.green}; }
  .mcp-connection-status.error { color: ${(props) => props.theme.colors.text.danger}; }
  .mcp-connection-details {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    padding: 8px 4px 12px 26px;
  }
  .mcp-connection-details-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.02em;
    color: ${(props) => props.theme.colors.text.muted};
    margin-bottom: 4px;
  }
  .mcp-connection-details pre {
    max-height: 260px;
    margin: 0;
    padding: 8px;
    overflow: auto;
    border-radius: ${(props) => props.theme.border.radius.sm};
    background: ${(props) => props.theme.codemirror?.bg || props.theme.input.bg};
    color: inherit;
    font-size: 11px;
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  @media (max-width: 760px) {
    .mcp-connection-row { grid-template-columns: 18px 70px 1fr 60px 60px; }
    .mcp-connection-source { display: none; }
    .mcp-connection-details { grid-template-columns: 1fr; }
  }
`;

export default StyledWrapper;
