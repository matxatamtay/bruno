const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { createBrunoMcpProxy } = require('../../src/mcp/stdio-proxy');

const toolDefinition = {
  name: 'bruno_update_request',
  description: 'Edit every persisted request field.',
  inputSchema: {
    type: 'object',
    properties: {
      collection_path: { type: 'string' },
      item_pathname: { type: 'string' },
      set: { type: 'object' }
    },
    required: ['collection_path', 'item_pathname']
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
};

describe('Bruno MCP stdio proxy', () => {
  it('forwards tool schemas, mutations, and resources without reducing the upstream surface', async () => {
    const calls = [];
    const upstream = {
      getServerCapabilities: jest.fn(() => ({ tools: { listChanged: false }, resources: { listChanged: false, subscribe: false } })),
      listTools: jest.fn(async () => ({ tools: [toolDefinition] })),
      callTool: jest.fn(async (params) => {
        calls.push(params);
        return { content: [{ type: 'text', text: JSON.stringify({ updated: true, arguments: params.arguments }) }] };
      }),
      listResources: jest.fn(async () => ({ resources: [{ uri: 'bruno://request-run/run_1', name: 'run_1' }] })),
      listResourceTemplates: jest.fn(async () => ({ resourceTemplates: [{ uriTemplate: 'bruno://request-run/{runId}', name: 'request run' }] })),
      readResource: jest.fn(async ({ uri }) => ({ contents: [{ uri, mimeType: 'application/json', text: '{"status":"success"}' }] })),
      setNotificationHandler: jest.fn(),
      close: jest.fn(async () => undefined)
    };
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const proxy = await createBrunoMcpProxy({ upstreamClient: upstream, downstreamTransport: serverTransport });
    const client = new Client({ name: 'stdio-proxy-test', version: '1.0.0' });

    try {
      await client.connect(clientTransport);
      const listed = await client.listTools();
      expect(listed.tools).toEqual([toolDefinition]);

      const args = {
        collection_path: 'api',
        item_pathname: 'users/get-user.bru',
        set: { 'request.vars.req': [{ name: 'userId', value: '42' }] }
      };
      const result = await client.callTool({ name: 'bruno_update_request', arguments: args });
      expect(JSON.parse(result.content[0].text)).toEqual({ updated: true, arguments: args });
      expect(calls).toEqual([{ name: 'bruno_update_request', arguments: args }]);

      await expect(client.listResources()).resolves.toEqual({ resources: [{ uri: 'bruno://request-run/run_1', name: 'run_1' }] });
      await expect(client.readResource({ uri: 'bruno://request-run/run_1' })).resolves.toEqual({
        contents: [{ uri: 'bruno://request-run/run_1', mimeType: 'application/json', text: '{"status":"success"}' }]
      });
    } finally {
      await client.close();
      await proxy.close();
    }

    expect(upstream.close).toHaveBeenCalled();
  });
});
