import styled from 'styled-components';

const StyledWrapper = styled.div`
  width: 100%;
  max-width: 860px;
  color: ${(props) => props.theme.text};

  .mcp-description { color: ${(props) => props.theme.colors.text.muted}; margin-bottom: 14px; }
  .mcp-card { border: 1px solid ${(props) => props.theme.input.border}; border-radius: ${(props) => props.theme.border.radius.md}; background: ${(props) => props.theme.input.bg}; padding: 14px; margin-bottom: 14px; }
  .mcp-row, .mcp-status-heading { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
  .mcp-row small, .mcp-status-heading small { display: block; margin-top: 3px; color: ${(props) => props.theme.colors.text.muted}; }
  .mcp-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; font-weight: 500; }
  textarea { resize: vertical; min-height: 72px; font-family: ${(props) => props.theme.font.monospace || 'monospace'}; }
  select.textbox { appearance: auto; }
  .mcp-block-field { margin-top: 12px; }
  .mcp-switches { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 16px; margin: 14px 0; }
  .mcp-switches label { flex-direction: row; align-items: center; font-weight: 400; color: ${(props) => props.theme.colors.text.muted}; }
  .mcp-primary { padding: 6px 12px; border-radius: ${(props) => props.theme.border.radius.sm}; border: 1px solid ${(props) => props.theme.colors.accent}; background: ${(props) => props.theme.colors.accent}; color: white; cursor: pointer; }
  .mcp-primary:disabled { opacity: .5; cursor: wait; }
  .mcp-icon-button { border: 0; background: transparent; color: ${(props) => props.theme.colors.text.muted}; cursor: pointer; padding: 5px; }
  .online { color: ${(props) => props.theme.colors.text.green} !important; }
  .offline { color: ${(props) => props.theme.colors.text.muted}; }
  .mcp-status-list { margin: 12px 0; }
  .mcp-status-list > div { display: grid; grid-template-columns: 110px 1fr; gap: 8px; padding: 5px 0; border-top: 1px dashed ${(props) => props.theme.input.border}; }
  .mcp-status-list dt { color: ${(props) => props.theme.colors.text.muted}; }
  .mcp-status-list dd { margin: 0; font-family: ${(props) => props.theme.font.monospace || 'monospace'}; overflow-wrap: anywhere; }
  .mcp-actions { display: flex; gap: 8px; }
  .mcp-actions button, .mcp-token button { display: inline-flex; align-items: center; gap: 5px; padding: 5px 9px; border: 1px solid ${(props) => props.theme.input.border}; border-radius: ${(props) => props.theme.border.radius.sm}; background: transparent; color: inherit; cursor: pointer; }
  .mcp-token { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 8px; margin-top: 12px; padding: 9px; border: 1px solid ${(props) => props.theme.colors.accent}55; border-radius: ${(props) => props.theme.border.radius.sm}; }
  .mcp-token code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mcp-error { padding: 8px; margin-bottom: 8px; color: ${(props) => props.theme.colors.text.danger}; background: ${(props) => props.theme.colors.bg.danger}15; border-radius: ${(props) => props.theme.border.radius.sm}; }

  @media (max-width: 760px) {
    .mcp-grid, .mcp-switches { grid-template-columns: 1fr; }
    .mcp-token { grid-template-columns: 1fr; }
  }
`;

export default StyledWrapper;
