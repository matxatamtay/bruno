const path = require('node:path');
const { createHash } = require('node:crypto');
const { normalizePermissionProfile } = require('./permissions');

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
  const configuredWorkspaces = Array.isArray(source.allowedWorkspaces) ? source.allowedWorkspaces : [];
  const allowedWorkspaces = configuredWorkspaces
    .map(normalizeWorkspaceEntry)
    .filter(Boolean);
  if (allowedWorkspaces.length === 0 && defaultWorkspacePath) {
    const fallback = normalizeWorkspaceEntry(defaultWorkspacePath);
    if (fallback) allowedWorkspaces.push(fallback);
  }
  const host = String(source.host || '127.0.0.1').trim();
  const allowRemote = source.allowRemote === true;
  if (!LOOPBACK_HOSTS.has(host) && !allowRemote) {
    const error = new Error('Bruno MCP must bind to a loopback address unless remote access is explicitly enabled');
    error.code = 'BRUNO_MCP_REMOTE_BIND_FORBIDDEN';
    throw error;
  }
  return {
    enabled: source.enabled === true,
    host,
    port: Math.max(1, Math.min(65535, Number(source.port) || 3847)),
    allowRemote,
    permissionProfile: normalizePermissionProfile(source.permissionProfile),
    allowedWorkspaces,
    allowedHosts: [...new Set((Array.isArray(source.allowedHosts) ? source.allowedHosts : []).map((value) => String(value).trim().toLowerCase()).filter(Boolean))],
    allowPrivateHosts: source.allowPrivateHosts === true,
    allowDynamicHosts: source.allowDynamicHosts === true,
    auditEnabled: source.auditEnabled !== false,
    rateLimitPerMinute: Math.max(10, Math.min(10_000, Number(source.rateLimitPerMinute) || 120)),
    requestTimeoutMs: Math.max(1_000, Math.min(300_000, Number(source.requestTimeoutMs) || 120_000)),
    maxRequestFiles: Math.max(100, Math.min(20_000, Number(source.maxRequestFiles) || 10_000))
  };
};

module.exports = {
  LOOPBACK_HOSTS,
  normalizeMcpConfig,
  normalizeWorkspaceEntry,
  stableWorkspaceUid
};
