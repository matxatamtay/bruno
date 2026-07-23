const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { cloneDeep, get, set, unset } = require('lodash');
const {
  parseRequest,
  stringifyRequest,
  parseCollection,
  stringifyCollection,
  parseFolder,
  stringifyFolder,
  parseEnvironment,
  stringifyEnvironment
} = require('@usebruno/filestore');
const { utils } = require('@usebruno/common');
const { dotenvToJson } = require('@usebruno/lang');
const {
  DEFAULT_GITIGNORE,
  getCollectionFormat,
  sanitizeName,
  scanForBrunoFiles,
  validateName,
  writeFile
} = require('../utils/filesystem');
const { generateUidBasedOnHash, stringifyJson } = require('../utils/common');
const { transformBrunoConfigBeforeSave, transformBrunoConfigAfterRead } = require('../utils/transformBrunoConfig');
const EnvironmentSecretsStore = require('../store/env-secrets');
const { filterByName } = require('./name-filter');

const REQUEST_TYPES = new Set(['http-request', 'graphql-request', 'grpc-request', 'ws-request']);
const ROOT_FILES = new Set(['bruno.json', 'collection.bru', 'opencollection.yml']);
const RESERVED_DIRECTORIES = new Set(['.git', '.bruno', 'node_modules', 'dist', 'build', 'environments']);
const environmentSecretsStore = new EnvironmentSecretsStore();

const posixify = (value) => String(value || '').split(path.sep).join('/');
const exists = async (pathname) => fsPromises.access(pathname).then(() => true).catch((error) => {
  if (error?.code === 'ENOENT') return false;
  throw error;
});

// OpenCollection does not persist top-level UIDs, so parser-generated values are transient.
const resolveDocumentUid = (definition, pathname, format) => {
  const uid = format === 'yml'
    ? generateUidBasedOnHash(path.resolve(pathname))
    : definition.uid || generateUidBasedOnHash(path.resolve(pathname));

  if (format === 'yml') definition.uid = uid;
  return uid;
};

const isInside = (parent, child) => {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

const assertInside = (parent, child, label = 'Path') => {
  if (!isInside(parent, child)) {
    const error = new Error(`${label} must stay inside ${parent}`);
    error.code = 'BRUNO_MCP_PATH_OUTSIDE_ROOT';
    throw error;
  }
  return path.resolve(child);
};

const clone = (value) => cloneDeep(value);

const mergeValue = (base, patch) => {
  if (patch === undefined) return clone(base);
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) return clone(patch);
  const output = base && typeof base === 'object' && !Array.isArray(base) ? clone(base) : {};
  Object.entries(patch).forEach(([key, value]) => {
    output[key] = mergeValue(output[key], value);
  });
  return output;
};

const applyMutation = (definition, { definition: replacement, changes, set: setValues, unset: unsetPaths } = {}) => {
  let next = replacement !== undefined ? clone(replacement) : clone(definition);
  if (changes !== undefined) next = mergeValue(next, changes);
  Object.entries(setValues || {}).forEach(([fieldPath, value]) => set(next, fieldPath, clone(value)));
  (unsetPaths || []).forEach((fieldPath) => unset(next, fieldPath));
  return next;
};

const ensureObject = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
};

const requestType = (value = 'http') => {
  const normalized = String(value || 'http').trim().toLowerCase();
  if (REQUEST_TYPES.has(normalized)) return normalized;
  if (normalized === 'graphql') return 'graphql-request';
  if (normalized === 'grpc') return 'grpc-request';
  if (normalized === 'ws' || normalized === 'websocket') return 'ws-request';
  if (normalized === 'sse') return 'http-request';
  return 'http-request';
};

const createRequestDefinition = ({ name, type = 'http', method, url = '', seq = 1, definition = {} } = {}) => {
  const resolvedType = requestType(type);
  const base = {
    uid: randomUUID(),
    type: resolvedType,
    name: String(name || 'New request'),
    seq: Number(seq) || 1,
    description: '',
    tags: [],
    settings: {},
    request: {
      url: String(url || ''),
      method: String(method || (resolvedType === 'graphql-request' ? 'POST' : 'GET')).toUpperCase(),
      headers: [],
      params: [],
      auth: { mode: 'none' },
      body: { mode: 'none' },
      script: { req: '', res: '' },
      vars: { req: [], res: [] },
      assertions: [],
      tests: '',
      docs: ''
    },
    examples: []
  };
  if (resolvedType === 'graphql-request') base.request.body = { mode: 'graphql', graphql: { query: '', variables: '' } };
  if (resolvedType === 'grpc-request') {
    base.request.method = '';
    base.request.methodType = '';
    base.request.protoPath = '';
    base.request.body = { mode: 'grpc', grpc: [{ name: 'Message 1', content: '{}', selected: true }] };
    delete base.request.params;
  }
  if (resolvedType === 'ws-request') {
    delete base.request.method;
    delete base.request.params;
    base.request.body = { mode: 'ws', ws: [{ name: 'Message 1', type: 'text', content: '', selected: true }] };
  }
  return mergeValue(base, definition);
};

const tabPath = (type, tab) => {
  const normalized = String(tab || '').trim().toLowerCase();
  const aliases = {
    params: 'request.params',
    body: 'request.body',
    headers: 'request.headers',
    metadata: 'request.headers',
    auth: 'request.auth',
    vars: 'request.vars',
    variables: 'request.vars',
    script: 'request.script',
    scripts: 'request.script',
    assert: 'request.assertions',
    assertions: 'request.assertions',
    tests: 'request.tests',
    docs: 'request.docs',
    documentation: 'request.docs',
    query: 'request.body.graphql',
    message: type === 'ws-request' ? 'request.body.ws' : 'request.body.grpc',
    messages: type === 'ws-request' ? 'request.body.ws' : 'request.body.grpc',
    app: 'app',
    examples: 'examples',
    settings: '$settings'
  };
  return aliases[normalized] || normalized;
};

const collectionTabPaths = {
  'overview': '$overview',
  'headers': 'root.request.headers',
  'vars': 'root.request.vars',
  'variables': 'root.request.vars',
  'auth': 'root.request.auth',
  'script': 'root.request.script',
  'scripts': 'root.request.script',
  'tests': 'root.request.tests',
  'docs': 'root.docs',
  'presets': 'brunoConfig.presets',
  'proxy': 'brunoConfig.proxy',
  'clientcertificates': 'brunoConfig.clientCertificates',
  'client-certificates': 'brunoConfig.clientCertificates',
  'protobuf': 'brunoConfig.protobuf'
};

const folderTabPaths = {
  headers: 'request.headers',
  vars: 'request.vars',
  variables: 'request.vars',
  auth: 'request.auth',
  script: 'request.script',
  scripts: 'request.script',
  test: 'request.tests',
  tests: 'request.tests',
  docs: 'docs',
  settings: 'meta'
};

class BrunoCollectionService {
  constructor({ configProvider, onWorkspaceResolved }) {
    this.configProvider = configProvider;
    this.onWorkspaceResolved = onWorkspaceResolved;
  }

  getConfig() {
    return this.configProvider?.() || {};
  }

  listWorkspaces(input = {}) {
    const workspaces = (this.getConfig().workspaces || []).map((workspace) => ({ ...workspace }));
    return filterByName(workspaces, input);
  }

  async resolveWorkspace({ workspace_uid: workspaceUid, workspace_path: workspacePath, _skipWorkspaceActivation = false } = {}) {
    const known = this.listWorkspaces();
    let workspace;
    if (workspacePath) {
      const pathname = path.resolve(workspacePath);
      const knownEntry = known.find((candidate) => path.resolve(candidate.path) === pathname);
      workspace = knownEntry || { uid: generateUidBasedOnHash(pathname), name: path.basename(pathname), path: pathname };
    } else if (workspaceUid) {
      workspace = known.find((candidate) => candidate.uid === workspaceUid);
      if (!workspace) {
        const error = new Error(`Workspace ${workspaceUid} was not found`);
        error.code = 'BRUNO_MCP_WORKSPACE_NOT_FOUND';
        throw error;
      }
    } else if (known.length === 1) {
      workspace = known[0];
    } else {
      const error = new Error('workspace_path or workspace_uid is required when multiple workspaces are configured');
      error.code = 'BRUNO_MCP_WORKSPACE_REQUIRED';
      throw error;
    }
    if (this.onWorkspaceResolved && !_skipWorkspaceActivation) {
      await this.onWorkspaceResolved(workspace).catch((error) => {
        console.error('Bruno MCP failed to activate workspace:', error?.message || error);
      });
    }
    return workspace;
  }

  resolveCollection(workspace, collectionPath) {
    if (!collectionPath) throw new TypeError('collection_path is required');
    const pathname = path.isAbsolute(collectionPath)
      ? path.resolve(collectionPath)
      : path.resolve(workspace.path, collectionPath);
    return pathname;
  }

  collectionReference(workspace, collectionPath) {
    const pathname = this.resolveCollection(workspace, collectionPath);
    return {
      uid: generateUidBasedOnHash(pathname),
      name: path.basename(pathname),
      path: pathname,
      collection_path: isInside(workspace.path, pathname) ? posixify(path.relative(workspace.path, pathname)) : pathname,
      format: getCollectionFormat(pathname)
    };
  }

  async listCollections(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const paths = await scanForBrunoFiles(workspace.path);
    const query = String(input.query || '').trim().toLowerCase();
    const collections = [];
    for (const collectionPath of paths) {
      try {
        const document = await this.readCollectionDocument(collectionPath);
        const projection = {
          uid: generateUidBasedOnHash(collectionPath),
          name: document.brunoConfig.name || document.root?.meta?.name || path.basename(collectionPath),
          format: document.format,
          collection_path: posixify(path.relative(workspace.path, collectionPath)),
          pathname: collectionPath
        };
        const haystack = `${projection.name} ${projection.collection_path}`.toLowerCase();
        if (!query || haystack.includes(query)) collections.push(projection);
      } catch (_) {
        // Ignore incomplete folders during discovery.
      }
    }
    return { workspace_uid: workspace.uid, workspace_path: workspace.path, count: collections.length, collections };
  }

  async readCollectionDocument(collectionPath) {
    const format = getCollectionFormat(collectionPath);
    if (format === 'yml') {
      const content = await fsPromises.readFile(path.join(collectionPath, 'opencollection.yml'), 'utf8');
      const parsed = parseCollection(content, { format: 'yml' });
      return {
        format,
        root: parsed.collectionRoot || {},
        brunoConfig: await transformBrunoConfigAfterRead(parsed.brunoConfig || {}, collectionPath)
      };
    }
    const configPath = path.join(collectionPath, 'bruno.json');
    const rootPath = path.join(collectionPath, 'collection.bru');
    const brunoConfig = await transformBrunoConfigAfterRead(JSON.parse(await fsPromises.readFile(configPath, 'utf8')), collectionPath);
    const root = await exists(rootPath) ? parseCollection(await fsPromises.readFile(rootPath, 'utf8'), { format: 'bru' }) : {};
    return { format, root, brunoConfig };
  }

  async writeCollectionDocument(collectionPath, document) {
    const format = document.format || getCollectionFormat(collectionPath);
    const brunoConfig = transformBrunoConfigBeforeSave(clone(document.brunoConfig || {}));
    const root = clone(document.root || {});
    if (format === 'yml') {
      await writeFile(path.join(collectionPath, 'opencollection.yml'), stringifyCollection(root, brunoConfig, { format }));
      return;
    }
    await writeFile(path.join(collectionPath, 'bruno.json'), await stringifyJson(brunoConfig));
    const rootPath = path.join(collectionPath, 'collection.bru');
    const rootContent = stringifyCollection(root, brunoConfig, { format });
    if (rootContent.trim()) await writeFile(rootPath, rootContent);
    else if (await exists(rootPath)) await fsPromises.unlink(rootPath);
  }

  async getCollection(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    const document = await this.readCollectionDocument(collectionPath);
    const tree = await this.listItems({ ...input, workspace_path: workspace.path, collection_path: collectionPath });
    return {
      workspace_uid: workspace.uid,
      workspace_path: workspace.path,
      uid: generateUidBasedOnHash(collectionPath),
      name: document.brunoConfig.name || document.root?.meta?.name || path.basename(collectionPath),
      pathname: collectionPath,
      collection_path: isInside(workspace.path, collectionPath) ? posixify(path.relative(workspace.path, collectionPath)) : collectionPath,
      format: document.format,
      brunoConfig: document.brunoConfig,
      root: document.root,
      items: tree.items,
      environments: await this.listEnvironments({ ...input, workspace_path: workspace.path, collection_path: collectionPath }).then((result) => result.environments)
    };
  }

  async createCollection(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const parentPath = path.resolve(input.location || workspace.path);
    const folderName = sanitizeName(String(input.folder_name || input.name || 'collection'));
    if (!folderName || !validateName(folderName)) throw new Error(`${folderName || 'Collection'} is not a valid folder name`);
    const collectionPath = path.join(parentPath, folderName);
    if (await exists(collectionPath)) throw new Error(`Collection path ${collectionPath} already exists`);
    await fsPromises.mkdir(collectionPath, { recursive: true });
    const format = input.format === 'yml' ? 'yml' : 'bru';
    const name = String(input.name || folderName);
    const brunoConfig = mergeValue(format === 'yml'
      ? { opencollection: '1.0.0', name, type: 'collection', ignore: ['node_modules', '.git'] }
      : { version: '1', name, type: 'collection', ignore: ['node_modules', '.git'] }, input.bruno_config || {});
    const root = mergeValue({ meta: { name } }, input.root || {});
    await this.writeCollectionDocument(collectionPath, { format, brunoConfig, root });
    await writeFile(path.join(collectionPath, '.gitignore'), DEFAULT_GITIGNORE);
    return this.getCollection({ workspace_path: workspace.path, collection_path: collectionPath });
  }

  async updateCollection(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    const current = await this.readCollectionDocument(collectionPath);
    const source = { root: current.root, brunoConfig: current.brunoConfig };
    const next = applyMutation(source, input);
    if (input.name !== undefined) {
      next.brunoConfig = next.brunoConfig || {};
      next.brunoConfig.name = String(input.name);
      next.root = next.root || {};
      next.root.meta = next.root.meta || {};
      next.root.meta.name = String(input.name);
    }
    await this.writeCollectionDocument(collectionPath, { ...current, ...next });
    return this.getCollection({ workspace_path: workspace.path, collection_path: collectionPath });
  }

  async updateCollectionTab(input = {}) {
    const tab = String(input.tab || '').toLowerCase().replace(/\s+/g, '');
    const targetPath = collectionTabPaths[tab];
    if (!targetPath) throw new Error(`Unsupported collection tab ${input.tab}`);
    if (targetPath === '$overview') {
      return this.updateCollection({ ...input, name: input.value?.name, changes: { brunoConfig: input.value?.brunoConfig, root: input.value?.root } });
    }
    return this.updateCollection({ ...input, set: { [targetPath]: input.value } });
  }

  async cloneCollection(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const sourcePath = this.resolveCollection(workspace, input.collection_path);
    const targetLocation = path.resolve(input.target_location || workspace.path);
    const folderName = sanitizeName(String(input.folder_name || `${path.basename(sourcePath)}-copy`));
    if (!folderName || !validateName(folderName)) throw new Error(`${folderName || 'Collection'} is not a valid folder name`);
    const targetPath = path.join(targetLocation, folderName);
    if (await exists(targetPath)) throw new Error(`Collection ${targetPath} already exists`);
    await fsPromises.mkdir(targetLocation, { recursive: true });
    await fsPromises.cp(sourcePath, targetPath, { recursive: true, errorOnExist: true, force: false });
    if (input.name) {
      await this.updateCollection({ workspace_path: workspace.path, collection_path: targetPath, name: input.name });
    }
    return this.getCollection({ workspace_path: workspace.path, collection_path: targetPath });
  }

  async moveCollection(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const sourcePath = this.resolveCollection(workspace, input.collection_path);
    const targetLocation = path.resolve(input.target_location || path.dirname(sourcePath));
    const folderName = sanitizeName(String(input.folder_name || path.basename(sourcePath)));
    if (!folderName || !validateName(folderName)) throw new Error(`${folderName || 'Collection'} is not a valid folder name`);
    const targetPath = path.join(targetLocation, folderName);
    if (sourcePath !== targetPath && await exists(targetPath)) throw new Error(`Collection ${targetPath} already exists`);
    await fsPromises.mkdir(targetLocation, { recursive: true });
    if (sourcePath !== targetPath) {
      try {
        await fsPromises.rename(sourcePath, targetPath);
      } catch (error) {
        if (error?.code !== 'EXDEV') throw error;
        await fsPromises.cp(sourcePath, targetPath, { recursive: true, errorOnExist: true, force: false });
        await fsPromises.rm(sourcePath, { recursive: true, force: true });
      }
    }
    if (input.name) await this.updateCollection({ workspace_path: workspace.path, collection_path: targetPath, name: input.name });
    return this.getCollection({ workspace_path: workspace.path, collection_path: targetPath });
  }

  async deleteCollection(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    if (!await exists(collectionPath)) throw new Error(`Collection ${collectionPath} does not exist`);
    await fsPromises.rm(collectionPath, { recursive: true, force: true });
    return { deleted: true, workspace_uid: workspace.uid, collection_path: input.collection_path, pathname: collectionPath };
  }

  async resequenceItems(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    const format = getCollectionFormat(collectionPath);
    const results = [];
    for (const entry of input.items || []) {
      const itemPath = assertInside(collectionPath, path.resolve(collectionPath, entry.path), 'Item path');
      if (!await exists(itemPath)) throw new Error(`Item ${entry.path} does not exist`);
      const stats = await fsPromises.stat(itemPath);
      if (stats.isDirectory()) {
        const folderFile = path.join(itemPath, `folder.${format}`);
        const definition = await exists(folderFile) ? parseFolder(await fsPromises.readFile(folderFile, 'utf8'), { format }) : { meta: { name: path.basename(itemPath) } };
        definition.meta = definition.meta || {};
        definition.meta.seq = Number(entry.seq);
        await writeFile(folderFile, stringifyFolder(definition, { format }));
        results.push({ path: entry.path, type: 'folder', seq: definition.meta.seq });
      } else {
        const definition = parseRequest(await fsPromises.readFile(itemPath, 'utf8'), { format });
        definition.seq = Number(entry.seq);
        await writeFile(itemPath, stringifyRequest(definition, { format }));
        results.push({ path: entry.path, type: definition.type, seq: definition.seq });
      }
    }
    return { collection_path: input.collection_path, items: results };
  }

  async listItems(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    const format = getCollectionFormat(collectionPath);
    const extension = format === 'yml' ? '.yml' : '.bru';
    const walk = async (directory) => {
      const output = [];
      const entries = await fsPromises.readdir(directory, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        const pathname = path.join(directory, entry.name);
        const relativePath = posixify(path.relative(collectionPath, pathname));
        if (entry.isDirectory()) {
          if (RESERVED_DIRECTORIES.has(entry.name)) continue;
          const folderFile = path.join(pathname, `folder.${format}`);
          const root = await exists(folderFile) ? parseFolder(await fsPromises.readFile(folderFile, 'utf8'), { format }) : { meta: { name: entry.name } };
          output.push({
            type: 'folder',
            uid: generateUidBasedOnHash(pathname),
            name: root?.meta?.name || entry.name,
            seq: root?.meta?.seq || null,
            folder_path: relativePath,
            pathname,
            root,
            items: await walk(pathname)
          });
          continue;
        }
        if (ROOT_FILES.has(entry.name) || entry.name === '.gitignore' || entry.name === `folder.${format}` || !entry.name.endsWith(extension)) continue;
        try {
          const definition = parseRequest(await fsPromises.readFile(pathname, 'utf8'), { format });
          if (!REQUEST_TYPES.has(definition.type) && definition.type !== 'app') continue;
          output.push({
            uid: resolveDocumentUid(definition, pathname, format),
            type: definition.type,
            name: definition.name || path.basename(entry.name, extension),
            seq: definition.seq || null,
            method: definition.request?.method || definition.request?.methodType || null,
            url: definition.request?.url || '',
            item_pathname: relativePath,
            pathname
          });
        } catch (_) {
          output.push({ type: 'invalid', name: entry.name, item_pathname: relativePath, pathname });
        }
      }
      return output;
    };
    return { workspace_uid: workspace.uid, collection_path: input.collection_path, format, items: await walk(collectionPath) };
  }

  async getFolder(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    const folderPath = assertInside(collectionPath, path.resolve(collectionPath, input.folder_path || ''), 'Folder path');
    const format = getCollectionFormat(collectionPath);
    const filePath = path.join(folderPath, `folder.${format}`);
    const definition = await exists(filePath) ? parseFolder(await fsPromises.readFile(filePath, 'utf8'), { format }) : { meta: { name: path.basename(folderPath) } };
    return { workspace_uid: workspace.uid, collection_path: input.collection_path, folder_path: posixify(path.relative(collectionPath, folderPath)), pathname: folderPath, format, definition };
  }

  async createFolder(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    const parent = assertInside(collectionPath, path.resolve(collectionPath, input.parent_path || ''), 'Folder parent');
    const folderName = sanitizeName(String(input.folder_name || input.name || 'folder'));
    if (!folderName || !validateName(folderName)) throw new Error(`${folderName || 'Folder'} is not a valid folder name`);
    const folderPath = path.join(parent, folderName);
    if (await exists(folderPath)) throw new Error(`Folder ${folderPath} already exists`);
    await fsPromises.mkdir(folderPath, { recursive: false });
    const format = getCollectionFormat(collectionPath);
    const definition = mergeValue({ meta: { name: String(input.name || folderName), seq: input.seq || 1 }, request: { headers: [], auth: { mode: 'inherit' }, script: { req: '', res: '' }, vars: { req: [], res: [] }, tests: '' }, docs: '' }, input.definition || {});
    await writeFile(path.join(folderPath, `folder.${format}`), stringifyFolder(definition, { format }));
    return this.getFolder({ workspace_path: workspace.path, collection_path: collectionPath, folder_path: path.relative(collectionPath, folderPath) });
  }

  async updateFolder(input = {}) {
    const current = await this.getFolder(input);
    const next = applyMutation(current.definition, input);
    await writeFile(path.join(current.pathname, `folder.${current.format}`), stringifyFolder(next, { format: current.format }));
    return this.getFolder(input);
  }

  async updateFolderTab(input = {}) {
    const targetPath = folderTabPaths[String(input.tab || '').trim().toLowerCase()];
    if (!targetPath) throw new Error(`Unsupported folder tab ${input.tab}`);
    return this.updateFolder({ ...input, set: { [targetPath]: input.value } });
  }

  async deleteFolder(input = {}) {
    const current = await this.getFolder(input);
    await fsPromises.rm(current.pathname, { recursive: true, force: true });
    return { deleted: true, folder_path: current.folder_path, pathname: current.pathname };
  }

  async listRequests(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const collections = input.collection_path
      ? [{ collection_path: input.collection_path }]
      : (await this.listCollections({
          workspace_path: workspace.path,
          _skipWorkspaceActivation: input._skipWorkspaceActivation
        })).collections;
    const query = String(input.query || '').trim().toLowerCase();
    const limit = Math.max(1, Math.min(10000, Number(input.limit) || this.getConfig().maxRequestFiles || 10000));
    const requests = [];
    const collectItems = (items, collectionPath) => {
      for (const item of items || []) {
        if (requests.length >= limit) return;
        if (item.type === 'folder') {
          collectItems(item.items, collectionPath);
          continue;
        }
        if (!REQUEST_TYPES.has(item.type) && item.type !== 'app') continue;
        const projection = {
          uid: item.uid,
          name: item.name,
          type: item.type,
          method: item.method,
          url: item.url,
          workspace_uid: workspace.uid,
          collection_path: collectionPath,
          item_pathname: item.item_pathname,
          pathname: item.pathname
        };
        const haystack = `${projection.name} ${projection.type} ${projection.method || ''} ${projection.url || ''} ${projection.collection_path} ${projection.item_pathname}`.toLowerCase();
        if (!query || haystack.includes(query)) requests.push(projection);
      }
    };
    for (const collection of collections) {
      if (requests.length >= limit) break;
      const tree = await this.listItems({
        workspace_path: workspace.path,
        collection_path: collection.collection_path,
        _skipWorkspaceActivation: input._skipWorkspaceActivation
      });
      collectItems(tree.items, collection.collection_path);
    }
    return { workspace_uid: workspace.uid, workspace_path: workspace.path, count: requests.length, requests };
  }

  async getRequest(input = {}) {
    if (input.collection_path && input.item_pathname) return this.readRequest(input);
    if (!input.request_uid) throw new TypeError('request_uid or collection_path + item_pathname is required');
    const listed = await this.listRequests({ ...input, query: '', limit: this.getConfig().maxRequestFiles || 10000 });
    const matches = listed.requests.filter((request) => request.uid === input.request_uid);
    if (matches.length === 0) throw new Error(`Request ${input.request_uid} was not found`);
    if (matches.length > 1) throw new Error(`Request ${input.request_uid} is ambiguous; provide collection_path and item_pathname`);
    return this.readRequest({ ...input, collection_path: matches[0].collection_path, item_pathname: matches[0].item_pathname });
  }

  async readRequest(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    const requestPath = assertInside(collectionPath, path.resolve(collectionPath, input.item_pathname || ''), 'Request path');
    if (!await exists(requestPath)) throw new Error(`Request ${input.item_pathname} does not exist`);
    const format = getCollectionFormat(collectionPath);
    const definition = parseRequest(await fsPromises.readFile(requestPath, 'utf8'), { format });
    const uid = resolveDocumentUid(definition, requestPath, format);
    return {
      workspace_uid: workspace.uid,
      workspace_path: workspace.path,
      collection_path: isInside(workspace.path, collectionPath) ? posixify(path.relative(workspace.path, collectionPath)) : collectionPath,
      collection_pathname: collectionPath,
      item_pathname: posixify(path.relative(collectionPath, requestPath)),
      pathname: requestPath,
      format,
      uid,
      name: definition.name,
      type: definition.type,
      definition
    };
  }

  async createRequest(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    const format = getCollectionFormat(collectionPath);
    const parent = assertInside(collectionPath, path.resolve(collectionPath, input.folder_path || ''), 'Request folder');
    if (!await exists(parent)) throw new Error(`Folder ${input.folder_path || '.'} does not exist`);
    const definition = createRequestDefinition(input);
    const baseName = sanitizeName(String(input.filename || input.name || definition.name || 'request').replace(/\.(bru|ya?ml)$/i, ''));
    if (!baseName || !validateName(baseName)) throw new Error(`${baseName || 'Request'} is not a valid filename`);
    definition.filename = `${baseName}.${format}`;
    const requestPath = path.join(parent, definition.filename);
    if (await exists(requestPath)) throw new Error(`Request ${requestPath} already exists`);
    await writeFile(requestPath, stringifyRequest(definition, { format }));
    return this.readRequest({
      workspace_path: workspace.path,
      collection_path: collectionPath,
      item_pathname: path.relative(collectionPath, requestPath),
      _skipWorkspaceActivation: input._skipWorkspaceActivation
    });
  }

  async updateRequest(input = {}) {
    const current = await this.getRequest(input);
    let next = applyMutation(current.definition, input);
    if (input.name !== undefined) next.name = String(input.name);
    let targetPath = current.pathname;
    if (input.new_item_pathname) {
      targetPath = assertInside(current.collection_pathname, path.resolve(current.collection_pathname, input.new_item_pathname), 'Request path');
      const extension = current.format === 'yml' ? '.yml' : '.bru';
      if (!targetPath.endsWith(extension)) targetPath += extension;
      if (targetPath !== current.pathname && await exists(targetPath)) throw new Error(`Request ${targetPath} already exists`);
      await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
      next.filename = path.basename(targetPath);
    }
    ensureObject(next, 'request definition');
    if (!REQUEST_TYPES.has(next.type) && next.type !== 'app') throw new Error(`Unsupported request type ${next.type}`);
    await writeFile(targetPath, stringifyRequest(next, { format: current.format }));
    if (targetPath !== current.pathname) await fsPromises.unlink(current.pathname);
    return this.readRequest({
      workspace_path: current.workspace_path,
      collection_path: current.collection_pathname,
      item_pathname: path.relative(current.collection_pathname, targetPath),
      _skipWorkspaceActivation: input._skipWorkspaceActivation
    });
  }

  async updateRequestTab(input = {}) {
    const current = await this.getRequest(input);
    const targetPath = tabPath(current.type, input.tab);
    if (!targetPath) throw new Error(`Unsupported request tab ${input.tab}`);
    if (targetPath === '$settings') {
      const settings = ensureObject(input.value || {}, 'settings');
      const changes = {};
      ['name', 'tags', 'seq', 'settings'].forEach((field) => {
        if (Object.prototype.hasOwnProperty.call(settings, field)) changes[field] = settings[field];
      });
      return this.updateRequest({ ...input, changes });
    }
    return this.updateRequest({ ...input, set: { [targetPath]: input.value } });
  }

  async deleteRequest(input = {}) {
    const current = await this.getRequest(input);
    await fsPromises.unlink(current.pathname);
    return { deleted: true, uid: current.uid, name: current.name, item_pathname: current.item_pathname, pathname: current.pathname };
  }

  async duplicateRequest(input = {}) {
    const current = await this.getRequest(input);
    const copy = clone(current.definition);
    copy.uid = randomUUID();
    copy.name = String(input.name || `${current.name} copy`);
    return this.createRequest({
      workspace_path: current.workspace_path,
      collection_path: current.collection_pathname,
      folder_path: input.folder_path ?? (posixify(path.dirname(current.item_pathname)) === '.' ? '' : posixify(path.dirname(current.item_pathname))),
      filename: input.filename || `${path.basename(current.item_pathname, path.extname(current.item_pathname))}-copy`,
      definition: copy,
      name: copy.name,
      type: copy.type,
      _skipWorkspaceActivation: input._skipWorkspaceActivation
    });
  }

  async moveItem(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    const source = assertInside(collectionPath, path.resolve(collectionPath, input.source_path), 'Source path');
    const targetDirectory = assertInside(collectionPath, path.resolve(collectionPath, input.target_folder || ''), 'Target folder');
    if (!await exists(source)) throw new Error(`Source ${input.source_path} does not exist`);
    if (!await exists(targetDirectory)) throw new Error(`Target folder ${input.target_folder || '.'} does not exist`);
    const target = path.join(targetDirectory, input.new_filename || path.basename(source));
    if (await exists(target)) throw new Error(`Target ${target} already exists`);
    await fsPromises.rename(source, target);
    return { moved: true, source_path: input.source_path, target_path: posixify(path.relative(collectionPath, target)), pathname: target };
  }

  async listEnvironments(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    const format = getCollectionFormat(collectionPath);
    const directory = path.join(collectionPath, 'environments');
    if (!await exists(directory)) return { workspace_uid: workspace.uid, collection_path: input.collection_path, environments: [] };
    const files = (await fsPromises.readdir(directory)).filter((name) => name.endsWith(`.${format}`)).sort();
    const environments = [];
    for (const filename of files) {
      const pathname = path.join(directory, filename);
      const definition = parseEnvironment(await fsPromises.readFile(pathname, 'utf8'), { format });
      const uid = resolveDocumentUid(definition, pathname, format);
      try {
        const secrets = environmentSecretsStore.getEnvSecrets(collectionPath, definition) || [];
        secrets.forEach((secret) => {
          const variable = (definition.variables || []).find((candidate) => candidate.name === secret.name);
          if (variable && secret.value) variable.encryptedValue = secret.value;
        });
      } catch (_) {
        // Return the file definition even when the desktop secret store is unavailable.
      }
      environments.push({ uid, name: definition.name || path.basename(filename, `.${format}`), filename, definition });
    }
    return { workspace_uid: workspace.uid, collection_path: input.collection_path, environments };
  }

  async getEnvironment(input = {}) {
    const result = await this.listEnvironments(input);
    const environment = input.environment_uid
      ? result.environments.find((candidate) => candidate.uid === input.environment_uid)
      : result.environments.find((candidate) => candidate.name === input.environment_name || candidate.filename === input.environment_filename);
    if (!environment) throw new Error(`Environment ${input.environment_uid || input.environment_name || input.environment_filename || ''} was not found`);
    return { ...result, environment, environments: undefined };
  }

  async createEnvironment(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    const format = getCollectionFormat(collectionPath);
    const directory = path.join(collectionPath, 'environments');
    await fsPromises.mkdir(directory, { recursive: true });
    const name = String(input.name || 'Environment');
    const filename = `${sanitizeName(input.filename || name)}.${format}`;
    const pathname = path.join(directory, filename);
    if (await exists(pathname)) throw new Error(`Environment ${filename} already exists`);
    const definition = mergeValue({ uid: randomUUID(), name, variables: [], color: null }, input.definition || {});
    if ((definition.variables || []).some((variable) => variable.secret)) environmentSecretsStore.storeEnvSecrets(collectionPath, definition);
    await writeFile(pathname, stringifyEnvironment(definition, { format }));
    return this.getEnvironment({ workspace_path: workspace.path, collection_path: collectionPath, environment_name: definition.name });
  }

  async updateEnvironment(input = {}) {
    const current = await this.getEnvironment(input);
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    const format = getCollectionFormat(collectionPath);
    const next = applyMutation(current.environment.definition, input);
    if (input.name !== undefined) next.name = String(input.name);
    const currentPath = path.join(collectionPath, 'environments', current.environment.filename);
    const targetFilename = input.new_filename ? `${sanitizeName(String(input.new_filename).replace(/\.(bru|ya?ml)$/i, ''))}.${format}` : current.environment.filename;
    const targetPath = path.join(collectionPath, 'environments', targetFilename);
    if (targetPath !== currentPath && await exists(targetPath)) throw new Error(`Environment ${targetFilename} already exists`);
    if ((next.variables || []).some((variable) => variable.secret)) environmentSecretsStore.storeEnvSecrets(collectionPath, next);
    await writeFile(targetPath, stringifyEnvironment(next, { format }));
    if (targetPath !== currentPath) {
      await fsPromises.unlink(currentPath);
      environmentSecretsStore.renameEnvironment(collectionPath, current.environment.name, next.name);
    }
    return this.getEnvironment({ workspace_path: workspace.path, collection_path: collectionPath, environment_filename: targetFilename });
  }

  async deleteEnvironment(input = {}) {
    const current = await this.getEnvironment(input);
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    await fsPromises.unlink(path.join(collectionPath, 'environments', current.environment.filename));
    environmentSecretsStore.deleteEnvironment(collectionPath, current.environment.name);
    return { deleted: true, name: current.environment.name, filename: current.environment.filename };
  }

  async getDotEnv(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    const filename = String(input.filename || '.env');
    const pathname = assertInside(collectionPath, path.join(collectionPath, filename), 'Dotenv path');
    const content = await exists(pathname) ? await fsPromises.readFile(pathname, 'utf8') : '';
    return { workspace_uid: workspace.uid, collection_path: input.collection_path, filename, pathname, exists: Boolean(content || await exists(pathname)), content, variables: content ? dotenvToJson(content) : {} };
  }

  async setDotEnv(input = {}) {
    const workspace = await this.resolveWorkspace(input);
    const collectionPath = this.resolveCollection(workspace, input.collection_path);
    const filename = String(input.filename || '.env');
    if (!/^\.env(?:\.[A-Za-z0-9_-]+)?$/.test(filename)) throw new Error('Invalid dotenv filename');
    const pathname = path.join(collectionPath, filename);
    const dotenvVariables = Array.isArray(input.variables)
      ? input.variables
      : Object.entries(input.variables || {}).map(([name, value]) => ({ name, value }));
    const content = input.content !== undefined ? String(input.content) : utils.jsonToDotenv(dotenvVariables);
    await writeFile(pathname, content);
    return this.getDotEnv({ workspace_path: workspace.path, collection_path: collectionPath, filename });
  }

  async deleteDotEnv(input = {}) {
    const current = await this.getDotEnv(input);
    if (await exists(current.pathname)) await fsPromises.unlink(current.pathname);
    return { deleted: true, filename: current.filename, pathname: current.pathname };
  }
}

module.exports = {
  BrunoCollectionService,
  REQUEST_TYPES,
  applyMutation,
  collectionTabPaths,
  createRequestDefinition,
  folderTabPaths,
  mergeValue,
  requestType,
  tabPath
};
