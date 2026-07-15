import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { IconGitBranch, IconLoader2, IconRefresh } from '@tabler/icons';
import toast from 'react-hot-toast';
import { formatIpcError } from 'utils/common/error';
import GitRequestTree from './GitRequestTree';
import GitRequestDiff from './GitRequestDiff';
import StyledWrapper from './StyledWrapper';
import SemanticReviewPanel from './SemanticReviewPanel';
import RunAffectedModal from './RunAffectedModal';
import { runCollectionFolder, selectEnvironment } from 'providers/ReduxStore/slices/collections/actions';

const formatCommitDate = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
};

const invokeWithTimeout = (channel, payload, timeoutMs = 20000) => {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Git review request timed out')), timeoutMs);
  });

  return Promise.race([
    window.ipcRenderer.invoke(channel, payload),
    timeout
  ]).finally(() => clearTimeout(timeoutId));
};

const flattenItems = (items = [], output = []) => {
  items.forEach((item) => {
    output.push(item);
    if (item.items?.length) flattenItems(item.items, output);
  });
  return output;
};

const toVariableList = (value) => {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).map(([name, variableValue]) => ({ name, value: variableValue, enabled: true }));
};

const GitReview = ({ collection }) => {
  const dispatch = useDispatch();
  const [history, setHistory] = useState({ branch: '', commits: [], hasMore: false });
  const [selectedCommit, setSelectedCommit] = useState(null);
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [fileReview, setFileReview] = useState(null);
  const [semanticReview, setSemanticReview] = useState(null);
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [requestedTab, setRequestedTab] = useState(null);
  const [isLoadingSemantic, setIsLoadingSemantic] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(true);
  const [isLoadingCommit, setIsLoadingCommit] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const historyRequestTokenRef = useRef(0);
  const commitRequestTokenRef = useRef(0);
  const fileRequestTokenRef = useRef(0);

  const loadFileReview = useCallback(async (commit, file) => {
    if (!commit || !file) return;
    const token = ++fileRequestTokenRef.current;
    setSelectedFile(file);
    setFileReview(null);
    setIsLoadingFile(true);

    try {
      const review = await invokeWithTimeout('renderer:get-commit-file-review', {
        collectionPath: collection.pathname,
        commitHash: commit.hash,
        filePath: file.path,
        oldFilePath: file.oldPath || file.path
      });
      if (token === fileRequestTokenRef.current) {
        setFileReview(review);
      }
    } catch (error) {
      if (token === fileRequestTokenRef.current) {
        toast.error(formatIpcError(error) || 'Unable to load the file diff');
      }
    } finally {
      if (token === fileRequestTokenRef.current) {
        setIsLoadingFile(false);
      }
    }
  }, [collection.pathname]);

  const selectCommit = useCallback(async (commit) => {
    if (!commit) return;
    const token = ++commitRequestTokenRef.current;
    fileRequestTokenRef.current += 1;
    setSelectedCommit(commit);
    setFiles([]);
    setSelectedFile(null);
    setFileReview(null);
    setSemanticReview(null);
    setRequestedTab(null);
    setIsLoadingFile(false);
    setIsLoadingCommit(true);
    setIsLoadingSemantic(true);

    invokeWithTimeout('renderer:get-commit-semantic-review', {
      collectionPath: collection.pathname,
      commitHash: commit.hash,
      context: {
        globalVariables: toVariableList(collection.globalEnvironmentVariables),
        runtimeVariables: toVariableList(collection.runtimeVariables)
      }
    }, 60000).then((result) => {
      if (token === commitRequestTokenRef.current) setSemanticReview(result);
    }).catch((error) => {
      if (token === commitRequestTokenRef.current) toast.error(formatIpcError(error) || 'Unable to analyze commit semantics');
    }).finally(() => {
      if (token === commitRequestTokenRef.current) setIsLoadingSemantic(false);
    });

    try {
      const review = await invokeWithTimeout('renderer:get-commit-review', {
        collectionPath: collection.pathname,
        commitHash: commit.hash
      });
      if (token !== commitRequestTokenRef.current) return;

      const nextFiles = review.files || [];
      setFiles(nextFiles);
      setIsLoadingCommit(false);

      const firstFile = nextFiles.find((file) => file.supportsVisualDiff) || nextFiles[0] || null;
      if (firstFile) {
        void loadFileReview(commit, firstFile);
      }
    } catch (error) {
      if (token === commitRequestTokenRef.current) {
        setFiles([]);
        setSelectedFile(null);
        setFileReview(null);
        toast.error(formatIpcError(error) || 'Unable to load commit changes');
      }
    } finally {
      if (token === commitRequestTokenRef.current) {
        setIsLoadingCommit(false);
      }
    }
  }, [collection.pathname, loadFileReview]);

  const loadHistory = useCallback(async () => {
    const token = ++historyRequestTokenRef.current;
    commitRequestTokenRef.current += 1;
    fileRequestTokenRef.current += 1;
    setIsLoadingHistory(true);
    setIsLoadingCommit(false);
    setIsLoadingFile(false);

    try {
      const nextHistory = await invokeWithTimeout('renderer:get-current-branch-commits', {
        collectionPath: collection.pathname,
        limit: 100
      });
      if (token !== historyRequestTokenRef.current) return;

      setHistory(nextHistory);
      setIsLoadingHistory(false);

      const firstCommit = nextHistory.commits?.[0] || null;
      if (firstCommit) {
        void selectCommit(firstCommit);
      } else {
        setSelectedCommit(null);
        setFiles([]);
        setSelectedFile(null);
        setFileReview(null);
      }
    } catch (error) {
      if (token === historyRequestTokenRef.current) {
        toast.error(formatIpcError(error) || 'Unable to load Git history');
      }
    } finally {
      if (token === historyRequestTokenRef.current) {
        setIsLoadingHistory(false);
      }
    }
  }, [collection.pathname, selectCommit]);

  const selectFinding = useCallback((finding) => {
    const file = files.find((candidate) => candidate.collectionRelativePath === finding.filePath);
    setRequestedTab(finding.section === 'assertions' ? 'assertions' : finding.section);
    if (file) void loadFileReview(selectedCommit, file);
  }, [files, loadFileReview, selectedCommit]);

  const runAffected = useCallback(() => {
    if (!semanticReview?.affectedRequests?.length) return;
    setRunModalOpen(true);
  }, [semanticReview]);

  const executeAffected = useCallback(async ({ environmentUid, paths }) => {
    const items = flattenItems(collection.items || []);
    const selected = items.filter((item) => paths.includes(String(item.pathname || '').replace(`${collection.pathname}/`, '')));
    if (!selected.length) {
      toast.error('Affected requests are not available in the current working tree');
      return;
    }
    try {
      await dispatch(selectEnvironment(environmentUid, collection.uid));
      await dispatch(runCollectionFolder(collection.uid, null, true, 0, [], selected.map((item) => item.uid)));
      setRunModalOpen(false);
    } catch (error) {
      toast.error(formatIpcError(error) || 'Unable to run affected requests');
    }
  }, [collection, dispatch]);

  useEffect(() => {
    void loadHistory();

    return () => {
      historyRequestTokenRef.current += 1;
      commitRequestTokenRef.current += 1;
      fileRequestTokenRef.current += 1;
    };
  }, [loadHistory]);

  return (
    <StyledWrapper>
      <div className="git-review-header">
        <div className="branch-copy">
          <IconGitBranch size={17} strokeWidth={1.7} />
          <div>
            <strong>{history.branch || 'Current branch'}</strong>
            <span>{collection.name}</span>
          </div>
        </div>
        <button type="button" className="refresh-button" onClick={loadHistory} disabled={isLoadingHistory}>
          <IconRefresh className={isLoadingHistory ? 'spin' : ''} size={15} strokeWidth={1.6} />
          Refresh
        </button>
      </div>

      <div className="git-review-grid">
        <aside className="commit-column">
          <div className="column-title">
            <span>Commits</span>
            <small>{history.commits.length}{history.hasMore ? '+' : ''}</small>
          </div>
          <div className="commit-list">
            {isLoadingHistory && history.commits.length === 0 ? (
              <div className="loading-state"><IconLoader2 className="spin" size={18} /> Loading commits</div>
            ) : history.commits.length === 0 ? (
              <div className="empty-state">No commits found on this branch.</div>
            ) : history.commits.map((commit) => (
              <button
                type="button"
                key={commit.hash}
                className={`commit-row ${selectedCommit?.hash === commit.hash ? 'selected' : ''}`}
                onClick={() => selectCommit(commit)}
              >
                <span className="commit-dot" />
                <span className="commit-copy">
                  <strong title={commit.message}>{commit.message || '(no message)'}</strong>
                  <span>{commit.author_name} · {formatCommitDate(commit.date)}</span>
                  <code>{commit.hash.slice(0, 8)}</code>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="tree-column">
          <div className="column-title">
            <span>Changed requests</span>
            <small>{files.length} files</small>
          </div>
          {isLoadingCommit ? (
            <div className="loading-state"><IconLoader2 className="spin" size={18} /> Reading commit</div>
          ) : (
            <GitRequestTree
              collection={collection}
              files={files}
              selectedFile={selectedFile}
              commitHash={selectedCommit?.hash}
              onSelectFile={(file) => loadFileReview(selectedCommit, file)}
              impactedPaths={(semanticReview?.affectedRequests || []).map((request) => request.path)}
            />
          )}
        </section>

        <main className="diff-column">
          <SemanticReviewPanel
            review={semanticReview}
            loading={isLoadingSemantic}
            onSelectFinding={selectFinding}
            onRunAffected={runAffected}
          />
          <GitRequestDiff
            commit={selectedCommit}
            file={selectedFile}
            review={fileReview}
            loading={isLoadingFile}
            requestedTab={requestedTab}
          />
        </main>
      </div>
      {runModalOpen && (
        <RunAffectedModal
          affectedRequests={semanticReview?.affectedRequests || []}
          environments={collection.environments || []}
          activeEnvironmentUid={collection.activeEnvironmentUid}
          onClose={() => setRunModalOpen(false)}
          onRun={executeAffected}
        />
      )}
    </StyledWrapper>
  );
};

export default GitReview;
