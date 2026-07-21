import { describeRequest } from './request-shape';

const REQUEST_TYPES = new Set(['http-request', 'graphql-request']);

const normalizePath = (value = '') => value.replace(/\\/g, '/').replace(/\/+$/, '');

export const relativePath = (parent, child) => {
  const normalizedParent = normalizePath(parent);
  const normalizedChild = normalizePath(child);
  if (!normalizedParent || !normalizedChild.startsWith(`${normalizedParent}/`)) return normalizedChild;
  return normalizedChild.slice(normalizedParent.length + 1);
};

export const flattenRequestItems = (items = [], ancestors = []) => items.flatMap((item) => {
  if (Array.isArray(item.items)) {
    return flattenRequestItems(item.items, [...ancestors, item.name].filter(Boolean));
  }
  if (!REQUEST_TYPES.has(item.type)) return [];
  return [{ item, ancestors }];
});

export const collectRequestAssets = (collection) => flattenRequestItems(collection?.items).map(({ item, ancestors }) => {
  const request = item.draft?.request || item.request || {};
  return {
    assetType: 'request',
    id: `${collection.uid}:${item.uid}`,
    collectionUid: collection.uid,
    collectionName: collection.name,
    collectionPath: '.',
    itemUid: item.uid,
    itemPathname: relativePath(collection.pathname, item.pathname),
    name: item.name,
    breadcrumb: ancestors.join(' / '),
    type: item.type,
    method: request.method || request.methodType || null,
    url: request.url || request.endpoint || '',
    requestShape: describeRequest(item)
  };
});

export const buildRequestAssetTree = (assets = []) => {
  const root = [];
  const folders = new Map();

  assets.forEach((asset) => {
    let children = root;
    let parentPath = '';
    String(asset.breadcrumb || '').split('/').map((part) => part.trim()).filter(Boolean).forEach((name) => {
      const path = parentPath ? `${parentPath}/${name}` : name;
      let folder = folders.get(path);
      if (!folder) {
        folder = {
          id: `folder:${asset.collectionUid}:${path}`,
          type: 'folder',
          name,
          path,
          children: []
        };
        folders.set(path, folder);
        children.push(folder);
      }
      children = folder.children;
      parentPath = path;
    });
    children.push({ id: asset.id, type: 'request', asset });
  });

  const sortNodes = (nodes) => nodes
    .map((node) => node.type === 'folder' ? { ...node, children: sortNodes(node.children) } : node)
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === 'folder' ? -1 : 1;
      const leftName = left.type === 'folder' ? left.name : left.asset.name;
      const rightName = right.type === 'folder' ? right.name : right.asset.name;
      return String(leftName).localeCompare(String(rightName));
    });

  return sortNodes(root);
};

export const controlAssets = [
  { kind: 'condition', name: 'Condition' },
  { kind: 'fork', name: 'Fork branches' },
  { kind: 'join', name: 'Join branches' },
  { kind: 'delay', name: 'Delay' },
  { kind: 'subflow', name: 'Subflow' },
  { kind: 'checkpoint', name: 'Checkpoint' },
  { kind: 'fail', name: 'Failure' }
].map((asset) => ({ assetType: 'control', id: asset.kind, ...asset }));

export const inputAssets = ['dynamic-data', 'response-extractor', 'merge'].map((kind) => ({
  assetType: 'input',
  id: kind,
  kind,
  name: {
    'dynamic-data': 'Dynamic data cases',
    'response-extractor': 'Response value',
    'merge': 'Merge values'
  }[kind]
}));

export const filterAssets = (assets, searchQuery) => {
  const query = searchQuery.trim().toLowerCase();
  if (!query) return assets;
  return assets.filter((asset) => [
    asset.name,
    asset.collectionName,
    asset.breadcrumb,
    asset.method,
    asset.url
  ].filter(Boolean).join(' ').toLowerCase().includes(query));
};

export const buildFlowRequestCatalog = (collection) => {
  const activeEnvironment = (collection?.environments || []).find((environment) => environment.uid === collection.activeEnvironmentUid) || null;
  return flattenRequestItems(collection?.items).map(({ item }) => ({
    collectionPath: '.',
    itemPathname: relativePath(collection.pathname, item.pathname),
    collection,
    item,
    environmentContext: activeEnvironment,
    runtimeVariables: collection.runtimeVariables || {}
  }));
};

const addEnvironmentEntry = (target, name, value, secret = false) => {
  if (!name) return;
  target[name] = { value, secret: Boolean(secret) };
};

// Legacy-only input support. New flows do not create environment nodes; normal Bruno
// environment and runtime variables are resolved by the request lifecycle itself.
export const buildEnvironmentRuntimeValues = (collection) => {
  const values = {};
  if (!collection) return values;
  const globalSecrets = new Set(collection.globalEnvSecrets || []);
  Object.entries(collection.globalEnvironmentVariables || {}).forEach(([name, value]) => {
    addEnvironmentEntry(values, name, value, globalSecrets.has(name));
  });
  const activeEnvironment = (collection.environments || []).find((environment) => environment.uid === collection.activeEnvironmentUid);
  (activeEnvironment?.variables || []).filter((variable) => variable.enabled !== false).forEach((variable) => {
    addEnvironmentEntry(values, variable.name, variable.value, variable.secret);
  });
  Object.entries(collection.runtimeVariables || {}).forEach(([name, value]) => {
    const secret = globalSecrets.has(name)
      || Boolean(activeEnvironment?.variables?.find((variable) => variable.name === name)?.secret)
      || /(^|[-_.])(authorization|password|secret|token|api[-_.]?key)([-_.]|$)/i.test(name);
    addEnvironmentEntry(values, name, value, secret);
  });
  return values;
};
