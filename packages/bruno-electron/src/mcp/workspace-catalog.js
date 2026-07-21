const fs = require('node:fs/promises');
const path = require('node:path');
const { BrunoCollectionService } = require('./collection-service');

const assertSafePath = async (parentPath, childPath) => {
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    const error = new Error(`Path ${child} is outside ${parent}`);
    error.code = 'BRUNO_MCP_PATH_OUTSIDE_ROOT';
    throw error;
  }
  const parentReal = await fs.realpath(parent);
  let childReal;
  try {
    childReal = await fs.realpath(child);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    childReal = child;
  }
  const realRelative = path.relative(parentReal, childReal);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    const error = new Error(`Path ${child} resolves outside ${parent}`);
    error.code = 'BRUNO_MCP_PATH_OUTSIDE_ROOT';
    throw error;
  }
  return child;
};

class BrunoWorkspaceCatalog {
  constructor({ configProvider } = {}) {
    this.collections = new BrunoCollectionService({ configProvider });
  }

  listWorkspaces() {
    return this.collections.listWorkspaces();
  }

  resolveWorkspace(input) {
    return this.collections.resolveWorkspace(input);
  }

  listRequests(workspace, options = {}) {
    return this.collections.listRequests({ ...options, workspace_path: workspace.path }).then((result) => result.requests);
  }

  getRequest(workspace, input = {}) {
    return this.collections.getRequest({ ...input, workspace_path: workspace.path });
  }
}

module.exports = {
  BrunoWorkspaceCatalog,
  assertSafePath
};
