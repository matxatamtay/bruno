import { DATA_NODE_KINDS } from './model';

const REQUEST_TYPES = new Set(['http-request', 'graphql-request', 'grpc-request', 'ws-request', 'sse-request']);

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

export const getWorkspaceCollections = (workspace, collections = []) => {
  const refs = new Set((workspace?.collections || []).flatMap((entry) => [entry.uid, normalizePath(entry.path)]).filter(Boolean));
  return collections.filter((collection) => (
    collection.uid !== workspace?.scratchCollectionUid
    && (refs.size === 0 || refs.has(collection.uid) || refs.has(normalizePath(collection.pathname)))
  ));
};

export const collectRequestAssets = (workspace, collections = []) => getWorkspaceCollections(workspace, collections).flatMap((collection) => (
  flattenRequestItems(collection.items).map(({ item, ancestors }) => ({
    assetType: 'request',
    id: `${collection.uid}:${item.uid}`,
    collectionUid: collection.uid,
    collectionName: collection.name,
    collectionPath: relativePath(workspace?.pathname, collection.pathname),
    itemUid: item.uid,
    itemPathname: relativePath(collection.pathname, item.pathname),
    name: item.name,
    breadcrumb: ancestors.join(' / '),
    type: item.type,
    method: item.request?.method || item.request?.methodType || null,
    url: item.request?.url || item.request?.endpoint || ''
  }))
));

export const controlAssets = [
  { kind: 'condition', name: 'Condition' },
  { kind: 'fork', name: 'Fork branches' },
  { kind: 'join', name: 'Join branches' },
  { kind: 'delay', name: 'Delay' },
  { kind: 'subflow', name: 'Subflow' },
  { kind: 'checkpoint', name: 'Checkpoint' },
  { kind: 'fail', name: 'Failure' }
].map((asset) => ({ assetType: 'control', id: asset.kind, ...asset }));

export const inputAssets = [...DATA_NODE_KINDS].map((kind) => ({
  assetType: 'input',
  id: kind,
  kind,
  name: {
    'static-input': 'Static value',
    'form-input': 'Form input',
    'environment-input': 'Environment variable',
    'dataset-input': 'Dataset row',
    'response-extractor': 'Response extractor',
    'merge': 'Merge data',
    'secret-reference': 'Secret reference'
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

export const buildFlowRequestCatalog = (workspace, collections = []) => getWorkspaceCollections(workspace, collections).flatMap((collection) => {
  const activeEnvironment = (collection.environments || []).find((environment) => environment.uid === collection.activeEnvironmentUid) || null;
  return flattenRequestItems(collection.items).map(({ item }) => ({
    collectionPath: relativePath(workspace?.pathname, collection.pathname),
    itemPathname: relativePath(collection.pathname, item.pathname),
    collection,
    item,
    environmentContext: activeEnvironment,
    runtimeVariables: collection.runtimeVariables || {}
  }));
});

const addEnvironmentEntry = (target, name, value, secret = false) => {
  if (!name) return;
  target[name] = { value, secret: Boolean(secret) };
};

export const buildEnvironmentRuntimeValues = (workspace, collections = []) => {
  const values = {};
  getWorkspaceCollections(workspace, collections).forEach((collection) => {
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
  });
  return values;
};

export const groupRequestAssets = (assets) => assets.reduce((groups, asset) => {
  const key = asset.collectionUid;
  if (!groups[key]) groups[key] = { collectionUid: key, collectionName: asset.collectionName, assets: [] };
  groups[key].assets.push(asset);
  return groups;
}, {});
