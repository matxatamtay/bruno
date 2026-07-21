const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema
} = require('@modelcontextprotocol/sdk/types.js');
const { normalizeMcpConfig } = require('./config');
const { McpTokenStore } = require('./token-store');

const desktopEndpoint = (config) => `http://${config.host}:${config.port}/mcp`;

const resolveDesktopConnection = async ({ endpoint, token, preferences, appDataPath, tokenStore } = {}) => {
  let resolvedEndpoint = String(endpoint || process.env.BRUNO_MCP_ENDPOINT || '').trim();
  let resolvedToken = String(token || process.env.BRUNO_MCP_AUTH_TOKEN || process.env.BRUNO_DESKTOP_AUTH_TOKEN || '').trim();
  let config = null;
  let electronApp = null;

  if (!resolvedEndpoint || !resolvedToken) {
    const { app } = require('electron');
    electronApp = app;
    await app.whenReady();
    const { getPreferences } = require('../store/preferences');
    config = normalizeMcpConfig(preferences || getPreferences());
    if (!config.enabled) {
      throw new Error('Bruno MCP is disabled. Open Bruno Preferences > MCP, enable it, and keep Bruno running.');
    }
    resolvedEndpoint ||= desktopEndpoint(config);
    if (!resolvedToken) {
      const store = tokenStore || new McpTokenStore({
        directory: path.join(appDataPath || app.getPath('userData'), 'bruno-mcp')
      });
      resolvedToken = (await store.ensure()).token;
    }
  }

  if (!resolvedEndpoint) throw new Error('Bruno MCP endpoint is unavailable');
  if (!resolvedToken) throw new Error('Bruno MCP authentication token is unavailable');
  return { endpoint: resolvedEndpoint, token: resolvedToken, config, app: electronApp };
};

const connectUpstream = async ({ endpoint, token }) => {
  const client = new Client({ name: 'bruno-mcp-stdio-bridge', version: '2.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } }
  });
  try {
    await client.connect(transport);
    return client;
  } catch (error) {
    await client.close().catch(() => null);
    throw new Error(`Unable to connect to Bruno Desktop MCP at ${endpoint}. Keep Bruno open and MCP enabled. ${error?.message || error}`);
  }
};

const createBrunoMcpProxy = async ({ upstreamClient, endpoint, token, downstreamTransport } = {}) => {
  const upstream = upstreamClient || await connectUpstream({ endpoint, token });
  const upstreamCapabilities = upstream.getServerCapabilities?.() || {};
  const capabilities = {};
  if (upstreamCapabilities.tools) capabilities.tools = { listChanged: upstreamCapabilities.tools.listChanged === true };
  if (upstreamCapabilities.resources) {
    capabilities.resources = {
      listChanged: upstreamCapabilities.resources.listChanged === true,
      subscribe: upstreamCapabilities.resources.subscribe === true
    };
  }

  const server = new Server(
    { name: 'Bruno Desktop', version: '2.0.0' },
    {
      capabilities,
      instructions: 'Bruno collection MCP over stdio. Search, read, edit, create, delete, resolve, and run Bruno collections and requests through the open Bruno Desktop application.'
    }
  );

  if (capabilities.tools) {
    server.setRequestHandler(ListToolsRequestSchema, ({ params }) => upstream.listTools(params));
    server.setRequestHandler(CallToolRequestSchema, ({ params }) => upstream.callTool(params));
    if (capabilities.tools.listChanged) {
      upstream.setNotificationHandler?.(ToolListChangedNotificationSchema, () => server.sendToolListChanged());
    }
  }

  if (capabilities.resources) {
    server.setRequestHandler(ListResourcesRequestSchema, ({ params }) => upstream.listResources(params));
    server.setRequestHandler(ListResourceTemplatesRequestSchema, ({ params }) => upstream.listResourceTemplates(params));
    server.setRequestHandler(ReadResourceRequestSchema, ({ params }) => upstream.readResource(params));
    if (capabilities.resources.listChanged) {
      upstream.setNotificationHandler?.(ResourceListChangedNotificationSchema, () => server.sendResourceListChanged());
    }
  }

  const transport = downstreamTransport || new StdioServerTransport();
  await server.connect(transport);
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await Promise.allSettled([server.close(), upstream.close?.()]);
  };
  return { server, upstream, transport, close };
};

const runBrunoMcpStdio = async (options = {}) => {
  const connection = await resolveDesktopConnection(options);
  const proxy = await createBrunoMcpProxy({
    endpoint: connection.endpoint,
    token: connection.token,
    downstreamTransport: options.downstreamTransport
  });

  await new Promise((resolve) => {
    let finishing = false;
    const finish = async () => {
      if (finishing) return;
      finishing = true;
      await proxy.close();
      resolve();
    };
    process.stdin.once('end', finish);
    process.stdin.once('close', finish);
    process.once('SIGINT', finish);
    process.once('SIGTERM', finish);
  });
};

module.exports = {
  connectUpstream,
  createBrunoMcpProxy,
  desktopEndpoint,
  resolveDesktopConnection,
  runBrunoMcpStdio
};
