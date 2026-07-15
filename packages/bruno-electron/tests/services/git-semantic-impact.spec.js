const { extractVariables, extractProducedVariables, buildImpactAnalysis } = require('../../src/services/git-semantic-review/analyze-impact');
const { detectSecrets, detectRawDiffSecrets } = require('../../src/services/git-semantic-review/detect-secrets');

describe('Semantic Git Review impact and security analysis', () => {
  test('extracts template and script variables', () => {
    expect([...extractVariables({ url: '{{baseUrl}}/users', script: 'bru.getEnvVar(\'token\')' })].sort()).toEqual(['baseUrl', 'token']);
    expect([...extractProducedVariables('bru.setVar(\'userId\', \'1\')')]).toEqual(['userId']);
  });

  test('marks requests affected by changed variables and missing definitions', () => {
    const result = buildImpactAnalysis({
      snapshots: [
        { filePath: 'login.bru', oldParsed: { request: { script: { res: 'bru.setVar(\'token\', res.body.token)' } } }, newParsed: { name: 'Login', request: { method: 'POST', script: { res: '' } } } },
        { filePath: 'profile.bru', status: 'unchanged', oldParsed: null, newParsed: { name: 'Profile', request: { method: 'GET', url: '{{baseUrl}}/profile', headers: [{ name: 'Authorization', value: 'Bearer {{token}}', enabled: true }] } } }
      ],
      environments: [{ name: 'local', path: 'environments/local.bru', variables: [{ name: 'baseUrl', value: 'http://localhost' }] }]
    });
    expect(result.affectedRequests).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'profile.bru' })]));
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ ruleId: 'variable.missing-definition', evidence: { name: 'token' } })]));
  });

  test('respects collection and folder variable scopes', () => {
    const result = buildImpactAnalysis({
      snapshots: [
        { filePath: 'admin/invite.bru', status: 'unchanged', newParsed: { name: 'Invite', request: { url: '{{baseUrl}}/invite/{{tenantId}}' } } },
        { filePath: 'public/ping.bru', status: 'unchanged', newParsed: { name: 'Ping', request: { url: '{{baseUrl}}/ping/{{tenantId}}' } } }
      ],
      scopes: [
        { type: 'collection', path: '', variables: new Set(['baseUrl']), produces: new Set() },
        { type: 'folder', path: 'admin', variables: new Set(['tenantId']), produces: new Set() }
      ]
    });
    expect(result.findings).not.toEqual(expect.arrayContaining([expect.objectContaining({ filePath: 'admin/invite.bru', evidence: { name: 'tenantId' } })]));
    expect(result.findings).toEqual(expect.arrayContaining([expect.objectContaining({ filePath: 'public/ping.bru', evidence: { name: 'tenantId' } })]));
  });

  test('masks possible secrets and never returns the raw value', () => {
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
    const findings = detectSecrets({ snapshots: [{ filePath: 'auth.bru', oldParsed: null, newParsed: { request: { headers: [{ name: 'Authorization', value: token }] } } }] });
    expect(findings[0]).toMatchObject({ ruleId: 'secret.possible-credential-committed', severity: 'secret' });
    expect(JSON.stringify(findings[0])).not.toContain(token);
  });

  test('detects secrets added to raw non-request files', () => {
    const token = 'ghp_abcdefghijklmnopqrstuvwxyz123456';
    const findings = detectRawDiffSecrets({ diffs: [{ filePath: '.env', diff: `diff --git .env .env\n+API_TOKEN=${token}` }] });
    expect(findings[0]).toMatchObject({ ruleId: 'secret.raw-diff-credential', filePath: '.env' });
    expect(JSON.stringify(findings[0])).not.toContain(token);
  });
});
