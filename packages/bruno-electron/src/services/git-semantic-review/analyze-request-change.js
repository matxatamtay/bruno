const get = require('lodash/get');
const isEqual = require('lodash/isEqual');
const { SEVERITY, CONFIDENCE, createFinding } = require('./model');
const { entriesByName, parseJsonBody, flattenObject, valueType, requestName } = require('./utils');

const make = (context, data) => createFinding({ ...data, filePath: context.filePath });

const analyzeEntries = ({ oldEntries, newEntries, kind, section, context }) => {
  const findings = [];
  const oldMap = entriesByName(oldEntries);
  const newMap = entriesByName(newEntries);
  oldMap.forEach((entry, key) => {
    if (!newMap.has(key)) findings.push(make(context, {
      ruleId: `${kind}.enabled-entry-removed`, severity: kind === 'path-param' || kind === 'header' ? SEVERITY.BREAKING : SEVERITY.WARNING,
      category: 'request-contract', title: `${kind === 'header' ? 'Header' : 'Parameter'} removed`,
      description: `Enabled ${kind === 'header' ? 'header' : 'parameter'} "${entry.name}" was removed.`, section,
      evidence: { key: entry.name, before: entry, after: null }, suggestedTests: [`Run the request without "${entry.name}".`]
    }));
  });
  newMap.forEach((entry, key) => {
    if (!oldMap.has(key)) findings.push(make(context, {
      ruleId: `${kind}.enabled-entry-added`, severity: kind === 'path-param' ? SEVERITY.BREAKING : SEVERITY.WARNING,
      confidence: kind === 'path-param' ? CONFIDENCE.HIGH : CONFIDENCE.MEDIUM, category: 'request-contract',
      title: `${kind === 'header' ? 'Header' : 'Parameter'} added`,
      description: `Enabled ${kind === 'header' ? 'header' : 'parameter'} "${entry.name}" is now sent by this request.`, section,
      evidence: { key: entry.name, before: null, after: entry }, suggestedTests: [`Run the request with and without "${entry.name}".`]
    }));
  });
  return findings;
};

const analyzeJsonBody = (oldParsed, newParsed, context) => {
  const oldBody = parseJsonBody(oldParsed);
  const newBody = parseJsonBody(newParsed);
  if (!oldBody || !newBody) return [];
  const oldFields = flattenObject(oldBody);
  const newFields = flattenObject(newBody);
  const findings = [];
  oldFields.forEach((oldValue, fieldPath) => {
    if (!newFields.has(fieldPath)) {
      findings.push(make(context, { ruleId: 'body.field-removed', severity: SEVERITY.BREAKING, confidence: CONFIDENCE.MEDIUM, category: 'request-contract', title: 'Body field removed', description: `JSON body field "${fieldPath}" was removed.`, section: 'body', evidence: { fieldPath, before: oldValue } }));
      return;
    }
    const newValue = newFields.get(fieldPath);
    if (valueType(oldValue) !== valueType(newValue)) findings.push(make(context, { ruleId: 'body.field-type-changed', severity: SEVERITY.BREAKING, category: 'request-contract', title: 'Body field type changed', description: `JSON body field "${fieldPath}" changed from ${valueType(oldValue)} to ${valueType(newValue)}.`, section: 'body', evidence: { fieldPath, before: oldValue, after: newValue } }));
  });
  newFields.forEach((newValue, fieldPath) => {
    if (!oldFields.has(fieldPath)) findings.push(make(context, { ruleId: 'body.field-added', severity: SEVERITY.WARNING, confidence: CONFIDENCE.MEDIUM, category: 'request-contract', title: 'Body field added', description: `JSON body field "${fieldPath}" is now sent. Bruno cannot determine whether the server requires it without a schema.`, section: 'body', evidence: { fieldPath, after: newValue }, suggestedTests: [`Send the request without "${fieldPath}".`, `Send "${fieldPath}" with an empty value.`] }));
  });
  return findings;
};

const analyzeRequestChange = ({ oldParsed, newParsed, filePath, status = 'modified' }) => {
  const context = { filePath };
  if (status === 'deleted' || (oldParsed && !newParsed)) return [make(context, { ruleId: 'request.deleted', severity: SEVERITY.BREAKING, category: 'request-contract', title: 'Request deleted', description: `Request "${requestName(oldParsed, filePath)}" was deleted.`, section: 'request', evidence: { before: requestName(oldParsed, filePath), after: null } })];
  if (!oldParsed && newParsed) return [make(context, { ruleId: 'request.added', severity: SEVERITY.INFO, category: 'request-contract', title: 'Request added', description: `Request "${requestName(newParsed, filePath)}" was added.`, section: 'request', evidence: { after: requestName(newParsed, filePath) } })];
  if (!oldParsed || !newParsed) return [];

  const findings = [];
  const addChange = (ruleId, title, description, section, before, after, extra = {}) => findings.push(make(context, { ruleId, severity: SEVERITY.BREAKING, category: 'request-contract', title, description, section, evidence: { before, after }, ...extra }));
  const oldMethod = String(get(oldParsed, 'request.method', '')).toUpperCase();
  const newMethod = String(get(newParsed, 'request.method', '')).toUpperCase();
  if (oldMethod !== newMethod) addChange('request.method-changed', 'HTTP method changed', `Request method changed from ${oldMethod || '(none)'} to ${newMethod || '(none)'}.`, 'request', oldMethod, newMethod);
  const oldUrl = String(get(oldParsed, 'request.url', '')).trim();
  const newUrl = String(get(newParsed, 'request.url', '')).trim();
  if (oldUrl !== newUrl) addChange('request.url-changed', 'Request URL changed', `Request URL changed from "${oldUrl}" to "${newUrl}".`, 'request', oldUrl, newUrl);
  const oldBodyMode = get(oldParsed, 'request.body.mode') || get(oldParsed, 'request.body.type') || '';
  const newBodyMode = get(newParsed, 'request.body.mode') || get(newParsed, 'request.body.type') || '';
  if (oldBodyMode !== newBodyMode) addChange('body.mode-changed', 'Body mode changed', `Request body mode changed from "${oldBodyMode || 'none'}" to "${newBodyMode || 'none'}".`, 'body', oldBodyMode, newBodyMode);
  const oldAuth = get(oldParsed, 'request.auth.mode', 'none');
  const newAuth = get(newParsed, 'request.auth.mode', 'none');
  if (oldAuth !== newAuth) addChange('auth.mode-changed', 'Authentication changed', `Authentication mode changed from "${oldAuth}" to "${newAuth}".`, 'auth', oldAuth, newAuth);

  const oldParams = get(oldParsed, 'request.params', []);
  const newParams = get(newParsed, 'request.params', []);
  findings.push(...analyzeEntries({ oldEntries: oldParams.filter((entry) => entry.type === 'path'), newEntries: newParams.filter((entry) => entry.type === 'path'), kind: 'path-param', section: 'params', context }));
  findings.push(...analyzeEntries({ oldEntries: oldParams.filter((entry) => entry.type !== 'path'), newEntries: newParams.filter((entry) => entry.type !== 'path'), kind: 'query-param', section: 'params', context }));
  findings.push(...analyzeEntries({ oldEntries: get(oldParsed, 'request.headers', []), newEntries: get(newParsed, 'request.headers', []), kind: 'header', section: 'headers', context }));
  findings.push(...analyzeJsonBody(oldParsed, newParsed, context));

  const oldAssertions = get(oldParsed, 'request.assertions', []);
  const newAssertions = get(newParsed, 'request.assertions', []);
  if (oldAssertions.length && !newAssertions.length) findings.push(make(context, { ruleId: 'assertions.removed', severity: SEVERITY.WARNING, category: 'test-coverage', title: 'Assertions removed', description: 'All structured assertions were removed from this request.', section: 'assertions', evidence: { before: oldAssertions.length, after: 0 } }));
  else if (!isEqual(oldAssertions, newAssertions)) findings.push(make(context, { ruleId: 'assertions.changed', severity: SEVERITY.INFO, category: 'test-coverage', title: 'Assertions changed', description: 'Structured assertions changed and should be reviewed against the new contract.', section: 'assertions', evidence: { before: oldAssertions, after: newAssertions } }));
  return findings;
};

module.exports = analyzeRequestChange;
