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

  .diff-column { background: ${(props) => props.theme.background.base}; }
  .request-diff { height: 100%; display: flex; flex-direction: column; min-width: 0; }

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
