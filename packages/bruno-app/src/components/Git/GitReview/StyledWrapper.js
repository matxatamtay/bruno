import styled, { keyframes } from 'styled-components';
import { rgba } from 'polished';

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const StyledWrapper = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  color: ${(props) => props.theme.text};
  background: ${(props) => props.theme.background.base};

  .spin { animation: ${spin} 0.8s linear infinite; }

  .git-review-header {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 52px;
    padding: 8px 14px;
    border-bottom: 1px solid ${(props) => props.theme.border.border1};
  }

  .branch-copy {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;

    > div {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    strong { font-size: 13px; }
    span {
      color: ${(props) => props.theme.colors.text.muted};
      font-size: 10px;
    }
  }

  .refresh-button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 5px 9px;
    border: 1px solid ${(props) => props.theme.border.border1};
    border-radius: ${(props) => props.theme.border.radius.base};
    background: transparent;
    color: ${(props) => props.theme.text};
    font-size: 11px;
    cursor: pointer;

    &:hover:not(:disabled) { background: ${(props) => props.theme.sidebar.collection.item.hoverBg}; }
    &:disabled { opacity: 0.55; cursor: wait; }
  }

  .git-review-grid {
    flex: 1;
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(230px, 0.8fr) minmax(270px, 1fr) minmax(440px, 2.3fr);
    overflow: hidden;
  }

  .commit-column,
  .tree-column,
  .diff-column {
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .commit-column,
  .tree-column {
    display: flex;
    flex-direction: column;
    border-right: 1px solid ${(props) => props.theme.border.border1};
    background: ${(props) => props.theme.sidebar.bg};
  }

  .column-title {
    flex: 0 0 auto;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 10px;
    border-bottom: 1px solid ${(props) => props.theme.border.border1};
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;

    small {
      color: ${(props) => props.theme.colors.text.muted};
      font-size: 10px;
      font-weight: 500;
    }
  }

  .commit-list,
  .tree-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }

  .commit-row {
    position: relative;
    width: 100%;
    display: flex;
    gap: 9px;
    padding: 9px 10px;
    border: 0;
    border-bottom: 1px solid ${(props) => props.theme.border.border1};
    background: transparent;
    color: ${(props) => props.theme.text};
    text-align: left;
    cursor: pointer;

    &:hover { background: ${(props) => props.theme.sidebar.collection.item.hoverBg}; }
    &.selected {
      background: ${(props) => rgba(props.theme.primary.solid, 0.14)};
      box-shadow: inset 3px 0 0 ${(props) => props.theme.primary.solid};
    }
  }

  .commit-dot {
    width: 8px;
    height: 8px;
    margin-top: 4px;
    border: 2px solid ${(props) => props.theme.primary.solid};
    border-radius: 50%;
    flex: 0 0 auto;
  }

  .commit-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;

    strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 12px;
      font-weight: 500;
    }

    span, code {
      color: ${(props) => props.theme.colors.text.muted};
      font-size: 9px;
    }
    code { font-family: 'Fira Code', monospace; }
  }

  .request-tree {
    flex: 1;
    min-height: 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .tree-scroll {
    width: 100%;
    overscroll-behavior: contain;
    scrollbar-gutter: stable;
  }

  .tree-column > .loading-state,
  .tree-column > .empty-state {
    flex: 1;
    min-height: 0;
  }

  .tree-row {
    width: 100%;
    min-height: 28px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding-top: 3px;
    padding-right: 8px;
    padding-bottom: 3px;
    border: 0;
    background: transparent;
    color: ${(props) => props.theme.text};
    text-align: left;
    font-size: 11px;

    &:not(:disabled) { cursor: pointer; }
    &:hover:not(:disabled) { background: ${(props) => props.theme.sidebar.collection.item.hoverBg}; }
    &:disabled { opacity: 0.56; }

    .expanded { transform: rotate(90deg); }
  }

  .tree-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .folder-row.has-changes {
    color: ${(props) => props.theme.colors.text.warning};
    background: color-mix(in srgb, ${(props) => props.theme.colors.text.warning} 8%, transparent);
  }

  .folder-count,
  .change-badge {
    min-width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 999px;
    font-size: 9px;
    font-weight: 700;
  }

  .folder-count {
    background: color-mix(in srgb, ${(props) => props.theme.colors.text.warning} 16%, transparent);
    color: ${(props) => props.theme.colors.text.warning};
  }

  .request-row.changed,
  .raw-file-row {
    opacity: 1;
    font-weight: 500;
    box-shadow: inset 3px 0 0 currentColor;
  }

  .request-row.changed.modified,
  .raw-file-row.modified {
    color: ${(props) => props.theme.colors.text.warning};
    background: color-mix(in srgb, ${(props) => props.theme.colors.text.warning} 12%, transparent);
  }
  .request-row.changed.added,
  .raw-file-row.added {
    color: ${(props) => props.theme.colors.text.green};
    background: color-mix(in srgb, ${(props) => props.theme.colors.text.green} 12%, transparent);
  }
  .request-row.changed.deleted,
  .raw-file-row.deleted {
    color: ${(props) => props.theme.colors.text.danger};
    background: color-mix(in srgb, ${(props) => props.theme.colors.text.danger} 12%, transparent);
  }
  .request-row.changed.renamed,
  .raw-file-row.renamed {
    color: ${(props) => props.theme.primary.solid};
    background: ${(props) => rgba(props.theme.primary.solid, 0.12)};
  }

  .request-row.selected,
  .raw-file-row.selected {
    outline: 1px solid currentColor;
    outline-offset: -1px;
    filter: saturate(1.35) brightness(1.08);
  }

  .change-badge {
    color: currentColor;
    border: 1px solid currentColor;
    background: ${(props) => props.theme.background.base};
  }

  .unmatched-section {
    margin-top: 8px;
    border-top: 1px solid ${(props) => props.theme.border.border1};
  }
  .unmatched-title {
    padding: 8px 10px 5px;
    color: ${(props) => props.theme.colors.text.muted};
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .raw-file-row { padding-left: 12px; }

  .loading-state,
  .empty-state,
  .diff-empty {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 100px;
    padding: 16px;
    color: ${(props) => props.theme.colors.text.muted};
    font-size: 11px;
    text-align: center;
  }

  .diff-column { display: flex; flex-direction: column; background: ${(props) => props.theme.background.base}; }
  .request-diff { flex: 1; min-height: 0; display: flex; flex-direction: column; min-width: 0; }

  .semantic-loading { display: flex; align-items: center; gap: 7px; padding: 9px 12px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; color: ${(props) => props.theme.colors.text.muted}; font-size: 11px; }
  .semantic-review { flex: 0 0 auto; max-height: 42%; display: flex; flex-direction: column; border-bottom: 1px solid ${(props) => props.theme.border.border1}; background: ${(props) => props.theme.sidebar.bg}; }
  .semantic-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 10px; }
  .semantic-header > div { display: flex; flex-direction: column; }
  .semantic-header strong { font-size: 12px; }
  .semantic-header span { color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  .run-affected { display: inline-flex; align-items: center; gap: 5px; padding: 5px 8px; border: 1px solid ${(props) => props.theme.primary.solid}; border-radius: ${(props) => props.theme.border.radius.base}; background: ${(props) => rgba(props.theme.primary.solid, 0.12)}; color: ${(props) => props.theme.primary.solid}; font-size: 10px; cursor: pointer; }
  .semantic-summary { display: flex; flex-wrap: wrap; gap: 6px; padding: 0 10px 8px; }
  .semantic-summary span { padding: 3px 7px; border: 1px solid currentColor; border-radius: 999px; font-size: 9px; }
  .semantic-summary b { font-size: 10px; }
  .semantic-summary .breaking, .semantic-finding.breaking { color: ${(props) => props.theme.colors.text.danger}; }
  .semantic-summary .warning, .semantic-finding.warning { color: ${(props) => props.theme.colors.text.warning}; }
  .semantic-summary .secret, .semantic-finding.secret { color: ${(props) => props.theme.colors.text.danger}; }
  .semantic-summary .affected, .semantic-finding.info { color: ${(props) => props.theme.primary.solid}; }
  .semantic-findings { overflow: auto; border-top: 1px solid ${(props) => props.theme.border.border1}; }
  .semantic-finding { width: 100%; display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border: 0; border-bottom: 1px solid ${(props) => props.theme.border.border1}; background: transparent; text-align: left; cursor: pointer; }
  .semantic-finding:hover { background: ${(props) => props.theme.sidebar.collection.item.hoverBg}; }
  .semantic-finding > span { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .semantic-finding strong { color: currentColor; font-size: 10px; }
  .semantic-finding small { color: ${(props) => props.theme.text}; font-size: 10px; }
  .semantic-finding code { color: ${(props) => props.theme.colors.text.muted}; font-size: 8px; }
  .semantic-clean, .semantic-partial { padding: 8px 10px; color: ${(props) => props.theme.colors.text.muted}; font-size: 10px; }
  .semantic-partial { color: ${(props) => props.theme.colors.text.warning}; }
  .request-row.impacted { opacity: 1; color: ${(props) => props.theme.primary.solid}; background: ${(props) => rgba(props.theme.primary.solid, 0.08)}; }
  .impact-badge { font-size: 11px; }

  .environment-matrix-wrap { border-top: 1px solid ${(props) => props.theme.border.border1}; }
  .environment-matrix-title { padding: 6px 10px 4px; color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; font-weight: 600; text-transform: uppercase; }
  .environment-matrix-scroll { overflow: auto; max-height: 130px; }
  .environment-matrix { width: 100%; border-collapse: collapse; font-size: 9px; }
  .environment-matrix th, .environment-matrix td { padding: 4px 7px; border-top: 1px solid ${(props) => props.theme.border.border1}; text-align: center; white-space: nowrap; }
  .environment-matrix th:first-child, .environment-matrix td:first-child { position: sticky; left: 0; z-index: 1; background: ${(props) => props.theme.sidebar.bg}; text-align: left; }
  .environment-matrix .present { color: ${(props) => props.theme.colors.text.green}; }
  .environment-matrix .missing { color: ${(props) => props.theme.colors.text.danger}; }

  .run-affected-backdrop { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(0, 0, 0, 0.55); }
  .run-affected-modal { width: min(620px, 100%); max-height: min(720px, 90vh); display: flex; flex-direction: column; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: ${(props) => props.theme.border.radius.base}; background: ${(props) => props.theme.background.base}; box-shadow: 0 20px 70px rgba(0, 0, 0, 0.35); }
  .run-modal-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 14px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; }
  .run-modal-header > div { display: flex; flex-direction: column; gap: 2px; }
  .run-modal-header strong { font-size: 14px; }
  .run-modal-header span { color: ${(props) => props.theme.colors.text.muted}; font-size: 10px; }
  .run-modal-header button { border: 0; background: transparent; color: ${(props) => props.theme.text}; cursor: pointer; }
  .run-env-field { display: flex; flex-direction: column; gap: 5px; padding: 12px 14px; }
  .run-env-field > span { color: ${(props) => props.theme.colors.text.muted}; font-size: 10px; font-weight: 600; }
  .run-env-field select { padding: 7px 9px; border: 1px solid ${(props) => props.theme.border.border1}; border-radius: ${(props) => props.theme.border.radius.base}; background: ${(props) => props.theme.sidebar.bg}; color: ${(props) => props.theme.text}; font-size: 11px; }
  .run-modal-tools { display: flex; align-items: center; gap: 7px; padding: 0 14px 9px; }
  .run-modal-tools button { border: 0; background: transparent; color: ${(props) => props.theme.primary.solid}; font-size: 10px; cursor: pointer; }
  .run-modal-tools span { margin-left: auto; color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  .run-request-list { min-height: 80px; max-height: 360px; overflow: auto; border-top: 1px solid ${(props) => props.theme.border.border1}; border-bottom: 1px solid ${(props) => props.theme.border.border1}; }
  .run-request-row { display: flex; align-items: center; gap: 9px; padding: 8px 14px; border-bottom: 1px solid ${(props) => props.theme.border.border1}; cursor: pointer; }
  .run-request-row > span { min-width: 0; display: flex; flex: 1; flex-direction: column; }
  .run-request-row strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
  .run-request-row small { overflow: hidden; color: ${(props) => props.theme.colors.text.muted}; text-overflow: ellipsis; white-space: nowrap; font-size: 9px; }
  .run-request-row .method { min-width: 46px; color: ${(props) => props.theme.primary.solid}; font-size: 9px; font-weight: 700; }
  .run-request-row .method.side-effect { color: ${(props) => props.theme.colors.text.warning}; }
  .run-side-effect-warning { display: flex; align-items: center; gap: 7px; padding: 9px 14px; color: ${(props) => props.theme.colors.text.warning}; font-size: 10px; }
  .run-modal-actions { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 14px; border-top: 1px solid ${(props) => props.theme.border.border1}; }
  .run-modal-actions button { display: inline-flex; align-items: center; gap: 5px; padding: 6px 11px; border-radius: ${(props) => props.theme.border.radius.base}; font-size: 10px; cursor: pointer; }
  .run-modal-actions .secondary { border: 1px solid ${(props) => props.theme.border.border1}; background: transparent; color: ${(props) => props.theme.text}; }
  .run-modal-actions .primary { border: 1px solid ${(props) => props.theme.primary.solid}; background: ${(props) => props.theme.primary.solid}; color: white; }
  .run-modal-actions .primary:disabled { opacity: 0.5; cursor: not-allowed; }

  .diff-file-header {
    flex: 0 0 auto;
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 7px 12px;
    border-bottom: 1px solid ${(props) => props.theme.border.border1};

    > div { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
    strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    span { color: ${(props) => props.theme.colors.text.muted}; font-size: 9px; }
  }

  .file-status {
    padding: 3px 7px;
    border: 1px solid currentColor;
    border-radius: 999px;
    font-size: 9px !important;
    font-weight: 700;
    text-transform: uppercase;

    &.added { color: ${(props) => props.theme.colors.text.green}; }
    &.deleted { color: ${(props) => props.theme.colors.text.danger}; }
    &.modified { color: ${(props) => props.theme.colors.text.warning}; }
    &.renamed { color: ${(props) => props.theme.primary.solid}; }
  }

  .diff-tabs {
    flex: 0 0 auto;
    display: flex;
    gap: 2px;
    padding: 6px 8px;
    overflow-x: auto;
    border-bottom: 1px solid ${(props) => props.theme.border.border1};

    button {
      position: relative;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 8px;
      border: 1px solid transparent;
      border-radius: ${(props) => props.theme.border.radius.sm};
      background: transparent;
      color: ${(props) => props.theme.colors.text.muted};
      font-size: 10px;
      cursor: pointer;
      white-space: nowrap;

      &:hover { color: ${(props) => props.theme.text}; background: ${(props) => props.theme.sidebar.collection.item.hoverBg}; }
      &.active {
        color: ${(props) => props.theme.primary.solid};
        border-color: ${(props) => rgba(props.theme.primary.solid, 0.45)};
        background: ${(props) => rgba(props.theme.primary.solid, 0.11)};
      }
    }
  }

  .changed-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: ${(props) => props.theme.colors.text.warning};
    box-shadow: 0 0 6px ${(props) => props.theme.colors.text.warning};
  }

  .diff-content-wrap {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    padding: 10px;
  }

  .diff-empty {
    height: 100%;
    flex-direction: column;
    strong { color: ${(props) => props.theme.text}; font-size: 13px; }
  }
  .diff-loading { height: 100%; }

  @media (max-width: 1050px) {
    .git-review-grid { grid-template-columns: 220px 260px minmax(400px, 1fr); overflow-x: auto; }
  }
`;

export default StyledWrapper;
