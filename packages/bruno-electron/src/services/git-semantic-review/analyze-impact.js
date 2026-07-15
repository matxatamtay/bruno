const get = require('lodash/get');
const path = require('path');
const { SEVERITY, CONFIDENCE, createFinding } = require('./model');

const VARIABLE_PATTERNS = [
  /{{\s*([A-Za-z_][\w.-]*)\s*}}/g,
  /bru\.get(?:Env|Collection|GlobalEnv|Request|Folder|Runtime)?Var\(\s*['"]([^'"]+)['"]\s*\)/g
];
const PRODUCER_PATTERN = /bru\.set(?:Env|Collection|GlobalEnv|Request|Folder|Runtime)?Var\(\s*['"]([^'"]+)['"]/g;

const collectStrings = (value, result = []) => {
  if (typeof value === 'string') result.push(value);
  else if (Array.isArray(value)) value.forEach((item) => collectStrings(item, result));
  else if (value && typeof value === 'object') Object.values(value).forEach((item) => collectStrings(item, result));
  return result;
};

const extractVariables = (value, patterns = VARIABLE_PATTERNS) => {
  const variables = new Set();
  collectStrings(value).forEach((text) => patterns.forEach((pattern) => {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text))) variables.add(match[1]);
  }));
  return variables;
};

const extractProducedVariables = (value) => extractVariables(value, [PRODUCER_PATTERN]);
const enabledVariableNames = (variables = []) => new Set((variables || []).filter((variable) => variable?.enabled !== false && variable?.name).map((variable) => variable.name));

const getRequestIdentity = (snapshot) => ({
  path: snapshot.filePath,
  name: get(snapshot.newParsed || snapshot.oldParsed, 'name') || snapshot.filePath,
  method: String(get(snapshot.newParsed, 'request.method', '')).toUpperCase()
});

const getScopedDefinitions = (requestPath, scopes = []) => {
  const definitions = new Set();
  scopes.forEach((scope) => {
    if (scope.type === 'collection') {
      scope.variables.forEach((name) => definitions.add(name));
      scope.produces.forEach((name) => definitions.add(name));
      return;
    }
    const folder = String(scope.path || '').replace(/\\/g, '/').replace(/\/$/, '');
    const requestFolder = path.posix.dirname(String(requestPath || '').replace(/\\/g, '/'));
    if (requestFolder === folder || requestFolder.startsWith(`${folder}/`)) {
      scope.variables.forEach((name) => definitions.add(name));
      scope.produces.forEach((name) => definitions.add(name));
    }
  });
  return definitions;
};

const buildImpactAnalysis = ({ snapshots = [], environments = [], scopes = [], globalVariables = [], runtimeVariables = [] }) => {
  const requestIndexes = snapshots.filter((snapshot) => snapshot.newParsed).map((snapshot) => {
    const identity = getRequestIdentity(snapshot);
    return {
      ...identity,
      consumes: extractVariables(snapshot.newParsed),
      produces: extractProducedVariables(get(snapshot.newParsed, 'request.script', {}))
    };
  });

  const changedVariables = new Set();
  snapshots.filter((snapshot) => snapshot.status !== 'unchanged').forEach((snapshot) => {
    const before = extractVariables(snapshot.oldParsed);
    const after = extractVariables(snapshot.newParsed);
    before.forEach((name) => { if (!after.has(name)) changedVariables.add(name); });
    after.forEach((name) => { if (!before.has(name)) changedVariables.add(name); });
    const beforeProduced = extractProducedVariables(get(snapshot.oldParsed, 'request.script', {}));
    const afterProduced = extractProducedVariables(get(snapshot.newParsed, 'request.script', {}));
    beforeProduced.forEach((name) => { if (!afterProduced.has(name)) changedVariables.add(name); });
    afterProduced.forEach((name) => { if (!beforeProduced.has(name)) changedVariables.add(name); });
  });

  const affectedRequests = requestIndexes
    .filter((request) => [...request.consumes].some((name) => changedVariables.has(name)))
    .map((request) => ({
      path: request.path,
      name: request.name,
      method: request.method,
      reasons: [...request.consumes].filter((name) => changedVariables.has(name)).map((variable) => ({ type: 'variable', variable }))
    }));

  const producerDefinitions = new Set();
  requestIndexes.forEach((request) => request.produces.forEach((name) => producerDefinitions.add(name)));
  const globalDefinitions = new Set([
    ...globalVariables.filter((variable) => variable?.enabled !== false && variable?.name).map((variable) => variable.name),
    ...runtimeVariables.filter((variable) => variable?.name).map((variable) => variable.name)
  ]);
  const environmentUnion = new Set();
  environments.forEach((environment) => enabledVariableNames(environment.variables).forEach((name) => environmentUnion.add(name)));

  const findings = [];
  requestIndexes.forEach((request) => {
    const requestDefinitions = getScopedDefinitions(request.path, scopes);
    request.consumes.forEach((variable) => {
      const defined = producerDefinitions.has(variable)
        || requestDefinitions.has(variable)
        || globalDefinitions.has(variable)
        || environmentUnion.has(variable);
      if (!defined) findings.push(createFinding({
        ruleId: 'variable.missing-definition',
        severity: SEVERITY.WARNING,
        confidence: CONFIDENCE.MEDIUM,
        category: 'variables',
        title: 'Variable may be undefined',
        description: `Variable "${variable}" is used by ${request.name}, but no request, folder, collection, environment, global, or runtime definition was found.`,
        filePath: request.path,
        section: 'vars',
        evidence: { name: variable },
        affectedRequestPaths: [request.path]
      }));
    });
  });

  const requiredVariables = [...new Set(requestIndexes.flatMap((request) => [...request.consumes]))].sort();
  const environmentMatrix = environments.map((environment) => {
    const names = enabledVariableNames(environment.variables);
    return {
      name: environment.name,
      path: environment.path,
      variables: Object.fromEntries(requiredVariables.map((variable) => [variable, names.has(variable)]))
    };
  });

  environments.forEach((environment) => {
    const names = enabledVariableNames(environment.variables);
    requiredVariables.forEach((variable) => {
      if (!names.has(variable) && environments.some((other) => enabledVariableNames(other.variables).has(variable))) {
        findings.push(createFinding({
          ruleId: 'environment.variable-missing',
          severity: SEVERITY.WARNING,
          confidence: CONFIDENCE.HIGH,
          category: 'environment',
          title: 'Environment is missing a variable',
          description: `Environment "${environment.name}" does not define "${variable}".`,
          filePath: environment.path,
          section: 'vars',
          evidence: { name: variable, environment: environment.name }
        }));
      }
    });
  });

  return {
    findings,
    affectedRequests,
    changedVariables: [...changedVariables],
    requiredVariables,
    environmentMatrix
  };
};

module.exports = { extractVariables, extractProducedVariables, enabledVariableNames, buildImpactAnalysis };
