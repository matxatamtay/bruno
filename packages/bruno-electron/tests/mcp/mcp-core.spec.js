const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  assertScope,
  hasScope,
  normalizePermissionProfile
} = require('../../src/mcp/permissions');
const { redactMcpValue, summarizeMcpArgs } = require('../../src/mcp/redaction');
const { McpRateLimiter } = require('../../src/mcp/rate-limit');
const { normalizeMcpConfig } = require('../../src/mcp/config');
const { McpTokenStore } = require('../../src/mcp/token-store');
const { McpAuditService } = require('../../src/mcp/audit-service');
const {
  FlowPatchPreviewStore,
  applyFlowPatchOperations
} = require('../../src/mcp/flow-patch');
const { assertUrlAllowed } = require('../../src/mcp/automation-facade');

const flow = () => ({
  schemaVersion: 1,
  uid: 'flow_patch',
  name: 'Patch me',
  revision: 'sha256:old',
  workspace: { uid: 'workspace_test' },
  defaults: {},
  nodes: [
    { id: 'start', semanticKey: 'start', kind: 'start', position: { x: 0, y: 0 }, config: {} },
    { id: 'end', semanticKey: 'end', kind: 'end', position: { x: 100, y: 0 }, config: {} }
  ],
  controlEdges: [{ id: 'start_end', sourceNodeId: 'start', targetNodeId: 'end' }],
  dataEdges: [],
  frames: [],
  metadata: { createdAt: '2026-07-21T00:00:00.000Z', updatedAt: '2026-07-21T00:00:00.000Z' }
});

describe('Bruno MCP core security primitives', () => {
  it('keeps Read Only distinct from execution and mutation scopes', () => {
    expect(normalizePermissionProfile('readonly')).toBe('read-only');
    expect(hasScope('read-only', 'bruno:flow:read')).toBe(true);
    expect(hasScope('read-only', 'bruno:execute:flow')).toBe(false);
    expect(() => assertScope('read-only', 'bruno:flow:write', 'bruno_apply_flow_patch')).toThrow(/cannot call/);
    expect(hasScope('full-control', 'bruno:admin')).toBe(true);
  });

  it('tightens existing audit directory permissions and never writes raw argument values', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-mcp-audit-'));
    fs.chmodSync(directory, 0o777);
    const audit = new McpAuditService({ directory });
    try {
      await audit.append({
        event: 'mcp.tool.completed',
        args: summarizeMcpArgs({ flow_uid: 'flow_demo', inputs: { custom: 'raw-audit-secret' } })
      });
      const content = fs.readFileSync(audit.pathname, 'utf8');
      expect(content).not.toContain('raw-audit-secret');
      expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
      expect(fs.statSync(audit.pathname).mode & 0o777).toBe(0o600);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('redacts sensitive object keys, named header entries, known values, and error strings', () => {
    const projected = redactMcpValue({
      headers: [
        { name: 'Authorization', value: 'Bearer top-secret' },
        { name: 'Accept', value: 'application/json' }
      ],
      response: { body: { access_token: 'nested-secret', visible: 'ok' } },
      error: 'request failed with top-secret'
    }, { secrets: ['top-secret'] });

    expect(projected.headers[0].value).toBe('[REDACTED]');
    expect(projected.headers[1].value).toBe('application/json');
    expect(projected.response.body.access_token).toBe('[REDACTED]');
    expect(projected.error).not.toContain('top-secret');
  });

  it('stores only argument shape and safe identifiers in audit summaries', () => {
    const summary = summarizeMcpArgs({
      workspace_uid: 'workspace_demo',
      flow_uid: 'flow_demo',
      inputs: { custom: 'raw-arbitrary-secret', password: 'raw-password' },
      operations: [{ op: 'replace', path: '/name', value: 'Confidential flow name' }]
    });

    expect(summary.workspace_uid).toBe('workspace_demo');
    expect(summary.flow_uid).toBe('flow_demo');
    expect(JSON.stringify(summary)).not.toContain('raw-arbitrary-secret');
    expect(JSON.stringify(summary)).not.toContain('raw-password');
    expect(JSON.stringify(summary)).not.toContain('Confidential flow name');
    expect(summary.inputs.custom).toBe('[STRING:20]');
    expect(summary.inputs.password).toBe('[REDACTED]');
  });

  it('rate limits per client without sharing counters', () => {
    let now = 1000;
    const limiter = new McpRateLimiter({ limit: 2, windowMs: 1000, now: () => now });
    expect(limiter.consume('client-a').remaining).toBe(1);
    expect(limiter.consume('client-a').remaining).toBe(0);
    expect(() => limiter.consume('client-a')).toThrow(/rate limit exceeded/);
    expect(limiter.consume('client-b').remaining).toBe(1);
    now = 2001;
    expect(limiter.consume('client-a').remaining).toBe(1);
  });

  it('enforces loopback binding unless remote access is explicitly enabled', () => {
    expect(normalizeMcpConfig({ mcp: { enabled: true } })).toMatchObject({ host: '127.0.0.1', allowRemote: false, permissionProfile: 'read-only' });
    expect(() => normalizeMcpConfig({ mcp: { host: '0.0.0.0', allowRemote: false } })).toThrow(/loopback/);
    expect(normalizeMcpConfig({ mcp: { host: '0.0.0.0', allowRemote: true } }).host).toBe('0.0.0.0');
  });

  it('treats templated request hosts as dynamic before URL parsing', () => {
    const config = { allowedHosts: ['api.test'], allowPrivateHosts: false, allowDynamicHosts: false };
    expect(() => assertUrlAllowed('{{baseUrl}}/users', config)).toThrow(/Dynamic request hosts are disabled/);
    expect(() => assertUrlAllowed('${BASE_URL}/users', config)).toThrow(/Dynamic request hosts are disabled/);
    expect(() => assertUrlAllowed('https://api.test/users', config)).not.toThrow();
    expect(() => assertUrlAllowed('{{baseUrl}}/users', { ...config, allowDynamicHosts: true })).not.toThrow();
  });

  it('stores a 256-bit token encrypted with private file permissions and rotates it', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bruno-mcp-token-'));
    const encode = (value) => `enc:${Buffer.from(value).toString('base64')}`;
    const decodeSafe = (value) => ({ success: value.startsWith('enc:'), value: Buffer.from(value.slice(4), 'base64').toString() });
    const store = new McpTokenStore({ directory, encrypt: encode, decryptSafe: decodeSafe });
    try {
      const first = await store.ensure();
      expect(Buffer.from(first.token, 'base64url')).toHaveLength(32);
      expect(fs.readFileSync(store.pathname, 'utf8')).not.toContain(first.token);
      expect(fs.statSync(store.pathname).mode & 0o777).toBe(0o600);
      const second = await store.rotate();
      expect(second.token).not.toBe(first.token);
      expect((await store.metadata()).fingerprint).toHaveLength(16);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });

  it('applies bounded JSON pointer patches but protects identity and revision fields', () => {
    const patched = applyFlowPatchOperations(flow(), [{ op: 'replace', path: '/name', value: 'Patched' }]);
    expect(patched.name).toBe('Patched');
    expect(flow().name).toBe('Patch me');
    expect(() => applyFlowPatchOperations(flow(), [{ op: 'replace', path: '/revision', value: 'forged' }])).toThrow(/protected path/);
    expect(() => applyFlowPatchOperations(flow(), [{ op: 'remove', path: '/missing' }])).toThrow(/does not exist/);
  });

  it('binds apply to the exact previewed operations and consumes approvals once', () => {
    const previews = new FlowPatchPreviewStore({ idFactory: () => 'preview_1', now: () => 1000 });
    const operations = [{ op: 'replace', path: '/name', value: 'Patched' }];
    previews.create({
      workspaceUid: 'workspace_test',
      flowUid: 'flow_patch',
      relativePath: 'patch.flow.yml',
      expectedRevision: 'sha256:old',
      operations,
      proposedRevision: 'sha256:new'
    });
    expect(() => previews.consume({
      previewId: 'preview_1',
      workspaceUid: 'workspace_test',
      flowUid: 'flow_patch',
      relativePath: 'patch.flow.yml',
      expectedRevision: 'sha256:old',
      operations: [{ ...operations[0], value: 'Different' }]
    })).toThrow(/does not match/);
    expect(previews.consume({
      previewId: 'preview_1',
      workspaceUid: 'workspace_test',
      flowUid: 'flow_patch',
      relativePath: 'patch.flow.yml',
      expectedRevision: 'sha256:old',
      operations
    })).toMatchObject({ previewId: 'preview_1' });
    expect(() => previews.consume({
      previewId: 'preview_1',
      workspaceUid: 'workspace_test',
      flowUid: 'flow_patch',
      relativePath: 'patch.flow.yml',
      expectedRevision: 'sha256:old',
      operations
    })).toThrow(/missing or expired/);
  });
});
