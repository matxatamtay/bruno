const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { normalizeMcpConfig } = require('../../src/mcp/config');
const { McpTokenStore } = require('../../src/mcp/token-store');
const {
  applyMutation,
  createRequestDefinition,
  mergeValue,
  tabPath
} = require('../../src/mcp/collection-service');
const { assertUrlAllowed } = require('../../src/mcp/automation-facade');

describe('Bruno MCP core', () => {
  it('normalizes a local pure MCP configuration without permission or host policy fields', () => {
    const config = normalizeMcpConfig({
      mcp: {
        enabled: true,
        host: '0.0.0.0',
        permissionProfile: 'read-only',
        allowedHosts: ['api.test'],
        allowedWorkspaces: [{ uid: 'workspace_api', path: '/tmp/api' }]
      }
    });
    expect(config).toMatchObject({ enabled: true, host: '127.0.0.1', discoveryWorkspaces: [{ uid: 'workspace_api', path: path.resolve('/tmp/api') }] });
    expect(config).not.toHaveProperty('permissionProfile');
    expect(config).not.toHaveProperty('allowedHosts');
    expect(config).not.toHaveProperty('allowPrivateHosts');
  });

  it('treats configured workspace paths as a discovery list, not the real managed workspaces', () => {
    const config = normalizeMcpConfig({ mcp: { workspaces: ['/tmp/one', { name: 'Two', path: '/tmp/two' }] } });
    expect(config.discoveryWorkspaces).toEqual([
      expect.objectContaining({ name: 'one', path: path.resolve('/tmp/one') }),
      expect.objectContaining({ name: 'Two', path: path.resolve('/tmp/two') })
    ]);
    expect(config).not.toHaveProperty('workspaces');
  });

  it('does not gate dynamic, private, or mutation request URLs', () => {
    expect(() => assertUrlAllowed('{{baseUrl}}/users', {})).not.toThrow();
    expect(() => assertUrlAllowed('http://127.0.0.1/admin', {})).not.toThrow();
    expect(() => assertUrlAllowed('https://metadata.google.internal', {})).not.toThrow();
  });

  it('deep-merges objects, replaces arrays, and supports universal set/unset editing', () => {
    const original = {
      name: 'Request',
      request: {
        headers: [{ name: 'Accept', value: 'application/json' }],
        vars: { req: [{ name: 'old', value: '1' }], res: [] },
        auth: { mode: 'none' }
      }
    };
    const merged = mergeValue(original, { request: { auth: { mode: 'bearer', bearer: { token: 'abc' } }, headers: [] } });
    expect(merged.request.auth).toEqual({ mode: 'bearer', bearer: { token: 'abc' } });
    expect(merged.request.headers).toEqual([]);
    expect(original.request.headers).toHaveLength(1);

    const edited = applyMutation(merged, {
      set: { 'request.vars.req': [{ name: 'current', value: '2' }], 'settings.timeout': 5000 },
      unset: ['request.auth.bearer']
    });
    expect(edited.request.vars.req).toEqual([{ name: 'current', value: '2' }]);
    expect(edited.settings.timeout).toBe(5000);
    expect(edited.request.auth).toEqual({ mode: 'bearer' });
  });

  it('creates defaults for every Bruno protocol and maps current request tabs', () => {
    expect(createRequestDefinition({ name: 'HTTP' })).toMatchObject({ type: 'http-request', request: { body: { mode: 'none' } } });
    expect(createRequestDefinition({ name: 'GraphQL', type: 'graphql' })).toMatchObject({ type: 'graphql-request', request: { body: { mode: 'graphql', graphql: { query: '', variables: '' } } } });
    expect(createRequestDefinition({ name: 'gRPC', type: 'grpc' })).toMatchObject({ type: 'grpc-request', request: { body: { mode: 'grpc' } } });
    expect(createRequestDefinition({ name: 'WebSocket', type: 'ws' })).toMatchObject({ type: 'ws-request', request: { body: { mode: 'ws' } } });
    expect(createRequestDefinition({ name: 'SSE endpoint', type: 'sse' })).toMatchObject({ type: 'http-request', request: { method: 'GET', body: { mode: 'none' } } });
    expect(tabPath('http-request', 'params')).toBe('request.params');
    expect(tabPath('graphql-request', 'query')).toBe('request.body.graphql');
    expect(tabPath('grpc-request', 'message')).toBe('request.body.grpc');
    expect(tabPath('ws-request', 'message')).toBe('request.body.ws');
    expect(tabPath('http-request', 'settings')).toBe('$settings');
  });

  it('stores a 256-bit bearer token encrypted with private file permissions and rotates it', async () => {
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
});
