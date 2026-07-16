import { flattenItems } from 'utils/collections';

export const REQUEST_TYPES = new Set(['http-request', 'graphql-request', 'grpc-request', 'ws-request']);

export const collectionIdentity = (collection) => ({
  uid: collection.uid,
  name: collection.name,
  pathname: collection.pathname,
  gitRemote: collection.gitRemote || null,
  relativeGitPath: collection.relativeGitPath || null
});

export const requestDescriptors = (collection) => flattenItems(collection?.items || [])
  .filter((item) => REQUEST_TYPES.has(item.type))
  .map((item) => {
    const source = item.draft || item;
    return {
      uid: item.uid,
      itemUid: item.uid,
      pathname: item.pathname,
      name: item.name,
      type: item.type,
      request: source.request || {},
      method: source.request?.method || (item.type === 'graphql-request' ? 'POST' : 'GET'),
      url: source.request?.url || '',
      examples: source.examples || item.examples || []
    };
  });

export const pretty = (value) => JSON.stringify(value ?? null, null, 2);
