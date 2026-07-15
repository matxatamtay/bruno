import styled from 'styled-components';

const StyledWrapper = styled.div`
  height: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  color: ${(props) => props.theme.text};
  background: ${(props) => props.theme.background.base};

  button, select { font: inherit; }

  .recorder-header {
    flex: 0 0 auto;
    min-height: 58px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 14px;
    border-bottom: 1px solid ${(props) => props.theme.border.border1};
  }

  .title-block, .header-actions, .session-controls, .pairing-row, .detail-tabs, .status-line {
    display: flex;
    align-items: center;
  }

  .title-block { gap: 9px; min-width: 0; }
  .title-copy { min-width: 0; display: flex; flex-direction: column; }
  .title-copy strong { font-size: 13px; }
  .title-copy span { color: ${(props) => props.theme.colors.text.muted}; font-size: 10px; }
  .header-actions { gap: 7px; flex-wrap: wrap; justify-content: flex-end; }

  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 30px;
    padding: 5px 9px;
    border: 1px solid ${(props) => props.theme.border.border1};
    border-radius: ${(props) => props.theme.border.radius.base};
    background: transparent;
    color: ${(props) => props.theme.text};
    cursor: pointer;
  }
  .button:hover:not(:disabled) { background: ${(props) => props.theme.sidebar.collection.item.hoverBg}; }
  .button:disabled { opacity: .45; cursor: default; }
  .button.primary { border-color: ${(props) => props.theme.primary.solid}; background: ${(props) => props.theme.primary.solid}; color: white; }
  .button.danger { border-color: ${(props) => props.theme.colors.text.danger}; color: ${(props) => props.theme.colors.text.danger}; }

  .session-select {
    max-width: 220px;
    min-height: 30px;
    border: 1px solid ${(props) => props.theme.border.border1};
    border-radius: ${(props) => props.theme.border.radius.base};
    background: ${(props) => props.theme.background.base};
    color: ${(props) => props.theme.text};
    padding: 4px 8px;
  }

  .pairing-bar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    min-height: 42px;
    padding: 6px 14px;
    border-bottom: 1px solid ${(props) => props.theme.border.border1};
    background: ${(props) => props.theme.sidebar.bg};
    font-size: 10px;
  }
  .pairing-row { min-width: 0; gap: 8px; }
  .pairing-row code { padding: 3px 6px; border-radius: 4px; background: ${(props) => props.theme.background.base}; user-select: all; }
  .pairing-token { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pairing-help { color: ${(props) => props.theme.colors.text.muted}; }

  .recorder-grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(260px, 330px) minmax(360px, 1fr) minmax(340px, 430px);
    overflow: hidden;
  }
  .timeline-column, .viewport-column, .details-column { min-width: 0; min-height: 0; overflow: hidden; }
  .timeline-column, .details-column { display: flex; flex-direction: column; background: ${(props) => props.theme.sidebar.bg}; }
  .timeline-column { border-right: 1px solid ${(props) => props.theme.border.border1}; }
  .details-column { border-left: 1px solid ${(props) => props.theme.border.border1}; }

  .column-title {
    flex: 0 0 auto;
    height: 36px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    border-bottom: 1px solid ${(props) => props.theme.border.border1};
    font-size: 11px;
    font-weight: 650;
    text-transform: uppercase;
    letter-spacing: .04em;
  }
  .column-title small { color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; text-transform: none; }

  .timeline-list, .details-scroll { flex: 1; min-height: 0; overflow: auto; }
  .timeline-row {
    width: 100%;
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) auto;
    gap: 7px;
    align-items: start;
    padding: 8px 9px;
    border: 0;
    border-bottom: 1px solid ${(props) => props.theme.border.border1};
    background: transparent;
    color: ${(props) => props.theme.text};
    text-align: left;
    cursor: pointer;
  }
  .timeline-row:hover { background: ${(props) => props.theme.sidebar.collection.item.hoverBg}; }
  .timeline-row.selected { box-shadow: inset 3px 0 0 ${(props) => props.theme.primary.solid}; background: color-mix(in srgb, ${(props) => props.theme.primary.solid} 12%, transparent); }
  .timeline-row.error { box-shadow: inset 3px 0 0 ${(props) => props.theme.colors.text.danger}; }
  .step-index { color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; padding-top: 2px; }
  .step-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .step-copy strong, .step-copy span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .step-copy strong { font-size: 11px; font-weight: 550; }
  .step-copy span, .step-time { color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  .step-badge { display: inline-flex; align-items: center; width: fit-content; border-radius: 999px; padding: 1px 5px; font-size: 8px; text-transform: uppercase; background: ${(props) => props.theme.background.base}; }
  .step-badge.error { color: ${(props) => props.theme.colors.text.danger}; }

  .viewport-column { display: flex; flex-direction: column; background: color-mix(in srgb, ${(props) => props.theme.background.base} 92%, black); }
  .viewport-stage { flex: 1; min-height: 0; overflow: auto; display: flex; align-items: center; justify-content: center; padding: 18px; }
  .screenshot { max-width: 100%; max-height: 100%; object-fit: contain; border-radius: 6px; box-shadow: 0 10px 38px rgba(0,0,0,.28); }
  .empty-state { flex: 1; min-height: 150px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; color: ${(props) => props.theme.colors.text.muted}; text-align: center; padding: 20px; }
  .empty-state strong { color: ${(props) => props.theme.text}; font-size: 12px; }
  .empty-state span { max-width: 360px; font-size: 10px; line-height: 1.5; }

  .detail-tabs { flex: 0 0 auto; height: 34px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; overflow-x: auto; }
  .detail-tab { height: 100%; padding: 0 10px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: ${(props) => props.theme.colors.text.muted}; cursor: pointer; }
  .detail-tab.active { color: ${(props) => props.theme.text}; border-bottom-color: ${(props) => props.theme.primary.solid}; }
  .details-scroll { padding: 10px; }
  .detail-section { margin-bottom: 13px; }
  .detail-section h4 { margin: 0 0 6px; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
  .status-line { gap: 7px; flex-wrap: wrap; font-size: 10px; }
  .status-code { border-radius: 999px; padding: 2px 7px; background: ${(props) => props.theme.background.base}; }
  .status-code.error { color: ${(props) => props.theme.colors.text.danger}; }
  pre { max-width: 100%; overflow: auto; margin: 0; padding: 9px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 5px; background: ${(props) => props.theme.background.base}; color: ${(props) => props.theme.text}; font-size: 10px; line-height: 1.45; white-space: pre-wrap; word-break: break-word; }
  .url { color: ${(props) => props.theme.colors.text.muted}; word-break: break-all; font-size: 10px; }
  .match-card { padding: 8px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 6px; background: ${(props) => props.theme.background.base}; }
  .match-card strong { display: block; margin-bottom: 3px; font-size: 11px; }
  .match-card span { display: block; color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; margin-bottom: 7px; }

  @media (max-width: 1050px) {
    .recorder-grid { grid-template-columns: minmax(230px, 300px) minmax(360px, 1fr); }
    .details-column { display: none; }
  }
`;

export default StyledWrapper;
