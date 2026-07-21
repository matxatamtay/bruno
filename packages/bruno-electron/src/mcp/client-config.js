const normalizeLaunch = ({ command, args = [] } = {}) => {
  const normalizedCommand = String(command || '').trim();
  if (!normalizedCommand) throw new TypeError('Bruno MCP stdio command is required');
  return {
    command: normalizedCommand,
    args: Array.isArray(args) ? args.map((value) => String(value)) : []
  };
};

const tomlString = (value) => JSON.stringify(String(value));
const tomlArray = (values) => `[${values.map(tomlString).join(', ')}]`;

const claudeDesktopConfigPath = (platform = process.platform) => {
  if (platform === 'darwin') return '~/Library/Application Support/Claude/claude_desktop_config.json';
  if (platform === 'win32') return '%APPDATA%\\Claude\\claude_desktop_config.json';
  return '~/.config/Claude/claude_desktop_config.json';
};

const buildCodexConfig = (launch) => [
  '[mcp_servers.bruno]',
  `command = ${tomlString(launch.command)}`,
  `args = ${tomlArray(launch.args)}`,
  'startup_timeout_sec = 20',
  'tool_timeout_sec = 120'
].join('\n');

const buildClaudeConfig = (launch) => JSON.stringify({
  mcpServers: {
    bruno: {
      command: launch.command,
      args: launch.args
    }
  }
}, null, 2);

const createMcpClientConfigurations = ({ command, args, platform = process.platform } = {}) => {
  const launch = normalizeLaunch({ command, args });
  const claudeSnippet = buildClaudeConfig(launch);
  return {
    transport: 'stdio',
    launch,
    codex: {
      configPath: '~/.codex/config.toml',
      snippet: buildCodexConfig(launch)
    },
    claudeDesktop: {
      configPath: claudeDesktopConfigPath(platform),
      snippet: claudeSnippet
    },
    claudeCode: {
      configPath: '.mcp.json',
      snippet: claudeSnippet
    }
  };
};

module.exports = {
  buildClaudeConfig,
  buildCodexConfig,
  claudeDesktopConfigPath,
  createMcpClientConfigurations,
  normalizeLaunch
};
