const { analyzeRequestChange, analyzeSemanticChanges } = require('../../src/services/git-semantic-review');

const request = ({ method = 'GET', url = 'https://example.com/users/{{id}}', auth = 'none', params = [], headers = [], bodyMode = 'json', body = '{}', assertions = [] } = {}) => ({ name: 'User request', request: { method, url, params, headers, auth: { mode: auth }, body: { mode: bodyMode, json: body }, assertions } });
const findRule = (findings, ruleId) => findings.find((finding) => finding.ruleId === ruleId);

describe('Semantic Git Review request rules', () => {
  test('classifies direct request contract changes', () => {
    const findings = analyzeRequestChange({ filePath: 'users/update-user.bru', oldParsed: request(), newParsed: request({ method: 'POST', url: 'https://api.example.com/accounts/{{id}}', auth: 'bearer', bodyMode: 'multipart' }) });
    expect(findRule(findings, 'request.method-changed').severity).toBe('breaking');
    expect(findRule(findings, 'request.url-changed').severity).toBe('breaking');
    expect(findRule(findings, 'auth.mode-changed').severity).toBe('breaking');
    expect(findRule(findings, 'body.mode-changed').severity).toBe('breaking');
    expect(findRule(analyzeRequestChange({ filePath: 'old.bru', oldParsed: request(), newParsed: null, status: 'deleted' }), 'request.deleted').severity).toBe('breaking');
  });

  test('detects parameter and header changes', () => {
    const findings = analyzeRequestChange({ filePath: 'get-user.bru', oldParsed: request({ params: [{ name: 'id', type: 'path', enabled: true }], headers: [{ name: 'X-Legacy', enabled: true }] }), newParsed: request({ params: [{ name: 'tenantId', type: 'path', enabled: true }, { name: 'expand', type: 'query', enabled: true }], headers: [{ name: 'X-Trace', enabled: true }] }) });
    expect(findRule(findings, 'path-param.enabled-entry-removed').severity).toBe('breaking');
    expect(findRule(findings, 'path-param.enabled-entry-added').severity).toBe('breaking');
    expect(findRule(findings, 'query-param.enabled-entry-added').severity).toBe('warning');
    expect(findRule(findings, 'header.enabled-entry-removed').severity).toBe('breaking');
  });

  test('reports body additions cautiously and removals/type changes as breaking', () => {
    const findings = analyzeRequestChange({ filePath: 'create-user.bru', oldParsed: request({ body: JSON.stringify({ name: 'Ada', age: 42, profile: { active: true } }) }), newParsed: request({ body: JSON.stringify({ name: 123, email: '{{email}}', profile: {} }) }) });
    expect(findRule(findings, 'body.field-type-changed').severity).toBe('breaking');
    expect(findRule(findings, 'body.field-removed').severity).toBe('breaking');
    expect(findRule(findings, 'body.field-added')).toMatchObject({ severity: 'warning', confidence: 'medium' });
  });

  test('summarizes findings independently from UI', () => {
    const result = analyzeSemanticChanges({ commitHash: 'abc123', snapshots: [{ filePath: 'update-user.bru', oldParsed: request(), newParsed: request({ method: 'POST' }) }], affectedRequests: [{ path: 'register.bru', reasons: [] }] });
    expect(result.summary).toMatchObject({ breaking: 1, affectedRequests: 1 });
  });
});
