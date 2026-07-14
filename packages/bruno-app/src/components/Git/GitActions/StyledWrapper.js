import styled, { keyframes } from 'styled-components';

const spin = keyframes`
  to { transform: rotate(360deg); }
`;

const StyledWrapper = styled.div`
  .git-actions-trigger {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    max-width: 230px;
    padding: 0 7px;
    border: 1px solid ${(props) => props.theme.input.border};
    border-radius: ${(props) => props.theme.border.radius.sm};
    background: transparent;
    color: ${(props) => props.theme.text};
    cursor: pointer;
    font-size: 12px;
    line-height: 1;

    &:hover {
      background: ${(props) => props.theme.sidebar.collection.item.hoverBg};
    }
  }

  .branch-name {
    max-width: 92px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }

  .sync-count {
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;

    &.ahead {
      color: ${(props) => props.theme.colors.text.green};
    }

    &.behind {
      color: ${(props) => props.theme.primary.solid};
    }

    &.changed {
      color: ${(props) => props.theme.colors.text.yellow};
    }
  }

  .chevron {
    opacity: 0.55;
  }

  .spin {
    animation: ${spin} 0.8s linear infinite;
  }
`;

export const GitMenu = styled.div`
  width: 292px;

  .repo-summary {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px 6px;
  }

  .repo-copy {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;

    strong {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: ${(props) => props.theme.text};
      font-size: 12px;
    }

    span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: ${(props) => props.theme.colors.text.muted};
      font-size: 10px;
    }
  }

  .repo-stats {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 3px 10px;
    padding: 2px 10px 7px 35px;
    color: ${(props) => props.theme.colors.text.muted};
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }

  .git-action {
    width: 100%;
    border: 0;
    background: transparent;
    color: inherit;
    text-align: left;

    &.compact {
      min-height: 30px;
    }
  }

  .action-copy {
    min-width: 0;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;

    strong {
      color: ${(props) => props.theme.text};
      font-size: 12px;
      font-weight: 500;
    }

    small {
      color: ${(props) => props.theme.colors.text.muted};
      font-size: 10px;
      font-weight: 400;
    }
  }

  .git-action:disabled .action-copy strong,
  .git-action:disabled .action-copy small {
    color: inherit;
  }

  .action-count {
    min-width: 19px;
    padding: 1px 5px;
    border-radius: 999px;
    background: ${(props) => props.theme.sidebar.collection.item.hoverBg};
    text-align: center;
    font-size: 10px;
    font-variant-numeric: tabular-nums;
  }
`;

export default StyledWrapper;
