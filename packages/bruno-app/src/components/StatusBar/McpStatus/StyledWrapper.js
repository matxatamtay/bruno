import styled from 'styled-components';

const StyledWrapper = styled.div`
  display: flex;
  align-items: center;

  .mcp-status-dot {
    display: inline-block;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: ${(props) => props.theme.colors.text.muted};
  }
  .mcp-status-dot.mcp-status-running { background: ${(props) => props.theme.colors.text.green}; }
  .mcp-status-dot.mcp-status-restarting {
    background: ${(props) => props.theme.colors.text.warning || props.theme.colors.text.muted};
    animation: mcp-status-pulse 1.2s ease-in-out infinite;
  }
  .mcp-status-dot.mcp-status-stopped { background: ${(props) => props.theme.colors.text.muted}; }

  @keyframes mcp-status-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.35; }
  }

  .mcp-status-menu-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0.375rem 0.625rem 0.125rem 0.625rem;
    font-weight: 600;
  }
  .mcp-status-menu-endpoint {
    padding: 0 0.625rem 0.375rem 0.625rem;
    font-size: 11px;
    font-family: ${(props) => props.theme.font.monospace || 'monospace'};
    color: ${(props) => props.theme.colors.text.muted};
    word-break: break-all;
  }
`;

export default StyledWrapper;
