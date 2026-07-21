const {
  buildClaudeConfig,
  buildCodexConfig,
  claudeDesktopConfigPath,
  createMcpClientConfigurations
} = require('../../src/mcp/client-config');

describe('Bruno MCP client configuration generator', () => {
  it('generates stdio configs for Codex, Claude Desktop, and Claude Code without embedding the MCP token', () => {
    const launch = { command: '/opt/Bruno/bruno', args: ['--mcp-stdio'] };
    const configs = createMcpClientConfigurations({ ...launch, platform: 'linux' });

    expect(configs.transport).toBe('stdio');
    expect(configs.codex.configPath).toBe('~/.codex/config.toml');
    expect(configs.codex.snippet).toContain('[mcp_servers.bruno]');
    expect(configs.codex.snippet).toContain('command = "/opt/Bruno/bruno"');
    expect(configs.codex.snippet).toContain('args = ["--mcp-stdio"]');
    expect(configs.claudeDesktop.configPath).toBe('~/.config/Claude/claude_desktop_config.json');
    expect(JSON.parse(configs.claudeDesktop.snippet)).toEqual({
      mcpServers: { bruno: launch }
    });
    expect(configs.claudeCode.snippet).toBe(configs.claudeDesktop.snippet);
    expect(JSON.stringify(configs)).not.toMatch(/token|authorization/i);
  });

  it('escapes executable paths in TOML and JSON snippets', () => {
    const launch = { command: 'C:\\Program Files\\Bruno\\Bruno.exe', args: ['--mcp-stdio'] };
    expect(buildCodexConfig(launch)).toContain('C:\\\\Program Files\\\\Bruno\\\\Bruno.exe');
    expect(JSON.parse(buildClaudeConfig(launch)).mcpServers.bruno.command).toBe(launch.command);
    expect(claudeDesktopConfigPath('win32')).toBe('%APPDATA%\\Claude\\claude_desktop_config.json');
    expect(claudeDesktopConfigPath('darwin')).toBe('~/Library/Application Support/Claude/claude_desktop_config.json');
  });
});
