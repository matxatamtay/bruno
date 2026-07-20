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
  .run-storage-summary { display: flex; align-items: center; justify-content: flex-end; gap: 7px; flex-wrap: wrap; color: ${(props) => props.theme.colors.text.muted}; }
  .run-storage-summary strong { color: ${(props) => props.theme.text}; font-size: 11px; }
  .run-storage-summary span { padding: 2px 5px; border-radius: 999px; background: ${(props) => props.theme.background.base}; }

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
  .column-title-actions { display: flex; align-items: center; gap: 7px; }
  .noise-toggle { padding: 2px 6px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 999px; background: transparent; color: ${(props) => props.theme.colors.text.muted}; cursor: pointer; font-size: 8px; text-transform: none; letter-spacing: 0; }
  .noise-toggle:hover { color: ${(props) => props.theme.text}; background: ${(props) => props.theme.sidebar.collection.item.hoverBg}; }

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

  .studio-mode-tabs { display: inline-flex; gap: 2px; padding: 3px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 7px; background: ${(props) => props.theme.sidebar.bg}; }
  .studio-mode-tabs button { padding: 5px 9px; border: 0; border-radius: 5px; background: transparent; color: ${(props) => props.theme.colors.text.muted}; cursor: pointer; font-size: 10px; }
  .studio-mode-tabs button.active { color: ${(props) => props.theme.text}; background: ${(props) => props.theme.background.base}; box-shadow: 0 1px 4px rgba(0,0,0,.16); }

  .replay-studio-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(240px, 310px) minmax(0, 1fr); overflow: hidden; }
  .replay-scenario-list { min-width: 0; min-height: 0; overflow: auto; border-right: 1px solid ${(props) => props.theme.border.border1}; background: ${(props) => props.theme.sidebar.bg}; }
  .replay-toolbar { display: flex; flex-wrap: wrap; gap: 6px; padding: 9px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; }
  .replay-scenario-row { width: 100%; display: flex; flex-direction: column; gap: 3px; padding: 9px 11px; border: 0; border-bottom: 1px solid ${(props) => props.theme.border.border1}; background: transparent; color: ${(props) => props.theme.text}; text-align: left; cursor: pointer; }
  .replay-scenario-row:hover { background: ${(props) => props.theme.sidebar.collection.item.hoverBg}; }
  .replay-scenario-row.selected { box-shadow: inset 3px 0 0 ${(props) => props.theme.primary.solid}; background: color-mix(in srgb, ${(props) => props.theme.primary.solid} 10%, transparent); }
  .replay-scenario-row strong { font-size: 11px; }
  .replay-scenario-row span { color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  .replay-editor { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
  .replay-editor-header { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; padding: 9px 11px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; }
  .replay-editor-header input { flex: 1; min-width: 180px; padding: 6px 8px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 5px; background: ${(props) => props.theme.background.base}; color: ${(props) => props.theme.text}; }
  .replay-editor-header select { min-height: 30px; padding: 4px 7px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 5px; background: ${(props) => props.theme.background.base}; color: ${(props) => props.theme.text}; }
  .replay-local-note { padding: 7px 11px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  .replay-divergence { display: flex; align-items: center; gap: 6px; padding: 8px 11px; color: ${(props) => props.theme.colors.text.warning}; background: color-mix(in srgb, ${(props) => props.theme.colors.text.warning} 10%, transparent); border-bottom: 1px solid ${(props) => props.theme.border.border1}; font-size: 10px; }
  .replay-editor-tabs { display: flex; gap: 3px; padding: 6px 10px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; background: ${(props) => props.theme.sidebar.bg}; }
  .replay-editor-tabs button { padding: 5px 9px; border: 1px solid transparent; border-radius: 5px; background: transparent; color: ${(props) => props.theme.colors.text.muted}; cursor: pointer; font-size: 10px; }
  .replay-editor-tabs button.active { border-color: ${(props) => props.theme.border.border1}; background: ${(props) => props.theme.background.base}; color: ${(props) => props.theme.text}; }
  .replay-step-list { flex: 1; min-height: 0; overflow: auto; }
  .replay-step { display: grid; grid-template-columns: 18px auto 24px minmax(0,1fr) auto auto; gap: 8px; align-items: center; padding: 9px 11px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; }
  .replay-step.dragging { opacity: .45; background: color-mix(in srgb, ${(props) => props.theme.primary.solid} 10%, transparent); }
  .replay-drag-handle { color: ${(props) => props.theme.colors.text.muted}; cursor: grab; user-select: none; font-size: 14px; letter-spacing: -3px; }
  .replay-drag-handle:active { cursor: grabbing; }
  .replay-step.broken { background: color-mix(in srgb, ${(props) => props.theme.colors.text.danger} 8%, transparent); }
  .replay-step.stale { box-shadow: inset 3px 0 0 ${(props) => props.theme.colors.text.warning}; }
  .replay-relink { max-width: 180px; min-height: 30px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 5px; background: ${(props) => props.theme.background.base}; color: ${(props) => props.theme.text}; font-size: 9px; }
  .replay-step-index { color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  .replay-step-copy { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .replay-step-copy input { border: 0; background: transparent; color: ${(props) => props.theme.text}; font-weight: 600; font-size: 11px; }
  .replay-step-copy span, .replay-step-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  .replay-attempt-trace { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
  .replay-attempt-trace span { padding: 2px 5px; border-radius: 999px; background: ${(props) => props.theme.background.base}; color: ${(props) => props.theme.colors.text.muted}; font-size: 8px; }
  .replay-attempt-trace span.passed { color: ${(props) => props.theme.colors.text.green}; }
  .replay-attempt-trace span.failed { color: ${(props) => props.theme.colors.text.danger}; }
  .replay-attempt-trace span.waiting { color: ${(props) => props.theme.colors.text.warning}; }
  .replay-policy-row { display: flex; align-items: center; flex-wrap: wrap; gap: 5px 8px; margin-top: 5px; padding: 6px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 5px; background: ${(props) => props.theme.sidebar.bg}; color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  .replay-policy-row label, .replay-policy-row span { display: inline-flex; align-items: center; gap: 4px; }
  .replay-policy-row input[type='number'] { width: 58px; min-width: 0; padding: 3px 4px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 4px; background: ${(props) => props.theme.background.base}; color: ${(props) => props.theme.text}; font-size: 9px; }
  .replay-policy-row select, .replay-condition-path, .replay-condition-value { min-height: 24px; padding: 2px 5px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 4px; background: ${(props) => props.theme.background.base}; color: ${(props) => props.theme.text}; font-size: 9px; }
  .replay-condition-path { width: 120px; }
  .replay-condition-value { width: 85px; }
  .replay-state-inspector { margin-top: 5px; }
  .replay-state-inspector summary { width: fit-content; color: ${(props) => props.theme.primary.solid}; cursor: pointer; font-size: 9px; }
  .replay-state-inspector pre { max-height: 220px; margin-top: 5px; }
  .replay-run-status { min-width: 50px; color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; text-transform: uppercase; }
  .replay-run-status.passed { color: ${(props) => props.theme.colors.text.green}; }
  .replay-run-status.failed, .replay-run-status.missing-link { color: ${(props) => props.theme.colors.text.danger}; }
  .replay-run-summary { flex: 0 0 auto; display: flex; align-items: center; gap: 9px; flex-wrap: wrap; padding: 9px 11px; border-top: 1px solid ${(props) => props.theme.border.border1}; background: ${(props) => props.theme.sidebar.bg}; font-size: 10px; }
  .replay-run-summary span { color: ${(props) => props.theme.colors.text.muted}; }
  .replay-dependency-graph { flex: 1; min-height: 0; overflow: auto; padding: 16px; }
  .replay-graph-nodes { display: flex; align-items: stretch; gap: 8px; overflow-x: auto; padding-bottom: 14px; }
  .replay-graph-sequence-arrow { display: flex; align-items: center; color: ${(props) => props.theme.colors.text.muted}; font-size: 18px; }
  .replay-graph-node { position: relative; min-width: 170px; max-width: 220px; display: flex; flex-direction: column; gap: 4px; padding: 10px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 7px; background: ${(props) => props.theme.sidebar.bg}; box-shadow: 0 4px 12px rgba(0,0,0,.08); }
  .replay-graph-node.authentication { border-color: color-mix(in srgb, ${(props) => props.theme.primary.solid} 55%, ${(props) => props.theme.border.border1}); }
  .replay-graph-node.polling { border-style: dashed; }
  .replay-graph-node.upload { border-color: ${(props) => props.theme.colors.text.warning}; }
  .replay-graph-node strong { font-size: 11px; }
  .replay-graph-node small { color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  .replay-graph-node code { width: fit-content; padding: 2px 5px; border-radius: 999px; background: ${(props) => props.theme.background.base}; color: ${(props) => props.theme.primary.solid}; font-size: 8px; }
  .replay-graph-index { position: absolute; top: -7px; right: -7px; width: 20px; height: 20px; display: inline-flex; align-items: center; justify-content: center; border-radius: 50%; background: ${(props) => props.theme.primary.solid}; color: white; font-size: 9px; }
  .replay-graph-edges { display: flex; flex-direction: column; gap: 6px; padding-top: 12px; border-top: 1px solid ${(props) => props.theme.border.border1}; }
  .replay-graph-edges > strong { font-size: 11px; }
  .replay-graph-edge { display: grid; grid-template-columns: minmax(100px,1fr) auto minmax(100px,1fr) auto; align-items: center; gap: 8px; padding: 7px 9px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 5px; font-size: 9px; }
  .replay-graph-edge code { color: ${(props) => props.theme.primary.solid}; font-weight: 700; }
  .replay-graph-edge small, .replay-graph-empty { color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }

  .intelligence-panel { flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
  .intelligence-toolbar { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 14px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; }
  .intelligence-toolbar > div:first-child { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .intelligence-toolbar strong { font-size: 12px; }
  .intelligence-toolbar span { color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  .intelligence-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: wrap; }
  .intelligence-actions select, .mock-settings select, .mock-settings input, .mock-route select, .mock-route input, .test-data-form input, .test-data-form select, .trace-compare-bar select, .lifecycle-editor select { min-height: 30px; padding: 4px 7px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 5px; background: ${(props) => props.theme.background.base}; color: ${(props) => props.theme.text}; font-size: 9px; }
  .intelligence-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; padding: 10px 14px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; }
  .intelligence-cards > div { display: flex; flex-direction: column; gap: 3px; padding: 9px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 6px; background: ${(props) => props.theme.sidebar.bg}; }
  .intelligence-cards span { color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; text-transform: capitalize; }
  .intelligence-cards strong { font-size: 16px; }
  .intelligence-table { min-height: 0; overflow: auto; }
  .intelligence-row { display: grid; grid-template-columns: minmax(180px, 2fr) minmax(90px, 1fr) minmax(100px, 1fr) 90px auto; gap: 8px; align-items: center; padding: 8px 14px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; font-size: 9px; }
  .intelligence-row.coverage { grid-template-columns: minmax(180px, 2fr) 70px 60px 75px 80px 80px auto; }
  .intelligence-row.header { position: sticky; top: 0; z-index: 2; background: ${(props) => props.theme.sidebar.bg}; color: ${(props) => props.theme.colors.text.muted}; font-weight: 650; text-transform: uppercase; letter-spacing: .03em; }
  .intelligence-row > span:first-child { min-width: 0; display: flex; align-items: center; gap: 6px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .intelligence-row > span:first-child small { color: ${(props) => props.theme.colors.text.warning}; }
  .intel-status { width: fit-content; border-radius: 999px; padding: 2px 6px; background: ${(props) => props.theme.background.base}; text-transform: uppercase; font-size: 8px; }
  .intel-status.current, .intel-status.pass { color: ${(props) => props.theme.colors.text.green}; }
  .intel-status.stale, .intel-status.warning, .intel-status.ambiguous { color: ${(props) => props.theme.colors.text.warning}; }
  .intel-status.broken, .intel-status.missing { color: ${(props) => props.theme.colors.text.danger}; }
  .coverage-dimensions { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 8px 14px; padding: 12px 14px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; }
  .coverage-meter { display: grid; grid-template-columns: 82px minmax(50px, 1fr) 34px; align-items: center; gap: 7px; font-size: 9px; }
  .coverage-meter > div { height: 7px; overflow: hidden; border-radius: 999px; background: ${(props) => props.theme.sidebar.bg}; }
  .coverage-meter i { display: block; height: 100%; border-radius: inherit; background: ${(props) => props.theme.primary.solid}; }
  .coverage-meter strong { text-align: right; }

  .mock-state-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 8px 14px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; font-size: 9px; }
  .mock-state-bar code { padding: 3px 6px; border-radius: 4px; background: ${(props) => props.theme.sidebar.bg}; user-select: all; }
  .mock-settings { display: flex; align-items: flex-end; gap: 10px; flex-wrap: wrap; padding: 9px 14px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; }
  .mock-settings label { display: flex; flex-direction: column; gap: 4px; color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  .mock-settings input { min-width: 280px; }
  .mock-route-list { min-height: 100px; max-height: 42%; overflow: auto; border-bottom: 1px solid ${(props) => props.theme.border.border1}; }
  .mock-route { display: grid; grid-template-columns: minmax(220px, 2fr) minmax(100px, 1fr) 150px minmax(80px, .7fr) auto; gap: 7px; align-items: center; padding: 7px 14px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; font-size: 9px; }
  .mock-route label { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .mock-route code { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mock-log { flex: 1; min-height: 150px; overflow: auto; }
  .mock-log > div:not(.column-title):not(.empty-state) { display: grid; grid-template-columns: 75px minmax(180px, 1fr) 80px minmax(120px, 1fr); gap: 8px; padding: 6px 14px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; font-size: 9px; }
  .mock-log small { color: ${(props) => props.theme.colors.text.muted}; }

  .test-data-layout, .trace-layout { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(230px, 300px) minmax(0, 1fr); overflow: hidden; }
  .intelligence-sidebar { min-width: 0; min-height: 0; overflow: auto; border-right: 1px solid ${(props) => props.theme.border.border1}; background: ${(props) => props.theme.sidebar.bg}; }
  .test-data-editor, .trace-viewer { min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: auto; }
  .test-data-form { display: grid; grid-template-columns: repeat(3, minmax(120px, 1fr)); gap: 10px; padding: 12px 14px; }
  .test-data-form label { display: flex; flex-direction: column; gap: 4px; color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  .test-data-form .wide { grid-column: 1 / -1; }
  .test-data-form textarea { width: 100%; min-height: 140px; resize: vertical; padding: 8px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 5px; background: ${(props) => props.theme.background.base}; color: ${(props) => props.theme.text}; font-family: monospace; font-size: 10px; }
  .lifecycle-editor { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 6px; }
  .lifecycle-editor > div, .lifecycle-editor section { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .lifecycle-editor section > span { min-width: 55px; color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  .lifecycle-editor section button { border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 999px; padding: 3px 7px; background: transparent; color: ${(props) => props.theme.text}; cursor: pointer; font-size: 9px; }
  .test-data-inline-actions { display: flex; align-items: center; gap: 6px; margin-bottom: 5px; }
  .fixture-editor { display: flex; flex-direction: column; gap: 7px; padding: 10px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 6px; }
  .fixture-editor > div { display: grid; grid-template-columns: minmax(150px, 1fr) 140px auto; gap: 7px; }
  .fixture-editor textarea { min-height: 90px; }
  .fixture-editor section { display: flex; flex-direction: column; gap: 4px; }
  .fixture-editor section > span { display: grid; grid-template-columns: minmax(120px, 1fr) minmax(110px, auto) auto; gap: 7px; align-items: center; padding: 5px 7px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 5px; }
  .fixture-editor small { color: ${(props) => props.theme.colors.text.muted}; font-size: 8px; }
  .mock-checkbox { flex-direction: row !important; align-items: center; padding-bottom: 6px; }

  .trace-compare-bar { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; padding: 8px 12px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; }
  .trace-compare-bar span { color: ${(props) => props.theme.colors.text.warning}; font-size: 9px; }
  .trace-grid { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(220px, 290px) minmax(0, 1fr); overflow: hidden; }
  .trace-timeline { min-height: 0; overflow: auto; border-right: 1px solid ${(props) => props.theme.border.border1}; }
  .trace-timeline > button { width: 100%; display: grid; grid-template-columns: 24px minmax(0, 1fr); gap: 3px 7px; padding: 8px 10px; border: 0; border-bottom: 1px solid ${(props) => props.theme.border.border1}; background: transparent; color: ${(props) => props.theme.text}; text-align: left; cursor: pointer; }
  .trace-timeline > button.selected { box-shadow: inset 3px 0 0 ${(props) => props.theme.primary.solid}; background: color-mix(in srgb, ${(props) => props.theme.primary.solid} 10%, transparent); }
  .trace-timeline > button > span { grid-row: 1 / 3; color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  .trace-timeline strong { font-size: 10px; }
  .trace-timeline small { color: ${(props) => props.theme.colors.text.muted}; font-size: 8px; }
  .trace-inspector { min-width: 0; min-height: 0; overflow: auto; padding: 12px; }
  .trace-inspector-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
  .trace-inspector-header > div { display: flex; flex-direction: column; }
  .trace-inspector-header span { color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  .trace-section { display: flex; flex-direction: column; gap: 5px; margin-bottom: 10px; }
  .trace-section > strong { font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
  .trace-section textarea { min-height: 80px; resize: vertical; padding: 8px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: 5px; background: ${(props) => props.theme.background.base}; color: ${(props) => props.theme.text}; font-family: monospace; font-size: 10px; }
  .trace-revision-warning { margin-bottom: 10px; padding: 8px; border: 1px solid ${(props) => props.theme.colors.text.warning}; border-radius: 5px; color: ${(props) => props.theme.colors.text.warning}; font-size: 9px; }
  .trace-attempt { margin-bottom: 7px; }
  .trace-attempt > span { display: block; margin-bottom: 4px; color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }

  @media (max-width: 1200px) {
    .recorder-header { align-items: flex-start; flex-wrap: wrap; }
    .studio-mode-tabs { max-width: 100%; overflow-x: auto; }
    .intelligence-row.coverage { grid-template-columns: minmax(180px, 2fr) 60px 50px 65px 75px auto; }
    .intelligence-row.coverage > span:nth-child(6) { display: none; }
  }

  @media (max-width: 1050px) {
    .recorder-grid { grid-template-columns: minmax(230px, 300px) minmax(360px, 1fr); }
    .details-column { display: none; }
  }
`;

export default StyledWrapper;
