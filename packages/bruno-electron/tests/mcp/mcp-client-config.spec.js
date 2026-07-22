const {
  buildClaudeCodeConfig,
  buildClaudeDesktopConfig,
  buildCodexConfig,
  claudeDesktopConfigPath,
  createMcpClientConfigurations
} = require('../../src/mcp/client-config');

describe('Bruno MCP client configuration generator', () => {
  it('generates Streamable HTTP configs for Codex and Claude Code that reference an env var, not a raw token', () => {
    const endpoint = 'http://127.0.0.1:3847/mcp';
    const configs = createMcpClientConfigurations({ endpoint, platform: 'linux' });

    expect(configs.transport).toBe('http');
    expect(configs.endpoint).toBe(endpoint);
    expect(configs.tokenEnvVar).toBe('BRUNO_MCP_TOKEN');

    expect(configs.codex.configPath).toBe('~/.codex/config.toml');
    expect(configs.codex.snippet).toContain('[mcp_servers.bruno]');
    expect(configs.codex.snippet).toContain(`url = "${endpoint}"`);
    expect(configs.codex.snippet).toContain('bearer_token_env_var = "BRUNO_MCP_TOKEN"');

    expect(configs.claudeCode.configPath).toBe('.mcp.json');
    expect(JSON.parse(configs.claudeCode.snippet)).toEqual({
      mcpServers: {
        bruno: {
          type: 'http',
          url: endpoint,
          headers: { Authorization: 'Bearer ${BRUNO_MCP_TOKEN}' }
        }
      }
    });

    expect(JSON.stringify(configs)).not.toMatch(/bearer [a-z0-9_-]{10,}/i);
  });

  it('bridges Claude Desktop over stdio via mcp-remote with the token scoped to that command only', () => {
    const endpoint = 'http://127.0.0.1:3847/mcp';
    const configs = createMcpClientConfigurations({ endpoint, platform: 'darwin' });

    expect(configs.claudeDesktop.configPath).toBe('~/Library/Application Support/Claude/claude_desktop_config.json');
    const claudeDesktop = JSON.parse(configs.claudeDesktop.snippet).mcpServers.bruno;
    expect(claudeDesktop.command).toBe('npx');
    expect(claudeDesktop.args).toEqual(['-y', 'mcp-remote', endpoint, '--allow-http', '--header', 'Authorization:${BRUNO_MCP_TOKEN}']);
    expect(claudeDesktop.env).toEqual({ BRUNO_MCP_TOKEN: expect.stringContaining('Bearer') });
  });

  it('escapes the endpoint in TOML and JSON snippets and resolves per-platform Claude Desktop paths', () => {
    const endpoint = 'http://127.0.0.1:3847/mcp';
    expect(buildCodexConfig(endpoint, 'BRUNO_MCP_TOKEN')).toContain('url = "http://127.0.0.1:3847/mcp"');
    expect(JSON.parse(buildClaudeCodeConfig(endpoint, 'BRUNO_MCP_TOKEN')).mcpServers.bruno.url).toBe(endpoint);
    expect(JSON.parse(buildClaudeDesktopConfig(endpoint, 'BRUNO_MCP_TOKEN')).mcpServers.bruno.args).toContain(endpoint);
    expect(claudeDesktopConfigPath('win32')).toBe('%APPDATA%\\Claude\\claude_desktop_config.json');
    expect(claudeDesktopConfigPath('darwin')).toBe('~/Library/Application Support/Claude/claude_desktop_config.json');
  });

  it('requires an endpoint', () => {
    expect(() => createMcpClientConfigurations({})).toThrow();
  });
});
