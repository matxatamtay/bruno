const tomlString = (value) => JSON.stringify(String(value));

const claudeDesktopConfigPath = (platform = process.platform) => {
  if (platform === 'darwin') return '~/Library/Application Support/Claude/claude_desktop_config.json';
  if (platform === 'win32') return '%APPDATA%\\Claude\\claude_desktop_config.json';
  return '~/.config/Claude/claude_desktop_config.json';
};

const buildCodexConfig = (endpoint, tokenEnvVar) => [
  '[mcp_servers.bruno]',
  `url = ${tomlString(endpoint)}`,
  `bearer_token_env_var = ${tomlString(tokenEnvVar)}`,
  'startup_timeout_sec = 20',
  'tool_timeout_sec = 120'
].join('\n');

const buildClaudeCodeConfig = (endpoint, tokenEnvVar) => JSON.stringify({
  mcpServers: {
    bruno: {
      type: 'http',
      url: endpoint,
      headers: { Authorization: `Bearer \${${tokenEnvVar}}` }
    }
  }
}, null, 2);

// Claude Desktop only speaks stdio to MCP servers, so it reaches Bruno's Streamable HTTP
// endpoint through the `mcp-remote` bridge (https://github.com/geelen/mcp-remote). The token
// is embedded in this snippet's own `env` block rather than the user's shell, since GUI apps
// launched outside a terminal don't inherit shell environment variables.
const buildClaudeDesktopConfig = (endpoint, tokenEnvVar) => JSON.stringify({
  mcpServers: {
    bruno: {
      command: 'npx',
      args: ['-y', 'mcp-remote', endpoint, '--allow-http', '--header', `Authorization:\${${tokenEnvVar}}`],
      env: { [tokenEnvVar]: 'Bearer <paste-your-bruno-mcp-token-here>' }
    }
  }
}, null, 2);

const createMcpClientConfigurations = ({ endpoint, tokenEnvVar = 'BRUNO_MCP_TOKEN', platform = process.platform } = {}) => {
  const normalizedEndpoint = String(endpoint || '').trim();
  if (!normalizedEndpoint) throw new TypeError('Bruno MCP endpoint is required');
  return {
    transport: 'http',
    endpoint: normalizedEndpoint,
    tokenEnvVar,
    codex: {
      configPath: '~/.codex/config.toml',
      snippet: buildCodexConfig(normalizedEndpoint, tokenEnvVar)
    },
    claudeCode: {
      configPath: '.mcp.json',
      snippet: buildClaudeCodeConfig(normalizedEndpoint, tokenEnvVar)
    },
    claudeDesktop: {
      configPath: claudeDesktopConfigPath(platform),
      snippet: buildClaudeDesktopConfig(normalizedEndpoint, tokenEnvVar)
    }
  };
};

module.exports = {
  buildClaudeCodeConfig,
  buildClaudeDesktopConfig,
  buildCodexConfig,
  claudeDesktopConfigPath,
  createMcpClientConfigurations
};
