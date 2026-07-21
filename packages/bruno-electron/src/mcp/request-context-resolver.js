const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const dotenv = require('dotenv');
const { cloneDeep } = require('lodash');
const {
  parseCollection,
  parseEnvironment,
  parseFolder,
  parseRequest
} = require('@usebruno/filestore');
const { parseValueByDataType } = require('@usebruno/common/utils');
const { buildTree } = require('../services/mount/tree-builder');
const { defaultClassify, walk } = require('../utils/mount');
const { generateUidBasedOnHash } = require('../utils/common');
const { findItemInCollectionByPathname, getEnvVars } = require('../utils/collection');
const { transformBrunoConfigAfterRead } = require('../utils/transformBrunoConfig');
const { prepareRequest } = require('../ipc/network/prepare-request');
const interpolateVars = require('../ipc/network/interpolate-vars');
const {
  getProcessEnvVars,
  setCollectionWorkspace,
  setDotEnvVars,
  setWorkspaceDotEnvVars
} = require('../store/process-env');
const { setBrunoConfig } = require('../store/bruno-config');
const { assertSafePath } = require('./workspace-catalog');

const parseEntry = (content, classification) => {
  if (classification.type === 'config') return JSON.parse(content);
  const options = { format: classification.format };
  switch (classification.type) {
    case 'collection': return parseCollection(content, options);
    case 'environment': return parseEnvironment(content, options);
    case 'folder': return parseFolder(content, options);
    case 'request': return parseRequest(content, options);
    default: return null;
  }
};

const readDotEnv = (pathname) => {
  try {
    if (!fs.existsSync(pathname)) return {};
    return dotenv.parse(fs.readFileSync(pathname, 'utf8'));
  } catch (_) {
    return {};
  }
};

const hydrateEnvironmentSecrets = (collectionPath, environments) => {
  if (!Array.isArray(environments) || environments.length === 0) return;
  try {
    const EnvironmentSecretsStore = require('../store/env-secrets');
    const { decryptStringSafe } = require('../utils/encryption');
    const store = new EnvironmentSecretsStore();
    for (const environment of environments) {
      if (!Array.isArray(environment.variables)) continue;
      const secrets = store.getEnvSecrets(collectionPath, environment);
      for (const secret of secrets || []) {
        const variable = environment.variables.find((candidate) => candidate.name === secret.name);
        if (!variable || !secret.value) continue;
        const decrypted = decryptStringSafe(secret.value);
        variable.value = parseValueByDataType(decrypted.value, variable.dataType);
      }
    }
  } catch (_) {
    // Secret hydration is best-effort here. Execution still works for collections
    // without encrypted environment values or when the Electron store is unavailable.
  }
};

const loadActiveGlobalEnvironment = async (workspacePath) => {
  try {
    const { globalEnvironmentsManager } = require('../store/workspace-environments');
    const { globalEnvironmentsStore } = require('../store/global-environments');
    const { globalEnvironments = [] } = await globalEnvironmentsManager.getGlobalEnvironments(workspacePath);
    let activeUid = globalEnvironmentsStore.getActiveGlobalEnvironmentUidForWorkspace(workspacePath);
    if (activeUid === undefined) activeUid = globalEnvironmentsStore.getActiveGlobalEnvironmentUid();
    const environment = globalEnvironments.find((candidate) => candidate.uid === activeUid) || null;
    return {
      environment,
      variables: getEnvVars(environment)
    };
  } catch (_) {
    return { environment: null, variables: {} };
  }
};

const loadSecurityConfig = (collectionPath) => {
  try {
    const CollectionSecurityStore = require('../store/collection-security');
    return new CollectionSecurityStore().getSecurityConfigForCollection(collectionPath);
  } catch (_) {
    return {};
  }
};

const normalizeVariables = (value, label) => {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return cloneDeep(value);
};

const selectEnvironment = (environments, { environment_uid: environmentUid, environment_name: environmentName }) => {
  let selected = null;
  if (environmentUid) selected = environments.find((environment) => environment.uid === environmentUid) || null;
  if (!selected && environmentName) {
    const normalized = String(environmentName).trim().toLowerCase();
    selected = environments.find((environment) => String(environment.name || '').trim().toLowerCase() === normalized) || null;
  }
  if ((environmentUid || environmentName) && !selected) {
    const error = new Error(`Environment ${environmentUid || environmentName} was not found in the collection`);
    error.code = 'BRUNO_MCP_ENVIRONMENT_NOT_FOUND';
    throw error;
  }
  if (!selected && environments.length === 1) selected = environments[0];
  return selected;
};

const collectUnresolvedVariables = (value) => {
  const unresolved = new Set();
  const seen = new WeakSet();
  const visit = (candidate) => {
    if (typeof candidate === 'string') {
      for (const match of candidate.matchAll(/{{\s*([^{}]+?)\s*}}|\$\{\s*([^{}]+?)\s*}/g)) {
        const name = String(match[1] || match[2] || '').trim();
        if (name) unresolved.add(name);
      }
      return;
    }
    if (!candidate || typeof candidate !== 'object' || Buffer.isBuffer(candidate)) return;
    if (seen.has(candidate)) return;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    Object.values(candidate).forEach(visit);
  };
  visit(value);
  return [...unresolved].sort();
};

const environmentProjection = (environment) => environment ? {
  uid: environment.uid,
  name: environment.name,
  variable_names: (environment.variables || [])
    .filter((variable) => variable.enabled !== false && variable.name)
    .map((variable) => variable.name)
} : null;

class BrunoRequestContextResolver {
  async loadCollection({ workspacePath, collectionPath }) {
    const workspace = path.resolve(workspacePath);
    const collection = path.isAbsolute(collectionPath)
      ? path.resolve(collectionPath)
      : path.resolve(workspace, collectionPath);
    await assertSafePath(workspace, collection);

    const parserResults = new Map();
    const files = walk(collection, []);
    for (const file of files) {
      const classification = defaultClassify(file.relativePath);
      if (!classification) continue;
      const content = await fsPromises.readFile(file.absolutePath, 'utf8');
      try {
        parserResults.set(file.relativePath, {
          data: parseEntry(content, classification),
          raw: content
        });
      } catch (cause) {
        parserResults.set(file.relativePath, {
          data: {},
          raw: content,
          error: { message: cause.message || String(cause) }
        });
      }
    }

    const tree = buildTree(collection, parserResults, { uidFor: generateUidBasedOnHash });
    const collectionUid = generateUidBasedOnHash(collection);
    const brunoConfig = await transformBrunoConfigAfterRead(cloneDeep(tree.brunoConfig || {}), collection);
    const globalEnvironment = await loadActiveGlobalEnvironment(workspace);
    hydrateEnvironmentSecrets(collection, tree.environments);

    setCollectionWorkspace(collectionUid, workspace);
    setWorkspaceDotEnvVars(workspace, readDotEnv(path.join(workspace, '.env')));
    setDotEnvVars(collectionUid, readDotEnv(path.join(collection, '.env')));
    setBrunoConfig(collectionUid, brunoConfig);

    return {
      uid: collectionUid,
      name: brunoConfig.name || path.basename(collection),
      pathname: collection,
      items: tree.items,
      root: tree.root || {},
      brunoConfig,
      environments: tree.environments,
      activeEnvironmentUid: null,
      runtimeVariables: {},
      promptVariables: {},
      globalEnvironmentVariables: globalEnvironment.variables,
      globalEnvironment: globalEnvironment.environment,
      securityConfig: loadSecurityConfig(collection)
    };
  }

  async resolve({ workspace, collectionPath, itemPathname, input = {} }) {
    const collection = await this.loadCollection({ workspacePath: workspace.path, collectionPath });
    const requestPath = path.resolve(collection.pathname, itemPathname);
    await assertSafePath(collection.pathname, requestPath);
    const item = findItemInCollectionByPathname(collection, requestPath);
    if (!item) {
      const error = new Error(`Request ${itemPathname} was not found in collection ${collectionPath}`);
      error.code = 'BRUNO_MCP_REQUEST_NOT_FOUND';
      throw error;
    }
    if (item.error) {
      const error = new Error(`Unable to parse request ${itemPathname}: ${item.error.message}`);
      error.code = 'BRUNO_MCP_REQUEST_INVALID';
      throw error;
    }

    const runtimeVariables = normalizeVariables(input.runtime_variables, 'runtime_variables');
    const promptVariables = normalizeVariables(input.prompt_variables, 'prompt_variables');
    const environment = selectEnvironment(collection.environments || [], input);
    collection.activeEnvironmentUid = environment?.uid || null;
    collection.runtimeVariables = runtimeVariables;
    collection.promptVariables = promptVariables;

    const itemCopy = cloneDeep(item);
    const collectionCopy = cloneDeep(collection);
    const preparedRequest = await prepareRequest(itemCopy, collectionCopy);
    interpolateVars(
      preparedRequest,
      getEnvVars(environment || {}),
      runtimeVariables,
      getProcessEnvVars(collection.uid),
      promptVariables
    );

    const unresolvedVariables = collectUnresolvedVariables(preparedRequest);
    return {
      collection,
      item,
      environment,
      runtimeVariables,
      promptVariables,
      preparedRequest,
      unresolvedVariables,
      availableEnvironments: (collection.environments || []).map(environmentProjection),
      activeGlobalEnvironment: environmentProjection(collection.globalEnvironment)
    };
  }
}

module.exports = {
  BrunoRequestContextResolver,
  collectUnresolvedVariables,
  environmentProjection,
  normalizeVariables,
  selectEnvironment
};
