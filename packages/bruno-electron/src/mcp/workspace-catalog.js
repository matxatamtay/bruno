const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parseRequest } = require('@usebruno/filestore');
const { getCollectionFormat } = require('../utils/filesystem');
const { redactMcpValue } = require('./redaction');

const REQUEST_TYPES = new Set(['http-request', 'graphql-request', 'grpc-request', 'ws-request', 'sse-request']);
const SKIP_DIRECTORIES = new Set(['.git', '.bruno', 'node_modules', 'dist', 'build', 'flows', 'environments']);

const isInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const stableId = (prefix, value) => `${prefix}_${createHash('sha256').update(String(value)).digest('hex').slice(0, 20)}`;

const assertSafePath = async (root, candidate) => {
  const lexicalRoot = path.resolve(root);
  const lexicalCandidate = path.resolve(candidate);
  if (!isInside(lexicalRoot, lexicalCandidate)) {
    const error = new Error('Request path escapes the allowed workspace');
    error.code = 'BRUNO_MCP_PATH_ESCAPE';
    throw error;
  }
  const [realRoot, realCandidate] = await Promise.all([fs.realpath(lexicalRoot), fs.realpath(lexicalCandidate)]);
  if (!isInside(realRoot, realCandidate)) {
    const error = new Error('Request symlink escapes the allowed workspace');
    error.code = 'BRUNO_MCP_SYMLINK_ESCAPE';
    throw error;
  }
  return realCandidate;
};

const fileExists = async (pathname) => {
  try {
    await fs.access(pathname);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
};

const findCollectionRoot = async (workspacePath, requestPath) => {
  const root = path.resolve(workspacePath);
  let current = path.dirname(path.resolve(requestPath));
  while (isInside(root, current)) {
    if (
      await fileExists(path.join(current, 'bruno.json'))
      || await fileExists(path.join(current, 'collection.bru'))
      || await fileExists(path.join(current, 'collection.yml'))
      || await fileExists(path.join(current, 'opencollection.yml'))
    ) return current;
    if (current === root) break;
    current = path.dirname(current);
  }
  return path.dirname(path.resolve(requestPath));
};

const isRequestFilename = (name) => /\.(bru|ya?ml)$/i.test(name)
  && !/^(collection|folder)\.(bru|ya?ml)$/i.test(name)
  && !/^opencollection\.yml$/i.test(name);

const walkRequestFiles = async (directory, limit, output = []) => {
  if (output.length >= limit) return output;
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return output;
    throw error;
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (output.length >= limit) break;
    if (entry.isSymbolicLink()) continue;
    const pathname = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRECTORIES.has(entry.name)) await walkRequestFiles(pathname, limit, output);
    } else if (entry.isFile() && isRequestFilename(entry.name)) {
      output.push(pathname);
    }
  }
  return output;
};

const parseRequestAsset = async ({ workspacePath, collectionPath, itemPathname }) => {
  const workspace = path.resolve(workspacePath);
  const collection = path.isAbsolute(collectionPath) ? path.resolve(collectionPath) : path.resolve(workspace, collectionPath);
  const requestPath = path.resolve(collection, itemPathname);
  await assertSafePath(workspace, collection);
  const realRequestPath = await assertSafePath(collection, requestPath);
  const content = await fs.readFile(realRequestPath, 'utf8');
  const item = await parseRequest(content, { format: /\.ya?ml$/i.test(realRequestPath) ? 'yml' : getCollectionFormat(collection) });
  item.pathname = requestPath;
  item.uid = item.uid || stableId('request', requestPath);
  item.name = item.name || path.basename(requestPath, path.extname(requestPath));
  if (!REQUEST_TYPES.has(item.type)) {
    const error = new Error(`${itemPathname} is not an executable Bruno request`);
    error.code = 'BRUNO_MCP_REQUEST_INVALID';
    throw error;
  }
  return {
    collectionPath: path.relative(workspace, collection).split(path.sep).join('/'),
    itemPathname: path.relative(collection, requestPath).split(path.sep).join('/'),
    collection: {
      uid: stableId('collection', collection),
      name: path.basename(collection),
      pathname: collection,
      items: []
    },
    item
  };
};

class BrunoWorkspaceCatalog {
  constructor({ configProvider }) {
    this.configProvider = configProvider;
  }

  getConfig() {
    return this.configProvider();
  }

  listWorkspaces() {
    return this.getConfig().allowedWorkspaces.map((workspace) => ({
      uid: workspace.uid,
      name: workspace.name,
      path: workspace.path
    }));
  }

  resolveWorkspace({ workspace_uid: workspaceUid, workspace_path: workspacePath } = {}) {
    const workspaces = this.getConfig().allowedWorkspaces;
    const candidate = workspaceUid
      ? workspaces.find((workspace) => workspace.uid === workspaceUid)
      : workspacePath
        ? workspaces.find((workspace) => path.resolve(workspace.path) === path.resolve(workspacePath))
        : workspaces.length === 1 ? workspaces[0] : null;
    if (!candidate) {
      const error = new Error('Workspace is not in the Bruno MCP allowlist');
      error.code = 'BRUNO_MCP_WORKSPACE_FORBIDDEN';
      error.statusCode = 403;
      throw error;
    }
    return candidate;
  }

  async resolveFlowRequestCatalog(workspace, flow) {
    const requestNodes = flow.nodes.filter((node) => node.requestRef);
    const assets = [];
    for (const node of requestNodes) {
      const asset = await parseRequestAsset({
        workspacePath: workspace.path,
        collectionPath: node.requestRef.collectionPath,
        itemPathname: node.requestRef.itemPathname
      });
      if (!assets.some((candidate) => candidate.collectionPath === asset.collectionPath && candidate.itemPathname === asset.itemPathname)) {
        assets.push(asset);
      }
    }
    return assets;
  }

  async listRequests(workspace, { query = '', limit = 200 } = {}) {
    const config = this.getConfig();
    const files = await walkRequestFiles(workspace.path, config.maxRequestFiles);
    const normalizedQuery = String(query || '').trim().toLowerCase();
    const results = [];
    for (const requestPath of files) {
      if (results.length >= Math.max(1, Math.min(1000, Number(limit) || 200))) break;
      try {
        const collectionRoot = await findCollectionRoot(workspace.path, requestPath);
        const asset = await parseRequestAsset({
          workspacePath: workspace.path,
          collectionPath: collectionRoot,
          itemPathname: path.relative(collectionRoot, requestPath)
        });
        const projection = this.projectRequest(workspace, asset);
        const haystack = [projection.name, projection.method, projection.url, projection.item_pathname, projection.collection_path].join(' ').toLowerCase();
        if (!normalizedQuery || haystack.includes(normalizedQuery)) results.push(projection);
      } catch (_) {
        // Non-request files and temporarily invalid drafts are skipped from discovery.
      }
    }
    return results;
  }

  async getRequest(workspace, { request_uid: requestUid, collection_path: collectionPath, item_pathname: itemPathname } = {}) {
    if (collectionPath && itemPathname) {
      return this.projectRequest(workspace, await parseRequestAsset({ workspacePath: workspace.path, collectionPath, itemPathname }), { includeDefinition: true });
    }
    if (!requestUid) throw new TypeError('request_uid or collection_path + item_pathname is required');
    const requests = await this.listRequests(workspace, { limit: this.getConfig().maxRequestFiles });
    const found = requests.find((request) => request.uid === requestUid);
    if (!found) {
      const error = new Error(`Request ${requestUid} was not found in the allowed workspace`);
      error.code = 'BRUNO_MCP_REQUEST_NOT_FOUND';
      throw error;
    }
    const asset = await parseRequestAsset({
      workspacePath: workspace.path,
      collectionPath: found.collection_path,
      itemPathname: found.item_pathname
    });
    return this.projectRequest(workspace, asset, { includeDefinition: true });
  }

  projectRequest(workspace, asset, { includeDefinition = false } = {}) {
    const request = asset.item.request || {};
    const projection = {
      uid: asset.item.uid || stableId('request', `${workspace.uid}:${asset.collectionPath}:${asset.itemPathname}`),
      name: asset.item.name,
      type: asset.item.type,
      method: request.method || request.methodType || null,
      url: request.url || request.endpoint || '',
      workspace_uid: workspace.uid,
      collection_path: asset.collectionPath,
      item_pathname: asset.itemPathname
    };
    if (includeDefinition) projection.definition = redactMcpValue(asset.item);
    return projection;
  }
}

module.exports = {
  BrunoWorkspaceCatalog,
  REQUEST_TYPES,
  assertSafePath,
  findCollectionRoot,
  isInside,
  parseRequestAsset,
  stableId,
  isRequestFilename,
  walkBruFiles: walkRequestFiles,
  walkRequestFiles
};
