const path = require('node:path');
const { createHash } = require('node:crypto');

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const stableWorkspaceUid = (workspacePath) => `workspace_${createHash('sha256').update(path.resolve(workspacePath)).digest('hex').slice(0, 16)}`;

const normalizeWorkspaceEntry = (entry) => {
  if (typeof entry === 'string') {
    const pathname = path.resolve(entry);
    return { uid: stableWorkspaceUid(pathname), name: path.basename(pathname), path: pathname };
  }
  if (!entry || typeof entry !== 'object' || !entry.path) return null;
  const pathname = path.resolve(String(entry.path));
  return {
    uid: String(entry.uid || stableWorkspaceUid(pathname)),
    name: String(entry.name || path.basename(pathname)),
    path: pathname
  };
};

const normalizeMcpConfig = (preferences = {}) => {
  const source = preferences?.mcp || preferences || {};
  const defaultWorkspacePath = preferences?.general?.defaultWorkspacePath || preferences?.general?.defaultLocation || '';
  const configured = Array.isArray(source.workspaces)
    ? source.workspaces
    : (Array.isArray(source.allowedWorkspaces) ? source.allowedWorkspaces : []);
  const workspaces = configured.map(normalizeWorkspaceEntry).filter(Boolean);
  if (workspaces.length === 0 && defaultWorkspacePath) {
    const fallback = normalizeWorkspaceEntry(defaultWorkspacePath);
    if (fallback) workspaces.push(fallback);
  }
  return {
    enabled: source.enabled === true,
    host: '127.0.0.1',
    port: Math.max(1, Math.min(65535, Number(source.port) || 3847)),
    workspaces,
    allowedWorkspaces: workspaces,
    requestTimeoutMs: Math.max(1_000, Math.min(600_000, Number(source.requestTimeoutMs) || 120_000)),
    maxRequestFiles: Math.max(100, Math.min(100_000, Number(source.maxRequestFiles) || 20_000))
  };
};

module.exports = {
  LOOPBACK_HOSTS,
  normalizeMcpConfig,
  normalizeWorkspaceEntry,
  stableWorkspaceUid
};
