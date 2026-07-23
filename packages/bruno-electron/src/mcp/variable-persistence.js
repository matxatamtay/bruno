const { randomUUID } = require('node:crypto');
const { globalEnvironmentsManager } = require('../store/workspace-environments');

// Mirrors how the desktop app applies a script's `bru.setEnvVar` / `setCollectionVar` /
// `setGlobalEnvVar` output onto a variables array: update the first enabled entry with that
// name, append a new enabled entry for an unrecognized name, and drop enabled entries the
// script no longer reports (this is how `bru.deleteEnvVar` reaches disk). Disabled entries are
// always preserved untouched.
const applyScriptVars = (variables, scriptVars) => {
  const scriptVarNames = new Set(Object.keys(scriptVars));
  const next = (variables || []).map((variable) => ({ ...variable }));

  for (const [name, value] of Object.entries(scriptVars)) {
    const existing = next.find((variable) => variable.name === name && variable.enabled);
    if (existing) {
      existing.value = value;
    } else {
      next.push({ uid: randomUUID(), name, value, type: 'text', secret: false, enabled: true });
    }
  }

  return next.filter((variable) => !variable.enabled || scriptVarNames.has(variable.name));
};

// bru stashes the active environment's name inside its variables map under `__name__`; that key
// is metadata, never a real variable, so it must not reach `applyScriptVars`.
const stripEnvName = (values) => {
  const { __name__: _envName, ...rest } = values || {};
  return rest;
};

// A scope can be emitted more than once during a single run (pre-request script, post-response
// vars, post-response script, tests); each emission carries the full current map, so only the
// last one per scope reflects the run's final state.
const latestValuesByScope = (variableChanges) => {
  const latest = new Map();
  for (const change of variableChanges || []) {
    latest.set(change.scope, change.values || {});
  }
  return latest;
};

const persistScriptVariableChanges = async ({ collections, workspace, collection, environment, variableChanges }) => {
  const latest = latestValuesByScope(variableChanges);

  const envUpdate = latest.get('environment');
  if (envUpdate && environment) {
    await collections.updateEnvironment({
      workspace_path: workspace.path,
      collection_path: collection.pathname,
      environment_name: environment.name,
      set: { variables: applyScriptVars(environment.variables, stripEnvName(envUpdate)) },
      _skipWorkspaceActivation: true
    });
  }

  const collectionVarsUpdate = latest.get('collection');
  if (collectionVarsUpdate) {
    const existingVars = collection.root?.request?.vars?.req || [];
    await collections.updateCollection({
      workspace_path: workspace.path,
      collection_path: collection.pathname,
      set: { 'root.request.vars.req': applyScriptVars(existingVars, collectionVarsUpdate) },
      _skipWorkspaceActivation: true
    });
  }

  const globalEnvUpdate = latest.get('global-environment');
  if (globalEnvUpdate && collection.globalEnvironment) {
    await globalEnvironmentsManager.saveGlobalEnvironment(workspace.path, {
      environmentUid: collection.globalEnvironment.uid,
      variables: applyScriptVars(collection.globalEnvironment.variables, globalEnvUpdate),
      color: collection.globalEnvironment.color
    });
  }
};

module.exports = {
  applyScriptVars,
  persistScriptVariableChanges
};
