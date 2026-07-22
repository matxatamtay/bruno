const path = require('node:path');
const LastOpenedWorkspaces = require('../store/last-opened-workspaces');
const { defaultWorkspaceManager } = require('../store/default-workspace');
const snapshotManager = require('../services/snapshot');
const { getWorkspaceUid, readWorkspaceConfig } = require('../utils/workspace-config');
const { resolveLastOpenedWorkspacePaths, normalizeWorkspacePathname } = require('../utils/workspace-startup');
const { openWorkspace, createWorkspace: scaffoldWorkspace, DEFAULT_WORKSPACE_NAME } = require('../ipc/workspace');
const { filterByName } = require('./name-filter');

const workspaceEntry = (workspacePath, { current }) => {
  const uid = getWorkspaceUid(workspacePath);
  let name;
  try {
    name = uid === 'default' ? DEFAULT_WORKSPACE_NAME : (readWorkspaceConfig(workspacePath).name || path.basename(workspacePath));
  } catch (_) {
    name = path.basename(workspacePath);
  }
  return { uid, name, path: workspacePath, current };
};

// The real "Manage Workspaces" list: the default workspace plus every last-opened workspace
// still valid on disk, mirroring exactly what `main:renderer-ready` replays to the renderer at
// startup (ipc/workspace.js). Built fresh on every call so it reflects switches made mid-session,
// not just what was true when the MCP server last (re)started.
const buildWorkspaceDirectory = () => {
  const lastOpenedWorkspaces = new LastOpenedWorkspaces();
  const defaultWorkspacePath = defaultWorkspaceManager.getDefaultWorkspacePath();
  const hasValidDefaultWorkspace = defaultWorkspacePath && defaultWorkspaceManager.isValidDefaultWorkspace(defaultWorkspacePath);
  const activeWorkspacePath = snapshotManager.getSnapshot()?.activeWorkspacePath
    || (hasValidDefaultWorkspace ? defaultWorkspacePath : null);
  const normalizedActivePath = activeWorkspacePath ? normalizeWorkspacePathname(activeWorkspacePath) : null;

  const { validWorkspaces } = resolveLastOpenedWorkspacePaths(lastOpenedWorkspaces, {
    defaultWorkspacePath: hasValidDefaultWorkspace ? defaultWorkspacePath : null,
    validateConfig: true
  });

  const paths = hasValidDefaultWorkspace ? [defaultWorkspacePath, ...validWorkspaces] : validWorkspaces;
  return paths.map((workspacePath) => workspaceEntry(workspacePath, {
    current: normalizedActivePath !== null && normalizeWorkspacePathname(workspacePath) === normalizedActivePath
  }));
};

// Used as BrunoCollectionService's resolveWorkspace hook: whenever a tool call resolves a
// workspace that isn't the app's current one, this opens it (if the app doesn't know about it
// yet) and makes it current, so a live UI follows along and the next bruno_list_workspaces call
// reports the right "current" workspace without waiting for the app to be relaunched.
const createWorkspaceActivator = ({ getMainWindow, workspaceWatcher }) => async (workspace) => {
  const normalizedTargetPath = normalizeWorkspacePathname(workspace.path);
  const currentActivePath = snapshotManager.getSnapshot()?.activeWorkspacePath;
  if (currentActivePath && normalizeWorkspacePathname(currentActivePath) === normalizedTargetPath) return;

  const lastOpenedWorkspaces = new LastOpenedWorkspaces();
  const defaultWorkspacePath = defaultWorkspaceManager.getDefaultWorkspacePath();
  const isKnown = (defaultWorkspacePath && normalizeWorkspacePathname(defaultWorkspacePath) === normalizedTargetPath)
    || lastOpenedWorkspaces.getAll().some((knownPath) => normalizeWorkspacePathname(knownPath) === normalizedTargetPath);

  if (!isKnown) {
    await openWorkspace({ mainWindow: getMainWindow(), workspaceWatcher, lastOpenedWorkspaces }, workspace.path);
  }

  snapshotManager.saveSnapshot({ ...snapshotManager.getSnapshot(), activeWorkspacePath: workspace.path });

  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed?.()) {
    mainWindow.webContents.send('main:mcp-workspace-switched', { workspacePath: workspace.path, workspaceUid: workspace.uid });
  }
};

// Backs bruno_list_discovery_workspaces / bruno_add_workspace / bruno_create_workspace: the
// manually-configured discovery path list plus the ability to promote a path into a real managed
// workspace (add) or scaffold a brand-new one (create), reusing the same on-disk logic the
// renderer's "Open Workspace" / "New Workspace" flows use.
const createWorkspaceManager = ({ getMainWindow, workspaceWatcher, configProvider }) => {
  const lastOpenedWorkspaces = new LastOpenedWorkspaces();

  return {
    listDiscoveryWorkspaces: (input = {}) => ({
      discovery_workspaces: filterByName(configProvider().discoveryWorkspaces || [], input)
    }),

    addWorkspace: async (input = {}) => {
      if (!input.workspace_path) throw new TypeError('workspace_path is required');
      const resolvedPath = path.resolve(input.workspace_path);
      const result = await openWorkspace({ mainWindow: getMainWindow(), workspaceWatcher, lastOpenedWorkspaces }, resolvedPath);
      return { uid: result.workspaceUid, name: result.workspaceConfig?.name || path.basename(resolvedPath), path: result.workspacePath };
    },

    createWorkspace: async (input = {}) => {
      if (!input.name) throw new TypeError('name is required');
      if (!input.location) throw new TypeError('location is required');
      const result = await scaffoldWorkspace({ mainWindow: getMainWindow(), workspaceWatcher, lastOpenedWorkspaces }, {
        name: input.name,
        folderName: input.folder_name || input.name,
        location: input.location
      });
      return { uid: result.workspaceUid, name: result.workspaceConfig?.name || input.name, path: result.workspacePath };
    }
  };
};

module.exports = {
  buildWorkspaceDirectory,
  filterByName,
  createWorkspaceActivator,
  createWorkspaceManager
};
