import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import {
  IconArchive,
  IconArrowBackUp,
  IconBrandGit,
  IconChevronDown,
  IconDownload,
  IconGitBranch,
  IconHistory,
  IconRefresh,
  IconUpload
} from '@tabler/icons';
import toast from 'react-hot-toast';
import Dropdown from 'components/Dropdown';
import { uuid } from 'utils/common';
import { addTab } from 'providers/ReduxStore/slices/tabs';
import { formatIpcError } from 'utils/common/error';
import StyledWrapper, { GitMenu } from './StyledWrapper';

const GitActions = ({ collectionPath, collectionUid }) => {
  const dispatch = useDispatch();
  const dropdownRef = useRef(null);
  const [status, setStatus] = useState(null);
  const [isChecking, setIsChecking] = useState(true);
  const [activeAction, setActiveAction] = useState(null);

  const loadStatus = async ({ silent = false } = {}) => {
    if (!collectionPath) return null;
    if (!silent) setIsChecking(true);

    try {
      const nextStatus = await window.ipcRenderer.invoke('renderer:get-git-repository-status', collectionPath);
      setStatus(nextStatus);
      return nextStatus;
    } catch (error) {
      console.error('Failed to load Git status:', error);
      setStatus(null);
      return null;
    } finally {
      if (!silent) setIsChecking(false);
    }
  };

  useEffect(() => {
    setStatus(null);
    loadStatus();
  }, [collectionPath]);

  const runAction = async ({ action, channel, successMessage, payload = {} }) => {
    if (activeAction) return;

    dropdownRef.current?.hide();
    setActiveAction(action);

    try {
      const nextStatus = await window.ipcRenderer.invoke(channel, {
        collectionPath,
        processUid: uuid(),
        ...payload
      });
      setStatus(nextStatus);
      toast.success(successMessage);
    } catch (error) {
      const message = formatIpcError(error);
      toast.error(typeof message === 'string' && message ? message : `Git ${action} failed`);
      await loadStatus({ silent: true });
    } finally {
      setActiveAction(null);
    }
  };

  const refresh = async () => {
    if (activeAction) return;
    setActiveAction('refresh');
    try {
      await loadStatus({ silent: true });
    } finally {
      setActiveAction(null);
      dropdownRef.current?.hide();
    }
  };

  if (isChecking && !status) return null;
  if (!status?.isGitRepository) return null;

  const isBusy = Boolean(activeAction);
  const canPopStash = status.stashCount > 0 && status.changedFiles === 0;
  const remoteLabel = status.tracking
    || (status.hasRemote ? `${status.remoteName}/${status.remoteBranch || status.branch}` : 'No remote configured');

  return (
    <StyledWrapper>
      <Dropdown
        placement="bottom-end"
        appendTo={() => document.body}
        onCreate={(instance) => (dropdownRef.current = instance)}
        icon={(
          <button
            type="button"
            className="git-actions-trigger"
            aria-label={`Git actions for ${status.branch || 'repository'}`}
            title={activeAction ? `Git ${activeAction} in progress` : 'Git actions'}
          >
            {isBusy
              ? <IconRefresh className="spin" size={14} strokeWidth={1.75} />
              : <IconBrandGit size={14} strokeWidth={1.75} />}
            <span className="branch-name">{status.branch || 'Git'}</span>
            {status.ahead > 0 && <span className="sync-count ahead" title={`${status.ahead} commit(s) ahead`}>↑{status.ahead}</span>}
            {status.behind > 0 && <span className="sync-count behind" title={`${status.behind} commit(s) behind`}>↓{status.behind}</span>}
            {status.changedFiles > 0 && <span className="sync-count changed" title={`${status.changedFiles} changed file(s)`}>●{status.changedFiles}</span>}
            <IconChevronDown size={12} strokeWidth={1.75} className="chevron" />
          </button>
        )}
      >
        <GitMenu>
          <div className="repo-summary">
            <IconGitBranch size={16} strokeWidth={1.75} />
            <div className="repo-copy">
              <strong>{status.branch || 'Detached HEAD'}</strong>
              <span title={remoteLabel}>{remoteLabel}</span>
            </div>
          </div>

          <div className="repo-stats">
            <span>↑ {status.ahead} ahead</span>
            <span>↓ {status.behind} behind</span>
            <span>● {status.changedFiles} changed</span>
            <span>{status.stashCount} stashed</span>
          </div>

          <div className="dropdown-separator" />

          <button
            type="button"
            className="dropdown-item git-action"
            disabled={isBusy || !status.hasRemote}
            onClick={() => runAction({
              action: 'pull',
              channel: 'renderer:git-pull',
              payload: { strategy: '--ff-only' },
              successMessage: 'Pulled latest changes'
            })}
            title={status.hasRemote ? 'Pull using fast-forward only' : 'Configure a remote before pulling'}
          >
            <span className="dropdown-icon"><IconDownload size={16} strokeWidth={1.5} /></span>
            <span className="action-copy">
              <strong>Pull</strong>
              <small>Fast-forward only</small>
            </span>
            {status.behind > 0 && <span className="action-count">{status.behind}</span>}
          </button>

          <button
            type="button"
            className="dropdown-item git-action"
            disabled={isBusy || !status.hasRemote}
            onClick={() => runAction({
              action: 'push',
              channel: 'renderer:git-push',
              successMessage: 'Pushed local commits'
            })}
            title={status.hasRemote ? 'Push the current branch' : 'Configure a remote before pushing'}
          >
            <span className="dropdown-icon"><IconUpload size={16} strokeWidth={1.5} /></span>
            <span className="action-copy">
              <strong>Push</strong>
              <small>Current branch, no force</small>
            </span>
            {status.ahead > 0 && <span className="action-count">{status.ahead}</span>}
          </button>

          <button
            type="button"
            className="dropdown-item git-action"
            disabled={isBusy || status.changedFiles === 0}
            onClick={() => runAction({
              action: 'stash',
              channel: 'renderer:git-stash',
              successMessage: 'Changes stashed'
            })}
            title={status.changedFiles > 0 ? 'Stash tracked and untracked changes' : 'There are no changes to stash'}
          >
            <span className="dropdown-icon"><IconArchive size={16} strokeWidth={1.5} /></span>
            <span className="action-copy">
              <strong>Stash changes</strong>
              <small>Includes untracked files</small>
            </span>
            {status.changedFiles > 0 && <span className="action-count">{status.changedFiles}</span>}
          </button>

          <button
            type="button"
            className="dropdown-item git-action"
            disabled={isBusy || !canPopStash}
            onClick={() => runAction({
              action: 'stash pop',
              channel: 'renderer:git-stash-pop',
              successMessage: 'Latest stash restored'
            })}
            title={status.changedFiles > 0
              ? 'Commit or stash current changes first'
              : status.stashCount > 0
                ? 'Restore and remove the latest stash'
                : 'There are no stashes to pop'}
          >
            <span className="dropdown-icon"><IconArrowBackUp size={16} strokeWidth={1.5} /></span>
            <span className="action-copy">
              <strong>Pop latest stash</strong>
              <small>Restore and remove stash@{'{0}'}</small>
            </span>
            {status.stashCount > 0 && <span className="action-count">{status.stashCount}</span>}
          </button>

          <div className="dropdown-separator" />

          <button
            type="button"
            className="dropdown-item git-action compact"
            disabled={isBusy}
            onClick={() => {
              dropdownRef.current?.hide();
              dispatch(addTab({
                uid: `${collectionUid}-git-review`,
                collectionUid,
                type: 'git-review',
                preview: false
              }));
            }}
          >
            <span className="dropdown-icon"><IconHistory size={16} strokeWidth={1.5} /></span>
            <span className="action-copy"><strong>Browse commit history</strong></span>
          </button>

          <button
            type="button"
            className="dropdown-item git-action compact"
            disabled={isBusy}
            onClick={refresh}
          >
            <span className="dropdown-icon"><IconRefresh size={16} strokeWidth={1.5} /></span>
            <span className="action-copy"><strong>Refresh status</strong></span>
          </button>
        </GitMenu>
      </Dropdown>
    </StyledWrapper>
  );
};

export default GitActions;
