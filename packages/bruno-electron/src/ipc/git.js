const path = require('path');
const { ipcMain } = require('electron');
const {
  cloneGitRepository,
  getCollectionGitRootPath,
  getGitRepositoryStatus,
  pushGitChanges,
  pullGitChanges,
  createStash,
  popLatestStash,
  getCurrentBranchCommitHistory,
  getCommitFilesForCollection,
  getFileContentForVisualDiff
} = require('../utils/git');
const { createDirectory, removeDirectory } = require('../utils/filesystem');
const { getCommitSemanticReview } = require('../services/git-semantic-review/commit-review');

const getGitOperationContext = async (collectionPath) => {
  if (!collectionPath) {
    throw new Error('Collection path is required');
  }

  const status = await getGitRepositoryStatus(collectionPath);
  if (!status.isGitRepository) {
    throw new Error('This collection is not inside a Git repository');
  }

  return {
    ...status,
    gitRootPath: getCollectionGitRootPath(collectionPath)
  };
};

const registerGitIpc = (mainWindow) => {
  ipcMain.handle('renderer:clone-git-repository', async (event, { url, path, processUid }) => {
    let directoryCreated = false;
    try {
      await createDirectory(path);
      directoryCreated = true;
      await cloneGitRepository(mainWindow, { url, path, processUid });
      return 'Repository cloned successfully';
    } catch (error) {
      if (directoryCreated) {
        await removeDirectory(path);
      }
      return Promise.reject(error);
    }
  });

  ipcMain.handle('renderer:get-git-repository-status', async (event, collectionPath) => {
    return getGitRepositoryStatus(collectionPath);
  });

  ipcMain.handle('renderer:git-pull', async (event, { collectionPath, processUid, strategy = '--ff-only' }) => {
    const context = await getGitOperationContext(collectionPath);
    if (!context.hasRemote || !context.remoteName) {
      throw new Error('No Git remote is configured');
    }
    if (!context.branch || !context.remoteBranch) {
      throw new Error('Cannot pull while HEAD is detached');
    }

    await pullGitChanges(mainWindow, {
      gitRootPath: context.gitRootPath,
      processUid,
      remote: context.remoteName,
      remoteBranch: context.remoteBranch,
      strategy
    });

    return getGitRepositoryStatus(collectionPath);
  });

  ipcMain.handle('renderer:git-push', async (event, { collectionPath, processUid }) => {
    const context = await getGitOperationContext(collectionPath);
    if (!context.hasRemote || !context.remoteName) {
      throw new Error('No Git remote is configured');
    }
    if (!context.branch) {
      throw new Error('Cannot push while HEAD is detached');
    }

    await pushGitChanges(mainWindow, {
      gitRootPath: context.gitRootPath,
      processUid,
      remote: context.remoteName,
      remoteBranch: context.branch
    });

    return getGitRepositoryStatus(collectionPath);
  });

  ipcMain.handle('renderer:git-stash', async (event, { collectionPath, message }) => {
    const context = await getGitOperationContext(collectionPath);
    if (!context.changedFiles) {
      throw new Error('There are no changes to stash');
    }

    const stashMessage = message?.trim()
      || `Bruno stash on ${context.branch || 'detached HEAD'} at ${new Date().toISOString()}`;
    await createStash(context.gitRootPath, stashMessage);

    return getGitRepositoryStatus(collectionPath);
  });

  ipcMain.handle('renderer:git-stash-pop', async (event, { collectionPath }) => {
    const context = await getGitOperationContext(collectionPath);
    if (!context.stashCount) {
      throw new Error('There are no stashes to pop');
    }
    if (context.changedFiles) {
      throw new Error('Commit or stash current changes before popping another stash');
    }

    await popLatestStash(context.gitRootPath);
    return getGitRepositoryStatus(collectionPath);
  });

  ipcMain.handle('renderer:get-current-branch-commits', async (event, { collectionPath, limit = 100 }) => {
    await getGitOperationContext(collectionPath);
    return getCurrentBranchCommitHistory(collectionPath, limit);
  });

  ipcMain.handle('renderer:get-commit-review', async (event, { collectionPath, commitHash }) => {
    if (!commitHash) {
      throw new Error('Commit hash is required');
    }
    await getGitOperationContext(collectionPath);
    const files = await getCommitFilesForCollection(collectionPath, commitHash);
    return { commitHash, files };
  });

  ipcMain.handle('renderer:get-commit-semantic-review', async (event, { collectionPath, commitHash, context = {} }) => {
    if (!commitHash) throw new Error('Commit hash is required');
    await getGitOperationContext(collectionPath);
    return getCommitSemanticReview(collectionPath, commitHash, context);
  });

  ipcMain.handle('renderer:get-commit-file-review', async (event, { collectionPath, commitHash, filePath, oldFilePath }) => {
    if (!commitHash || !filePath) {
      throw new Error('Commit hash and file path are required');
    }

    const context = await getGitOperationContext(collectionPath);
    const allowedFiles = await getCommitFilesForCollection(collectionPath, commitHash);
    const selectedFile = allowedFiles.find((file) => file.path === filePath && (file.oldPath || file.path) === (oldFilePath || filePath));
    if (!selectedFile) {
      throw new Error('The selected file is not part of this collection commit');
    }

    const resolvedPath = path.resolve(context.gitRootPath, selectedFile.path);
    const resolvedRoot = path.resolve(context.gitRootPath);
    if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error('Invalid Git file path');
    }

    return getFileContentForVisualDiff(
      context.gitRootPath,
      commitHash,
      selectedFile.path,
      selectedFile.oldPath || selectedFile.path
    );
  });
};

module.exports = registerGitIpc;
