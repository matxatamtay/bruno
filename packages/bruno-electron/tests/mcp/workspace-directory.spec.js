// mcp/workspace-directory.js reads the real, electron-store-backed "Manage Workspaces" state
// (ipc/workspace.js, store/last-opened-workspaces.js, services/snapshot). Give it an isolated
// userData directory instead of a real Electron app, same as tests/mcp/bruno-mcp-server.spec.js.
jest.mock('electron', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const mockUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-mcp-workspace-directory-'));
  return {
    ipcMain: { handle: jest.fn(), on: jest.fn() },
    dialog: { showOpenDialog: jest.fn(), showSaveDialog: jest.fn() },
    app: { getPath: jest.fn(() => mockUserDataDir), getVersion: jest.fn(() => '0.0.0'), isPackaged: false }
  };
});
jest.mock('electron-is-dev', () => false);

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const LastOpenedWorkspaces = require('../../src/store/last-opened-workspaces');
const snapshotManager = require('../../src/services/snapshot');
const { createWorkspaceConfig, writeWorkspaceConfig, getWorkspaceUid } = require('../../src/utils/workspace-config');
const { buildWorkspaceDirectory, createWorkspaceActivator, createWorkspaceManager } = require('../../src/mcp/workspace-directory');

describe('Bruno MCP workspace directory', () => {
  let root;
  let lastOpenedWorkspaces;

  const makeWorkspace = async (name) => {
    const workspacePath = path.join(root, name);
    fs.mkdirSync(workspacePath, { recursive: true });
    await writeWorkspaceConfig(workspacePath, createWorkspaceConfig(name));
    return workspacePath;
  };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-mcp-workspace-directory-fixture-'));
    lastOpenedWorkspaces = new LastOpenedWorkspaces();
    snapshotManager.resetSnapshot();
  });

  afterEach(() => {
    for (const workspacePath of lastOpenedWorkspaces.getAll()) lastOpenedWorkspaces.remove(workspacePath);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists every registered workspace with the real app uid/name and marks the current one', async () => {
    const workspaceAPath = await makeWorkspace('workspace-a');
    const workspaceBPath = await makeWorkspace('workspace-b');
    lastOpenedWorkspaces.add(workspaceAPath);
    lastOpenedWorkspaces.add(workspaceBPath);

    const beforeSwitch = buildWorkspaceDirectory();
    expect(beforeSwitch).toEqual(expect.arrayContaining([
      { uid: getWorkspaceUid(workspaceAPath), name: 'workspace-a', path: workspaceAPath, current: false },
      { uid: getWorkspaceUid(workspaceBPath), name: 'workspace-b', path: workspaceBPath, current: false }
    ]));

    snapshotManager.saveSnapshot({ ...snapshotManager.getSnapshot(), activeWorkspacePath: workspaceBPath });
    const afterSwitch = buildWorkspaceDirectory();
    expect(afterSwitch.find((entry) => entry.path === workspaceAPath).current).toBe(false);
    expect(afterSwitch.find((entry) => entry.path === workspaceBPath).current).toBe(true);
  });

  describe('createWorkspaceActivator', () => {
    it('does nothing when the resolved workspace is already current', async () => {
      const workspacePath = await makeWorkspace('workspace-current');
      lastOpenedWorkspaces.add(workspacePath);
      snapshotManager.saveSnapshot({ ...snapshotManager.getSnapshot(), activeWorkspacePath: workspacePath });

      const mainWindow = { isDestroyed: () => false, webContents: { send: jest.fn() } };
      const activate = createWorkspaceActivator({ getMainWindow: () => mainWindow, workspaceWatcher: null });
      await activate({ uid: getWorkspaceUid(workspacePath), name: 'workspace-current', path: workspacePath });

      expect(mainWindow.webContents.send).not.toHaveBeenCalled();
    });

    it('switches to a known but not-current workspace and notifies a live window', async () => {
      const currentPath = await makeWorkspace('workspace-current');
      const targetPath = await makeWorkspace('workspace-target');
      lastOpenedWorkspaces.add(currentPath);
      lastOpenedWorkspaces.add(targetPath);
      snapshotManager.saveSnapshot({ ...snapshotManager.getSnapshot(), activeWorkspacePath: currentPath });

      const mainWindow = { isDestroyed: () => false, webContents: { send: jest.fn() } };
      const activate = createWorkspaceActivator({ getMainWindow: () => mainWindow, workspaceWatcher: null });
      const workspaceUid = getWorkspaceUid(targetPath);
      await activate({ uid: workspaceUid, name: 'workspace-target', path: targetPath });

      expect(snapshotManager.getSnapshot().activeWorkspacePath).toBe(targetPath);
      expect(mainWindow.webContents.send).toHaveBeenCalledWith('main:mcp-workspace-switched', { workspacePath: targetPath, workspaceUid });
    });

    it('opens an unregistered workspace before switching to it', async () => {
      const targetPath = await makeWorkspace('workspace-unregistered');
      expect(lastOpenedWorkspaces.getAll()).not.toContain(targetPath);

      const activate = createWorkspaceActivator({ getMainWindow: () => null, workspaceWatcher: null });
      await activate({ uid: getWorkspaceUid(targetPath), name: 'workspace-unregistered', path: targetPath });

      expect(new LastOpenedWorkspaces().getAll()).toContain(targetPath);
      expect(snapshotManager.getSnapshot().activeWorkspacePath).toBe(targetPath);
    });
  });

  describe('createWorkspaceManager', () => {
    it('lists the configured discovery workspaces, filterable by name', () => {
      const configProvider = () => ({
        discoveryWorkspaces: [{ uid: 'workspace_a', name: 'Alpha', path: '/tmp/alpha' }, { uid: 'workspace_b', name: 'Beta', path: '/tmp/beta' }]
      });
      const manager = createWorkspaceManager({ getMainWindow: () => null, workspaceWatcher: null, configProvider });
      expect(manager.listDiscoveryWorkspaces({})).toEqual({ discovery_workspaces: configProvider().discoveryWorkspaces });
      expect(manager.listDiscoveryWorkspaces({ name_ilike: 'alpha' })).toEqual({ discovery_workspaces: [configProvider().discoveryWorkspaces[0]] });
    });

    it('registers an existing workspace folder without changing the active workspace', async () => {
      const workspacePath = await makeWorkspace('workspace-to-add');
      const manager = createWorkspaceManager({ getMainWindow: () => null, workspaceWatcher: null, configProvider: () => ({ discoveryWorkspaces: [] }) });

      const added = await manager.addWorkspace({ workspace_path: workspacePath });
      expect(added).toEqual({ uid: getWorkspaceUid(workspacePath), name: 'workspace-to-add', path: workspacePath });
      expect(new LastOpenedWorkspaces().getAll()).toContain(workspacePath);
      expect(snapshotManager.getSnapshot().activeWorkspacePath).not.toBe(workspacePath);
    });

    it('scaffolds a brand-new workspace from a folder', async () => {
      const manager = createWorkspaceManager({ getMainWindow: () => null, workspaceWatcher: null, configProvider: () => ({ discoveryWorkspaces: [] }) });
      const created = await manager.createWorkspace({ name: 'Brand New', location: root });

      expect(created.name).toBe('Brand New');
      expect(fs.existsSync(path.join(created.path, 'workspace.yml'))).toBe(true);
      expect(fs.existsSync(path.join(created.path, 'collections'))).toBe(true);
      expect(new LastOpenedWorkspaces().getAll()).toContain(created.path);
    });
  });
});
